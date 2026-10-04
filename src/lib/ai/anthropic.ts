import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { type CadSpec, CadSpecError, buildCadSpec, cadSpecSchema } from "../geometry/cadspec";
import { type EditOp, applyEditOps, editOpSchema } from "../geometry/ops";
import { dimensions } from "../geometry/mesh";
import { env } from "../env";
import { ANALYSIS_SYSTEM, CADSPEC_DOC, CHAT_SYSTEM, EDIT_DOC } from "./prompts";
import { type AiImage, AiError, type ChatContext, type DesignResult, type ModifyResult, type ObjectAnalysis, type TurnPlan } from "./types";

type Tool = Anthropic.Messages.Tool;

let client: Anthropic | null = null;
function api(): Anthropic {
  if (!env.anthropicKey) throw new AiError("NOT_CONFIGURED", "ANTHROPIC_API_KEY is not set.", "Add your key to .env.local to enable AI analysis and chat.");
  return (client ??= new Anthropic({ apiKey: env.anthropicKey }));
}

const jsonSchema = (s: z.ZodType) => {
  const { $schema, ...rest } = z.toJSONSchema(s, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  void $schema;
  return rest as Tool["input_schema"];
};

// ───────────────────────────── tool schemas ─────────────────────────────
const analysisToolSchema = z.object({
  objectName: z.string(),
  category: z.string(),
  description: z.string(),
  confidence: z.number().min(0).max(1),
  dimensions: z.object({
    x: z.number().positive(),
    y: z.number().positive(),
    z: z.number().positive(),
    basis: z.string(),
    confidence: z.enum(["low", "medium", "high"]),
  }),
  geometry: z.string(),
  symmetry: z.enum(["none", "mirror", "rotational", "both", "unknown"]),
  features: z.array(
    z.object({
      type: z.enum(["hole", "mounting_point", "edge", "surface", "moving_part", "thread", "text", "other"]),
      description: z.string(),
      functional: z.boolean(),
    }),
  ),
  visibleParts: z.array(z.string()),
  missingViews: z.array(z.string()),
  suggestions: z.array(z.string()).max(8),
  reconstruction: z.object({ feasible: z.boolean(), reasons: z.array(z.string()) }),
  questions: z.array(z.string()).max(4),
});

const editOpsArray = z.array(editOpSchema).min(1).max(12);

const chatTools: Tool[] = [
  {
    name: "reply_only",
    description: "Answer or ask one focused question. Does not change the model.",
    input_schema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
  },
  {
    name: "modify_model",
    description: "Apply edit operations to the current model, creating a new version.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Short explanation to the user incl. assumptions" },
        label: { type: "string", description: "≤6 word label of this change, e.g. 'Scaled +10%'" },
        ops: jsonSchema(editOpsArray) as never,
      },
      required: ["message", "label", "ops"],
    },
  },
  {
    name: "design_part",
    description: "Design a new part as a CadSpec tree; creates a new version.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Explain the design, list key dimensions and assumptions" },
        spec: {
          type: "object",
          description: "CadSpec: {name, description?, root: node}. See reference.",
          properties: { name: { type: "string" }, description: { type: "string" }, root: { type: "object", description: "CadSpec node", additionalProperties: true } },
          required: ["name", "root"],
        },
      },
      required: ["message", "spec"],
    },
  },
  {
    name: "reconstruct_from_photos",
    description: "Re-run photo reconstruction of the scanned object.",
    input_schema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
  },
];

// ───────────────────────────── helpers ─────────────────────────────
const imgBlock = (i: AiImage): Anthropic.Messages.ImageBlockParam => ({
  type: "image",
  source: { type: "base64", media_type: i.mediaType, data: i.data.toString("base64") },
});

const r1 = (n: number) => Math.round(n * 10) / 10;

