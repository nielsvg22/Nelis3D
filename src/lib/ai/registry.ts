import { env } from "../env";
import { checkPrintability } from "../geometry/printability";
import { dimensions } from "../geometry/mesh";
import { claudeAnalyze, claudeDesign, claudeModify, claudePlanTurn } from "./anthropic";
import { hfReconstructStep } from "./huggingface";
import { localAnalyzeMesh, localAnalyzePhotos, localPlanTurn } from "./local";
import { meshyReconstructStep } from "./meshy";
import { mistralAnalyze, mistralDesign, mistralModify, mistralPlanTurn } from "./mistral";
import { AiError, type AIProvider, type ProviderCapabilities } from "./types";

type Llm = "claude" | "mistral" | "local";
type Recon = "meshy" | "huggingface" | "none";

/**
 * Composes the active AIProvider from capability backends – replace one by editing this file only:
 *   vision / chat / design : Claude (ANTHROPIC_API_KEY) → Mistral (MISTRAL_API_KEY, free tier) → offline rules
 *   reconstruction         : Meshy (MESHY_API_KEY)      → Hugging Face TRELLIS Space (HF_TOKEN, free) → not available
 * AI_PROVIDER=local forces the offline mode. Nothing is ever faked: a missing backend is reported as such.
 */
function pick(): { llm: Llm; recon: Recon } {
  if (env.aiProvider === "local") return { llm: "local", recon: "none" };
  return {
    llm: env.anthropicKey ? "claude" : env.mistralKey ? "mistral" : "local",
    recon: env.meshyKey ? "meshy" : env.hfToken ? "huggingface" : "none",
  };
}

export function getProvider(): AIProvider {
  const { llm, recon } = pick();
  const llmName = llm === "claude" ? `Claude (${env.anthropicModel})` : llm === "mistral" ? `Mistral (${env.mistralModel})` : "";

  const capabilities = (): ProviderCapabilities => ({
    analysis: llm !== "local" ? { available: true, via: llmName } : { available: false, via: "none", reason: "Set MISTRAL_API_KEY (free) or ANTHROPIC_API_KEY to analyse photos. Uploaded 3D models are measured geometrically." },
    chat: llm !== "local" ? { available: true, via: llmName } : { available: true, via: "offline rules (limited commands)" },
    design: llm !== "local" ? { available: true, via: `${llmName} → CadSpec → manifold CSG` } : { available: true, via: "offline templates (box with lid, phone holder)" },
    reconstruction:
      recon === "meshy" ? { available: true, via: "Meshy multi-image-to-3D" } :
      recon === "huggingface" ? { available: true, via: `Hugging Face · ${env.hfSpace} (free, shared GPU – may queue)` } :
      { available: false, via: "none", reason: "Set HF_TOKEN (free, Hugging Face) or MESHY_API_KEY to reconstruct objects from photos." },
  });

  const reconSteps = { meshy: meshyReconstructStep, huggingface: hfReconstructStep };

  return {
    id: [llm === "local" ? "local" : llm, recon === "none" ? null : recon].filter(Boolean).join("+"),
    capabilities,

    async analyzeObject({ images, mesh, hint }) {
      if (llm === "local") return mesh ? localAnalyzeMesh(mesh, hint ?? "Uploaded model") : localAnalyzePhotos(images);
      const d = mesh ? dimensions(mesh) : null;
      const meshInfo = d ? `${mesh!.indices.length / 3} triangles, bounding box ${d.x.toFixed(1)}×${d.y.toFixed(1)}×${d.z.toFixed(1)} mm` : undefined;
      return (llm === "claude" ? claudeAnalyze : mistralAnalyze)({ images, hint, meshInfo });
    },

    async reconstructModel(input) {
      if (recon === "none") throw new AiError("NOT_CONFIGURED", "Photo reconstruction is not configured.", "Set HF_TOKEN (free) or MESHY_API_KEY in the environment (see README → AI providers).");
      return reconSteps[recon](input);
    },

    async modifyModel({ instruction, context }) {
      if (llm === "claude") return claudeModify(instruction, context);
      if (llm === "mistral") return mistralModify(instruction, context);
      const p = localPlanTurn(instruction, context);
      if (p.kind !== "modify") throw new AiError("INVALID_DESIGN", p.kind === "reply" ? p.reply : "Could not interpret that edit.");
      return { ops: p.ops, label: p.label, reply: p.reply };
    },

    async generateFunctionalPart({ instruction, context }) {
      if (llm === "claude") return claudeDesign(instruction, context);
      if (llm === "mistral") return mistralDesign(instruction, context);
      const p = localPlanTurn(instruction, context);
      if (p.kind !== "design") throw new AiError("INVALID_DESIGN", p.kind === "reply" ? p.reply : "Could not interpret that design request.");
      return { spec: p.spec, reply: p.reply };
    },

    async checkPrintability(mesh, settings) {
      return checkPrintability(mesh, settings);
    },

    async planTurn({ message, context }) {
      if (llm === "local") return localPlanTurn(message, context);
      return (llm === "claude" ? claudePlanTurn : mistralPlanTurn)(message, context);
    },
  };
}
