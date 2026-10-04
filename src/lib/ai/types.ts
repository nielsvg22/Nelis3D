import type { CadSpec } from "../geometry/cadspec";
import type { EditOp } from "../geometry/ops";
import type { Mesh } from "../geometry/mesh";
import type { PrintReport } from "../geometry/printability";
import type { PrintSettings } from "../printing/profiles";

/** An image prepared for AI consumption (already resized/cleaned by the preprocessing stage). */
export interface AiImage {
  id: string;
  mediaType: "image/jpeg" | "image/png";
  data: Buffer;
}

export interface DimensionEstimate {
  /** width (X), depth (Y), height (Z) in millimetres */
  x: number;
  y: number;
  z: number;
  /** how the estimate was derived, e.g. "compared to the visible credit card" */
  basis: string;
  confidence: "low" | "medium" | "high";
}

export type FeatureType = "hole" | "mounting_point" | "edge" | "surface" | "moving_part" | "thread" | "text" | "other";

export interface ObjectAnalysis {
  objectName: string;
  category: string;
  description: string;
  confidence: number; // 0..1
  dimensions: DimensionEstimate;
  /** set once the user corrected the estimate */
  userDimensions?: { x?: number; y?: number; z?: number };
  geometry: string;
  symmetry: "none" | "mirror" | "rotational" | "both" | "unknown";
  features: { type: FeatureType; description: string; functional: boolean }[];
  visibleParts: string[];
  missingViews: string[];
  /** concrete things the user could ask for */
  suggestions: string[];
  reconstruction: { feasible: boolean; reasons: string[] };
  /** questions the AI needs answered before it can do a good job */
  questions: string[];
  provider: string;
}

export interface ChatContext {
  projectName: string;
  mode: string;
  analysis: ObjectAnalysis | null;
  currentMesh: Mesh | null;
  currentDimensions: { x: number; y: number; z: number } | null;
  currentVersionNumber: number | null;
  versions: { number: number; prompt: string | null; source: string; dimensions: { x: number; y: number; z: number } }[];
  history: { role: "user" | "assistant"; content: string }[];
  settings: PrintSettings;
  report: PrintReport | null;
}

/** What the conversation layer decided to do with the user's message. */
export type TurnPlan =
  | { kind: "reply"; reply: string }
  | { kind: "modify"; reply: string; ops: EditOp[]; label: string }
  | { kind: "design"; reply: string; spec: CadSpec }
  | { kind: "reconstruct"; reply: string };

export type ProgressFn = (progress: number, stage: string) => void | Promise<void>;

export interface ReconstructResult {
  mesh: Mesh;
  /** provider mesh is normalised/arbitrary scale – caller rescales to estimated or user-provided size */
  scaleKnown: boolean;
  upAxis: "y" | "z";
  provider: string;
}

export type ReconstructStep =
  | { status: "pending"; progress: number; stage: string; state: Record<string, unknown> }
  | { status: "done"; result: ReconstructResult };

export interface ModifyResult {
  ops: EditOp[];
  label: string;
  reply: string;
}

export interface DesignResult {
  spec: CadSpec;
  reply: string;
}

/**
 * The AI abstraction. A concrete provider may implement every method itself, or the registry
 * composes one from smaller backends (vision / reconstruction / design) – see ai/registry.ts.
 */
export interface AIProvider {
  readonly id: string;
  /** Which capabilities are usable with the current configuration – the UI shows this honestly. */
  capabilities(): ProviderCapabilities;

  analyzeObject(input: { images: AiImage[]; mesh?: Mesh; hint?: string }): Promise<ObjectAnalysis>;
  /**
   * One short STEP of a (possibly minutes-long) reconstruction. Serverless-friendly: the caller persists
   * `state` between calls and calls again until `status === "done"`.
   */
  reconstructModel(input: { images: AiImage[]; analysis?: ObjectAnalysis | null; state: Record<string, unknown> }): Promise<ReconstructStep>;
  modifyModel(input: { instruction: string; context: ChatContext }): Promise<ModifyResult>;
  generateFunctionalPart(input: { instruction: string; context: ChatContext }): Promise<DesignResult>;
  checkPrintability(mesh: Mesh, settings: Partial<PrintSettings>): Promise<PrintReport>;

  /** Chat entry point: decides whether to answer, ask, modify, design or reconstruct. */
  planTurn(input: { message: string; context: ChatContext }): Promise<TurnPlan>;
}

export interface ProviderCapabilities {
  analysis: { available: boolean; via: string; reason?: string };
  reconstruction: { available: boolean; via: string; reason?: string };
  chat: { available: boolean; via: string; reason?: string };
  design: { available: boolean; via: string; reason?: string };
}

/** Errors with a stable code so the UI can offer the right recovery actions. */
export type AiErrorCode =
  | "NOT_CONFIGURED"
  | "RECONSTRUCTION_FAILED"
  | "LOW_QUALITY_INPUT"
  | "INVALID_DESIGN"
  | "PROVIDER_ERROR"
  | "NON_MANIFOLD";

export class AiError extends Error {
  constructor(
    public code: AiErrorCode,
    message: string,
    public hint?: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}