export function describeContext(c: ChatContext): string {
  const lines: string[] = [];
  lines.push(`Project: "${c.projectName}" (mode: ${c.mode})`);
  if (c.analysis) {
    const a = c.analysis;
    const d = { ...a.dimensions, ...a.userDimensions };
    lines.push(
      `Scanned object: ${a.objectName} – ${a.description}. Estimated size W×D×H = ${r1(d.x)}×${r1(d.y)}×${r1(d.z)} mm` +
        `${a.userDimensions ? " (user-corrected)" : ` (${a.dimensions.confidence} confidence: ${a.dimensions.basis})`}. Features: ${a.features.map((f) => f.description).join("; ") || "n/a"}.`,
    );
  }
  if (c.currentDimensions) {
    const d = c.currentDimensions;
    lines.push(`Current model: v${c.currentVersionNumber}, bounding box W×D×H = ${r1(d.x)}×${r1(d.y)}×${r1(d.z)} mm.`);
  } else lines.push("Current model: none yet.");
  if (c.versions.length) {
    lines.push("Versions: " + c.versions.slice(-8).map((v) => `v${v.number} [${v.source}] ${v.prompt ?? ""} → ${r1(v.dimensions.x)}×${r1(v.dimensions.y)}×${r1(v.dimensions.z)}`).join(" | "));
  }
  lines.push(`Print settings: ${c.settings.material}, layer ${c.settings.layerHeight} mm, infill ${c.settings.infill}%, nozzle ${c.settings.nozzle} mm, printer ${c.settings.printerId}.`);
  if (c.report) lines.push(`Last print check: ${c.report.level} – ${c.report.checks.filter((k) => k.status !== "ok").map((k) => k.title).join("; ") || "all good"}.`);
  return lines.join("\n");
}

const systemFor = () => CHAT_SYSTEM.replace("{{CADSPEC}}", CADSPEC_DOC).replace("{{EDIT}}", EDIT_DOC);

function toolUse(res: Anthropic.Messages.Message) {
  return res.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
}
const textOf = (res: Anthropic.Messages.Message) =>
  res.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

function mapApiError(e: unknown): never {
  if (e instanceof AiError) throw e;
  if (e instanceof Anthropic.APIError) {
    throw new AiError("PROVIDER_ERROR", `AI service error (${e.status ?? "network"}): ${e.message}`);
  }
  throw e;
}

// ───────────────────────────── analysis ─────────────────────────────
export async function claudeAnalyze(input: { images: AiImage[]; hint?: string; meshInfo?: string }): Promise<ObjectAnalysis> {
  const content: Anthropic.Messages.ContentBlockParam[] = [];
  input.images.slice(0, 10).forEach((img, i) => {
    content.push({ type: "text", text: `Photo ${i + 1}:` }, imgBlock(img));
  });
  content.push({
    type: "text",
    text: [input.meshInfo ? `Existing 3D model info: ${input.meshInfo}` : "", input.hint ? `User note: ${input.hint}` : "", "Analyse the object and call report_object_analysis."]
      .filter(Boolean)
      .join("\n"),
  });
  try {
    const res = await api().messages.create({
      model: env.anthropicModel,
      max_tokens: 3000,
      system: ANALYSIS_SYSTEM,
      tools: [{ name: "report_object_analysis", description: "Report the structured analysis.", input_schema: jsonSchema(analysisToolSchema) }],
      tool_choice: { type: "tool", name: "report_object_analysis" },
      messages: [{ role: "user", content }],
    });
    const tu = toolUse(res);
    const parsed = analysisToolSchema.safeParse(tu?.input);
    if (!parsed.success) throw new AiError("PROVIDER_ERROR", "The AI returned an analysis in an unexpected format.");
    return { ...parsed.data, provider: `anthropic:${env.anthropicModel}` };
  } catch (e) {
    mapApiError(e);
  }
}

