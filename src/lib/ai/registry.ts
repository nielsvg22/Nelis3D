import { env } from "../env";
import { checkPrintability } from "../geometry/printability";
import { dimensions } from "../geometry/mesh";
import { claudeAnalyze, claudeDesign, claudeModify, claudePlanTurn, describeContext } from "./anthropic";
import { localAnalyzeMesh, localAnalyzePhotos, localPlanTurn } from "./local";
import { meshyReconstructStep } from "./meshy";
import { AiError, type AIProvider, type ProviderCapabilities } from "./types";

/**
 * Composes the active AIProvider from capability backends:
 *   vision/chat/design → Claude (if ANTHROPIC_API_KEY) else offline rules
 *   reconstruction     → Meshy (if MESHY_API_KEY)     else "not configured" (never faked)
 * Replace a backend by editing this file only – everything else talks to `AIProvider`.
 */
export function getProvider(): AIProvider {
  const useClaude = env.aiProvider !== "local" && !!env.anthropicKey;
  const useMeshy = env.aiProvider !== "local" && !!env.meshyKey;

  const capabilities = (): ProviderCapabilities => ({
    analysis: useClaude
      ? { available: true, via: `Claude (${env.anthropicModel})` }
      : { available: false, via: "none", reason: "Set ANTHROPIC_API_KEY to analyse photos. Uploaded 3D models are measured geometrically." },
    chat: useClaude ? { available: true, via: `Claude (${env.anthropicModel})` } : { available: true, via: "offline rules (limited commands)" },
    design: useClaude ? { available: true, via: `Claude → CadSpec → manifold CSG` } : { available: true, via: "offline templates (box with lid, phone holder)" },
    reconstruction: useMeshy
      ? { available: true, via: "Meshy multi-image-to-3D" }
      : { available: false, via: "none", reason: "Set MESHY_API_KEY to reconstruct objects from photos." },
  });

  return {
    id: useClaude ? (useMeshy ? "claude+meshy" : "claude") : useMeshy ? "meshy+local" : "local",
    capabilities,

    async analyzeObject({ images, mesh, hint }) {
      if (useClaude) {
        const d = mesh ? dimensions(mesh) : null;
        return claudeAnalyze({ images, hint, meshInfo: d ? `${mesh!.indices.length / 3} triangles, bounding box ${d.x.toFixed(1)}×${d.y.toFixed(1)}×${d.z.toFixed(1)} mm` : undefined });
      }
      if (mesh) return localAnalyzeMesh(mesh, hint ?? "Uploaded model");
      return localAnalyzePhotos(images);
    },

    async reconstructModel(input) {
      if (!useMeshy) throw new AiError("NOT_CONFIGURED", "Photo reconstruction is not configured.", "Set MESHY_API_KEY in .env.local (see README → AI providers).");
      return meshyReconstructStep(input);
    },

    async modifyModel({ instruction, context }) {
      if (useClaude) return claudeModify(instruction, context);
      const p = localPlanTurn(instruction, context);
      if (p.kind !== "modify") throw new AiError("INVALID_DESIGN", p.kind === "reply" ? p.reply : "Could not interpret that edit.");
      return { ops: p.ops, label: p.label, reply: p.reply };
    },

    async generateFunctionalPart({ instruction, context }) {
      if (useClaude) return claudeDesign(instruction, context);
      const p = localPlanTurn(instruction, context);
      if (p.kind !== "design") throw new AiError("INVALID_DESIGN", p.kind === "reply" ? p.reply : "Could not interpret that design request.");
      return { spec: p.spec, reply: p.reply };
    },

    async checkPrintability(mesh, settings) {
      return checkPrintability(mesh, settings);
    },

    async planTurn({ message, context }) {
      return useClaude ? claudePlanTurn(message, context) : localPlanTurn(message, context);
    },
  };
}

export { describeContext };
