import { env } from "../env";
import { parseGlb } from "../geometry/io/glb";
import { parseObj } from "../geometry/io/obj";
import { parseStl } from "../geometry/io/stl";
import { weld } from "../geometry/mesh";
import { AiError, type AiImage, type ReconstructStep } from "./types";

const BASE = "https://api.meshy.ai/openapi/v1";

interface MeshyTask {
  id: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED";
  progress?: number;
  model_urls?: Partial<Record<"glb" | "obj" | "stl" | "fbx" | "usdz", string>>;
  task_error?: { message?: string };
}

async function meshy<T>(path: string, init?: RequestInit): Promise<T> {
  if (!env.meshyKey) throw new AiError("NOT_CONFIGURED", "MESHY_API_KEY is not set.", "Photo → 3D reconstruction needs a Meshy API key (see README).");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.meshyKey}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) throw new AiError("PROVIDER_ERROR", "Meshy rejected the API key.", body.slice(0, 200));
    if (res.status === 402) throw new AiError("PROVIDER_ERROR", "Your Meshy account is out of credits.", body.slice(0, 200));
    throw new AiError("PROVIDER_ERROR", `Meshy error ${res.status}`, body.slice(0, 300));
  }
  return (await res.json()) as T;
}

const dataUri = (i: AiImage) => `data:${i.mediaType};base64,${i.data.toString("base64")}`;
const MAX_WAIT_MS = 25 * 60_000;

/**
 * Photo → mesh via Meshy (multi-image-to-3D, geometry only), as resumable STEPS:
 *   step 1: submit the task, remember `taskId` in `state`
 *   step n: poll once; when SUCCEEDED download + parse the mesh
 */
export async function meshyReconstructStep(input: { images: AiImage[]; state: Record<string, unknown> }): Promise<ReconstructStep> {
  const { images, state } = input;
  const multi = ((state.imageCount as number | undefined) ?? images.length) > 1;
  const endpoint = multi ? "/multi-image-to-3d" : "/image-to-3d";

  if (!state.taskId) {
    if (images.length === 0) throw new AiError("LOW_QUALITY_INPUT", "No photos to reconstruct from.");
    const picked = images.slice(0, 4); // Meshy multi-image accepts up to 4 views
    const isMulti = picked.length > 1;
    const body = isMulti
      ? { image_urls: picked.map(dataUri), ai_model: env.meshyModel, should_texture: false, enable_pbr: false }
      : { image_url: dataUri(picked[0]), ai_model: env.meshyModel, should_texture: false, enable_pbr: false };
    const created = await meshy<{ result: string }>(isMulti ? "/multi-image-to-3d" : "/image-to-3d", { method: "POST", body: JSON.stringify(body) });
    return { status: "pending", progress: 8, stage: "Photos sent – waiting for the reconstruction service", state: { ...state, taskId: created.result, imageCount: picked.length, submittedAt: Date.now() } };
  }

  const task = await meshy<MeshyTask>(`${endpoint}/${state.taskId as string}`);
  if (task.status === "FAILED" || task.status === "CANCELED") {
    throw new AiError("RECONSTRUCTION_FAILED", "The reconstruction service could not build a model from these photos.", task.task_error?.message);
  }
  if (task.status !== "SUCCEEDED") {
    if (Date.now() - ((state.submittedAt as number) ?? Date.now()) > MAX_WAIT_MS) throw new AiError("RECONSTRUCTION_FAILED", "Reconstruction took too long and was stopped.");
    return { status: "pending", progress: 10 + Math.round((task.progress ?? 0) * 0.75), stage: task.status === "PENDING" ? "Waiting in queue" : "Reconstructing 3D shape", state };
  }

  const urls = task.model_urls ?? {};
  const pick = urls.stl ? (["stl", urls.stl] as const) : urls.obj ? (["obj", urls.obj] as const) : urls.glb ? (["glb", urls.glb] as const) : null;
  if (!pick) throw new AiError("RECONSTRUCTION_FAILED", "The service finished but returned no downloadable mesh.");
  const file = await fetch(pick[1]);
  if (!file.ok) throw new AiError("PROVIDER_ERROR", `Could not download the generated mesh (${file.status}).`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let mesh;
  try {
    mesh = pick[0] === "stl" ? parseStl(bytes) : pick[0] === "obj" ? parseObj(new TextDecoder().decode(bytes)) : parseGlb(bytes);
  } catch (e) {
    throw new AiError("RECONSTRUCTION_FAILED", `The generated mesh could not be read: ${e instanceof Error ? e.message : e}`);
  }
  const soup = new Float32Array(mesh.indices.length * 3);
  for (let i = 0; i < mesh.indices.length; i++) soup.set(mesh.positions.subarray(mesh.indices[i] * 3, mesh.indices[i] * 3 + 3), i * 3);
  return { status: "done", result: { mesh: weld(soup, 1e-5), scaleKnown: false, upAxis: pick[0] === "stl" ? "z" : "y", provider: "meshy" } };
}