// ───────────────────────────── chat / planning ─────────────────────────────
function historyMessages(c: ChatContext, message: string): Anthropic.Messages.MessageParam[] {
  const msgs: Anthropic.Messages.MessageParam[] = [];
  const hist = c.history.slice(-12);
  // The API needs alternating roles starting with user; collapse consecutive same-role turns.
  for (const h of hist) {
    const last = msgs[msgs.length - 1];
    if (last && last.role === h.role) last.content = `${last.content as string}\n${h.content}`;
    else msgs.push({ role: h.role, content: h.content });
  }
  if (msgs[0]?.role === "assistant") msgs.shift();
  const ctx = `[Current project state]\n${describeContext(c)}\n\n[User message]\n${message}`;
  const last = msgs[msgs.length - 1];
  if (last && last.role === "user") last.content = `${last.content as string}\n\n${ctx}`;
  else msgs.push({ role: "user", content: ctx });
  return msgs;
}

type Forced = "modify_model" | "design_part" | undefined;

async function plan(message: string, context: ChatContext, forced: Forced): Promise<TurnPlan> {
  const a = api();
  const messages = historyMessages(context, message);
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Anthropic.Messages.Message;
    try {
      res = await a.messages.create({
        model: env.anthropicModel,
        max_tokens: 8000,
        system: systemFor(),
        tools: forced ? chatTools.filter((t) => t.name === forced) : chatTools,
        tool_choice: forced ? { type: "tool", name: forced } : { type: "any" },
        messages,
      });
    } catch (e) {
      mapApiError(e);
    }
    const tu = toolUse(res);
    if (!tu) return { kind: "reply", reply: textOf(res) || "…" };
    const input = tu.input as Record<string, unknown>;
    const reply = String(input.message ?? textOf(res) ?? "");
    const fail = (err: string): "retry" => {
      lastError = err;
      messages.push({ role: "assistant", content: res.content });
      messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Your tool call failed validation: ${err}\nFix it and call the tool again.` }] });
      return "retry";
    };

    switch (tu.name) {
      case "reply_only":
        return { kind: "reply", reply };
      case "reconstruct_from_photos":
        return { kind: "reconstruct", reply };
      case "modify_model": {
        const ops = editOpsArray.safeParse(input.ops);
        if (!ops.success) {
          fail(ops.error.issues.map((i) => `ops.${i.path.join(".")}: ${i.message}`).join("; "));
          continue;
        }
        if (context.currentMesh) {
          try {
            await applyEditOps(context.currentMesh, ops.data); // dry run → catches impossible edits before the user sees them
          } catch (e) {
            fail(e instanceof Error ? e.message : String(e));
            continue;
          }
        }
        return { kind: "modify", reply, ops: ops.data, label: String(input.label ?? "Edited") };
      }
      case "design_part": {
        const spec = cadSpecSchema.safeParse(input.spec);
        if (!spec.success) {
          fail(spec.error.issues.map((i) => `spec.${i.path.join(".")}: ${i.message}`).join("; "));
          continue;
        }
        try {
          await buildCadSpec(spec.data); // dry build → geometry errors go back to the model
        } catch (e) {
          fail(e instanceof CadSpecError ? e.message : String(e));
          continue;
        }
        return { kind: "design", reply, spec: spec.data };
      }
      default:
        return { kind: "reply", reply };
    }
  }
  throw new AiError("INVALID_DESIGN", "I could not turn that request into a valid model.", lastError);
}

export const claudePlanTurn = (message: string, context: ChatContext): Promise<TurnPlan> => plan(message, context, undefined);

export async function claudeModify(instruction: string, context: ChatContext): Promise<ModifyResult> {
  const p = await plan(instruction, context, "modify_model");
  if (p.kind !== "modify") throw new AiError("INVALID_DESIGN", "No edit was produced.");
  return { ops: p.ops, label: p.label, reply: p.reply };
}

export async function claudeDesign(instruction: string, context: ChatContext): Promise<DesignResult> {
  const p = await plan(instruction, context, "design_part");
  if (p.kind !== "design") throw new AiError("INVALID_DESIGN", "No design was produced.");
  return { spec: p.spec as CadSpec, reply: p.reply };
}

export { dimensions as _dimensions };
export type { EditOp };
