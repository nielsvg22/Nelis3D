import { env } from "../env";
import { parseGlb } from "../geometry/io/glb";
import { weld } from "../geometry/mesh";
import { AiError, type AiImage, type ReconstructStep } from "./types";

/**
 * Free photo → 3D via a public Hugging Face Space (default: the community TRELLIS demo, Gradio queue API).
 * Pipeline per request: start_session → preprocess_image (background removal) → generate_and_extract_glb.
 * Runs as resumable steps: the Gradio session hash is the "task id"; a step listens for up to ~4 min and
 * returns "pending" if the Space (shared ZeroGPU, queue!) is not done yet.
 *
 * Caveats (honest): shared free GPUs → queues, daily quota per token, and the Space may change or disappear.
 * Single photo only (the multi-image tab of the demo needs UI-state events we do not drive).
 */
const LISTEN_MS = 240_000;

interface Cfg { dependencies: { id: number; api_name?: string }[] }
const spaceUrl = () => `https://${env.hfSpace.replace("/", "-").replace(/[._]/g, "-").toLowerCase()}.hf.space`;
const headers = () => ({ Authorization: `Bearer ${env.hfToken}` });

let cfgCache: { url: string; cfg: Cfg } | null = null;
async function fnIndex(name: string): Promise<number> {
  const url = spaceUrl();
  if (!cfgCache || cfgCache.url !== url) {
    const r = await fetch(`${url}/config`, { headers: headers() });
    if (!r.ok) throw new AiError("PROVIDER_ERROR", `The 3D reconstruction Space is not reachable (HTTP ${r.status}).`, "It may be sleeping, renamed or removed. Try again in a minute or set HF_SPACE.");
    cfgCache = { url, cfg: (await r.json()) as Cfg };
  }
  const d = cfgCache.cfg.dependencies.find((x) => x.api_name === name);
  if (!d) throw new AiError("PROVIDER_ERROR", `The Space does not offer "${name}" any more.`, "Its API changed – set HF_SPACE to another image-to-3D Space or update lib/ai/huggingface.ts.");
  return d.id;
}

async function join(session: string, name: string, data: unknown[]) {
  const r = await fetch(`${spaceUrl()}/gradio_api/queue/join`, { method: "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify({ data, fn_index: await fnIndex(name), session_hash: session }) });
  if (!r.ok) throw new AiError("PROVIDER_ERROR", `Could not queue the job on the Space (HTTP ${r.status}).`, (await r.text().catch(() => "")).slice(0, 160));
}

interface Completed { success?: boolean; output?: { data?: unknown[]; error?: string | null } }

/** Wait for the next finished event of this session (or null on timeout). Reports queue position via cb. */
async function nextCompleted(session: string, maxMs: number, onRank?: (rank: number, size: number) => void): Promise<Completed | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), maxMs);
  try {
    const res = await fetch(`${spaceUrl()}/gradio_api/queue/data?session_hash=${session}`, { headers: headers(), signal: ac.signal });
    if (!res.ok || !res.body) throw new AiError("PROVIDER_ERROR", `Space event stream failed (HTTP ${res.status}).`);
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, i).replace(/^data: /, "");
        buf = buf.slice(i + 2);
        let m: { msg?: string; rank?: number; queue_size?: number } & Completed;
        try { m = JSON.parse(line); } catch { continue; }
        if (m.msg === "estimation" && m.rank !== undefined) onRank?.(m.rank, m.queue_size ?? 0);
        if (m.msg === "process_completed") return m;
      }
    }
    return null;
  } catch (e) {
    if (e instanceof AiError) throw e;
    return null; // aborted → still running
  } finally {
    clearTimeout(timer);
  }
}

