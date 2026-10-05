import { z } from "zod";
import { CADSPEC_DOC, CHAT_SYSTEM, EDIT_DOC } from "./prompts";
import { editOpSchema } from "../geometry/ops";
import type { ChatContext } from "./types";

/** Provider-neutral JSON schema for tool/function definitions. */
export type JsonSchema = Record<string, unknown>;
export const jsonSchema = (s: z.ZodType): JsonSchema => {
  const { $schema, ...rest } = z.toJSONSchema(s, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  void $schema;
  return rest;
};

// ───────────────────────────── tool schemas ─────────────────────────────
export const analysisToolSchema = z.object({
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

export const editOpsArray = z.array(editOpSchema).min(1).max(12);

export const chatToolDefs: { name: string; description: string; parameters: JsonSchema }[] = [
  {
    name: "reply_only",
    description: "Answer or ask one focused question. Does not change the model.",
    parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
  },
  {
    name: "modify_model",
    description: "Apply edit operations to the current model, creating a new version.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Short explanation to the user incl. assumptions" },
        label: { type: "string", description: "≤6 word label of this change, e.g. 'Scaled +10%'" },
        ops: jsonSchema(editOpsArray),
      },
      required: ["message", "label", "ops"],
    },
  },
  {
    name: "design_part",
    description: "Design a new part as a CadSpec tree; creates a new version.",
    parameters: {
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
    parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
  },
];


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


export const systemFor = () => CHAT_SYSTEM.replace("{{CADSPEC}}", CADSPEC_DOC).replace("{{EDIT}}", EDIT_DOC);

