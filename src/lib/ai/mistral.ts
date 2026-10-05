import { CadSpecError, buildCadSpec, cadSpecSchema } from "../geometry/cadspec";
import { applyEditOps } from "../geometry/ops";
import { env } from "../env";
import { ANALYSIS_SYSTEM } from "./prompts";
import { analysisToolSchema, chatToolDefs, describeContext, editOpsArray, jsonSchema, systemFor } from "./shared";
import { AiError, type AiImage, type ChatContext, type DesignResult, type ModifyResult, type ObjectAnalysis, type TurnPlan } from "./types";

/**
 * Mistral backend (EU-hosted; free "Experiment" tier works). OpenAI-compatible chat-completions with
 * vision + function calling. Same contract as the Claude backend: analysis, conversation planning,
 * edit ops and CadSpec designs – every result is validated (and dry-run) before the user sees it.
 */
const URL = "https://api.mistral.ai/v1/chat/completions";

type Msg = Record<string, unknown>;
interface ToolCall { id: string; function: { name: string; arguments: string } }
interface Completion { choices: { message: { content?: string | null; tool_calls?: ToolCall[] } }[] }

async function chat(body: Record<string, unknown>): Promise<Completion> {
  if (!env.mistralKey) throw new AiError("NOT_CONFIGURED", "MISTRAL_API_KEY is not set.", "Add your key to the environment to enable AI analysis and chat.");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(URL, { method: "POST", headers: { Authorization: `Bearer ${env.mistralKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: env.mistralModel, ...body }) });
    if (res.ok) return (await res.json()) as Completion;
    const text = await res.text().catch(() => "");
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); // free tier is rate limited – back off briefly
      continue;
    }
    if (res.status === 401) throw new AiError("PROVIDER_ERROR", "Mistral rejected the API key.", text.slice(0, 160));
    if (res.status === 429) throw new AiError("PROVIDER_ERROR", "Mistral's free-tier rate limit was reached. Wait a minute and try again.", text.slice(0, 160));
    throw new AiError("PROVIDER_ERROR", `Mistral error ${res.status}`, text.slice(0, 240));
  }
}

const tool = (t: { name: string; description: string; parameters: Record<string, unknown> }) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } });
const dataUrl = (i: AiImage) => `data:${i.mediaType};base64,${i.data.toString("base64")}`;

export async function mistralAnalyze(input: { images: AiImage[]; hint?: string; meshInfo?: string }): Promise<ObjectAnalysis> {
  const content: Msg[] = [];
  input.images.slice(0, 8).forEach((img, i) => content.push({ type: "text", text: `Photo ${i + 1}:` }, { type: "image_url", image_url: dataUrl(img) }));
  content.push({ type: "text", text: [input.meshInfo ? `Existing 3D model info: ${input.meshInfo}` : "", input.hint ? `User note: ${input.hint}` : "", "Analyse the object and call report_object_analysis."].filter(Boolean).join("\n") });
  const t = { name: "report_object_analysis", description: "Report the structured analysis.", parameters: jsonSchema(analysisToolSchema) };
  const messages: Msg[] = [{ role: "system", content: ANALYSIS_SYSTEM }, { role: "user", content }];
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await chat({ messages, tools: [tool(t)], tool_choice: "any", max_tokens: 3000, temperature: 0.2 });
    const msg = res.choices[0]?.message;
    const call = msg?.tool_calls?.[0];
    let parsed: ReturnType<typeof analysisToolSchema.safeParse> | null = null;
    try {
      parsed = call ? analysisToolSchema.safeParse(JSON.parse(call.function.arguments)) : null;
    } catch {
      lastErr = "arguments were not valid JSON";
    }
    if (parsed?.success) return { ...parsed.data, provider: `mistral:${env.mistralModel}` };
    if (parsed && !parsed.success) lastErr = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    if (call) {
      messages.push({ role: "assistant", content: msg?.content ?? "", tool_calls: msg?.tool_calls });
      messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: `Validation failed: ${lastErr}. Call the tool again with a valid payload.` });
    }
  }
  throw new AiError("PROVIDER_ERROR", "The AI returned an analysis in an unexpected format.", lastErr);
}

type Forced = "modify_model" | "design_part" | undefined;

async function plan(message: string, context: ChatContext, forced: Forced): Promise<TurnPlan> {
  const messages: Msg[] = [{ role: "system", content: systemFor() }];
  const hist: { role: "user" | "assistant"; content: string }[] = [];
  for (const h of context.history.slice(-12)) {
    const last = hist[hist.length - 1];
    if (last && last.role === h.role) last.content += `\n${h.content}`;
    else hist.push({ ...h });
  }
  messages.push(...hist);
  messages.push({ role: "user", content: `[Current project state]\n${describeContext(context)}\n\n[User message]\n${message}` });

  const tools = (forced ? chatToolDefs.filter((t) => t.name === forced) : chatToolDefs).map(tool);
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await chat({ messages, tools, tool_choice: "any", max_tokens: 6000, temperature: 0.2 });
    const msg = res.choices[0]?.message;
    const call = msg?.tool_calls?.[0];
    if (!call) return { kind: "reply", reply: (msg?.content ?? "").trim() || "…" };
    let input: Record<string, unknown> = {};
    let err = "";
    try {
      input = JSON.parse(call.function.arguments);
    } catch {
      err = "arguments were not valid JSON";
    }
    const reply = String(input.message ?? msg?.content ?? "");
    const retry = (e: string) => {
      lastError = e;
      messages.push({ role: "assistant", content: msg?.content ?? "", tool_calls: msg?.tool_calls });
      messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: `Your tool call failed validation: ${e}\nFix it and call the tool again.` });
    };
    if (err) { retry(err); continue; }

    switch (call.function.name) {
      case "reply_only":
        return { kind: "reply", reply };
      case "reconstruct_from_photos":
        return { kind: "reconstruct", reply };
      case "modify_model": {
        const ops = editOpsArray.safeParse(input.ops);
        if (!ops.success) { retry(ops.error.issues.map((i) => `ops.${i.path.join(".")}: ${i.message}`).join("; ")); continue; }
        if (context.currentMesh) {
          try { await applyEditOps(context.currentMesh, ops.data); } catch (e) { retry(e instanceof Error ? e.message : String(e)); continue; }
        }
        return { kind: "modify", reply, ops: ops.data, label: String(input.label ?? "Edited") };
      }
      case "design_part": {
        const spec = cadSpecSchema.safeParse(input.spec);
        if (!spec.success) { retry(spec.error.issues.map((i) => `spec.${i.path.join(".")}: ${i.message}`).join("; ")); continue; }
        try { await buildCadSpec(spec.data); } catch (e) { retry(e instanceof CadSpecError ? e.message : String(e)); continue; }
        return { kind: "design", reply, spec: spec.data };
      }
      default:
        return { kind: "reply", reply };
    }
  }
  throw new AiError("INVALID_DESIGN", "I could not turn that request into a valid model.", lastError);
}

export const mistralPlanTurn = (message: string, context: ChatContext) => plan(message, context, undefined);

export async function mistralModify(instruction: string, context: ChatContext): Promise<ModifyResult> {
  const p = await plan(instruction, context, "modify_model");
  if (p.kind !== "modify") throw new AiError("INVALID_DESIGN", "No edit was produced.");
  return { ops: p.ops, label: p.label, reply: p.reply };
}

export async function mistralDesign(instruction: string, context: ChatContext): Promise<DesignResult> {
  const p = await plan(instruction, context, "design_part");
  if (p.kind !== "design") throw new AiError("INVALID_DESIGN", "No design was produced.");
  return { spec: p.spec, reply: p.reply };
}
