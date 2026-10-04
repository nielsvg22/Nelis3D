/** JSON-serialisable DTOs shared between API routes and the React client. */
import type { PrintReport } from "./geometry/printability";
import type { ObjectAnalysis, ProviderCapabilities } from "./ai/types";
import type { PrintSettings } from "./printing/profiles";

export interface VersionDTO {
  id: string;
  number: number;
  parentVersionId: string | null;
  source: string;
  prompt: string | null;
  note: string | null;
  dimensions: { x: number; y: number; z: number };
  triangles: number;
  hasPreview: boolean;
  report: PrintReport | null;
  settings: Partial<PrintSettings> | null;
  createdAt: string;
  isCurrent: boolean;
}

export interface ImageDTO {
  id: string;
  position: number;
  included: boolean;
  issues: string[];
  sharpness: number | null;
}

export interface MessageDTO {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  versionId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface JobDTO {
  id: string;
  kind: "analyze" | "reconstruct" | "chat";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  stage: string | null;
  error: string | null;
  errorCode: string | null;
  result: Record<string, unknown> | null;
  createdAt: string;
}

export interface ProjectSummaryDTO {
  id: string;
  name: string;
  mode: string;
  updatedAt: string;
  versionCount: number;
  imageCount: number;
  current: { id: string; number: number; hasPreview: boolean; dimensions: { x: number; y: number; z: number } } | null;
  activeJob: Pick<JobDTO, "id" | "kind" | "status" | "progress" | "stage"> | null;
}

export interface ProjectDetailDTO {
  id: string;
  name: string;
  mode: string;
  createdAt: string;
  updatedAt: string;
  currentVersionId: string | null;
  analysis: ObjectAnalysis | null;
  settings: PrintSettings;
  images: ImageDTO[];
  versions: VersionDTO[];
  messages: MessageDTO[];
  activeJob: JobDTO | null;
  lastFailedJob: JobDTO | null;
  capabilities: ProviderCapabilities;
  providerId: string;
}