async function upload(img: AiImage) {
  const fd = new FormData();
  fd.append("files", new Blob([new Uint8Array(img.data)], { type: img.mediaType }), "photo.jpg");
  const r = await fetch(`${spaceUrl()}/gradio_api/upload`, { method: "POST", headers: headers(), body: fd });
  if (!r.ok) throw new AiError("PROVIDER_ERROR", `Photo upload to the Space failed (HTTP ${r.status}).`);
  const paths = (await r.json()) as string[];
  return { path: paths[0], meta: { _type: "gradio.FileData" }, orig_name: "photo.jpg", mime_type: img.mediaType };
}

const failed = (m: Completed, what: string) => {
  const e = m.output?.error;
  const quota = typeof e === "string" && /quota|gpu/i.test(e);
  return new AiError("RECONSTRUCTION_FAILED", quota ? "The free GPU quota for today is used up." : `The Space could not ${what}.`, quota ? "Try again later (quota resets daily) or use a paid provider." : e ?? "The photo may not show a clear single object.");
};

export async function hfReconstructStep(input: { images: AiImage[]; state: Record<string, unknown> }): Promise<ReconstructStep> {
  if (!env.hfToken) throw new AiError("NOT_CONFIGURED", "HF_TOKEN is not set.");
  const state = { ...input.state };
  let phase = (state.phase as string | undefined) ?? "init";

  if (phase === "init") {
    if (input.images.length === 0) throw new AiError("LOW_QUALITY_INPUT", "No photos to reconstruct from.");
    const session = Math.random().toString(36).slice(2, 14);
    state.taskId = session;
    state.submittedAt = Date.now();
    await join(session, "start_session", []);
    await nextCompleted(session, 20_000);
    await join(session, "preprocess_image", [await upload(input.images[0])]);
    state.phase = phase = "preprocess";
  }
  const session = state.taskId as string;
  if (Date.now() - ((state.submittedAt as number) ?? Date.now()) > 25 * 60_000) throw new AiError("RECONSTRUCTION_FAILED", "Reconstruction took too long and was stopped.");

  let rankNote = "";
  for (;;) {
    const m = await nextCompleted(session, LISTEN_MS, (rank, size) => (rankNote = rank > 0 ? ` (queue position ${rank} of ${size})` : ""));
    if (!m) return { status: "pending", progress: phase === "preprocess" ? 15 : 45, stage: (phase === "preprocess" ? "Preparing the photo" : "Generating the 3D shape") + rankNote, state };
    if (m.success === false || m.output?.error !== undefined && m.output?.data === undefined) throw failed(m, phase === "preprocess" ? "prepare the photo" : "generate a 3D model");

    if (phase === "preprocess") {
      const img = (m.output?.data ?? [])[0];
      if (!img) throw failed(m, "prepare the photo");
      await join(session, "generate_and_extract_glb", [img, [], null, 0, 7.5, 12, 3.0, 12, "stochastic", 0.95, 1024]);
      state.phase = phase = "generate";
      continue;
    }
    const files = (m.output?.data ?? []) as ({ url?: string; path?: string } | null)[];
    const glb = files.find((f) => f && typeof f === "object" && /\.glb(\?|$)/i.test(f.url ?? f.path ?? ""));
    if (!glb?.url) throw failed(m, "produce a downloadable model");
    const dl = await fetch(glb.url, { headers: headers() });
    if (!dl.ok) throw new AiError("PROVIDER_ERROR", `Could not download the generated mesh (${dl.status}).`);
    let mesh;
    try { mesh = parseGlb(new Uint8Array(await dl.arrayBuffer())); } catch (e) { throw new AiError("RECONSTRUCTION_FAILED", `The generated mesh could not be read: ${e instanceof Error ? e.message : e}`); }
    const soup = new Float32Array(mesh.indices.length * 3);
    for (let i = 0; i < mesh.indices.length; i++) soup.set(mesh.positions.subarray(mesh.indices[i] * 3, mesh.indices[i] * 3 + 3), i * 3);
    return { status: "done", result: { mesh: weld(soup, 1e-5), scaleKnown: false, upAxis: "y", provider: `huggingface:${env.hfSpace}` } };
  }
}
