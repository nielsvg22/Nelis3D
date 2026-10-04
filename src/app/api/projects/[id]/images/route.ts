import { route, ownedProject, filesFrom, HttpError, MAX_BODY_BYTES } from "@/lib/api";
import { getProvider } from "@/lib/ai/registry";
import { enqueueJob, hasActiveJob } from "@/lib/jobs/queue";
import { deleteScanPhotos } from "@/lib/services/projects";
import { addScanImages } from "@/lib/services/scans";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Add photos. Clients upload in small batches (a serverless request body is limited to ~4.5 MB) and send
 * `finalize=1` with the last batch, which starts the AI analysis.
 */
export const POST = route<{ id: string }>(async (req, { user, params }) => {
  await ownedProject(user, params.id);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new HttpError(413, "This batch of photos is too large. The app uploads in smaller batches automatically – please update the page and retry.");
  const { form, files } = await filesFrom(req);
  if (!files.length) throw new HttpError(400, "No images received");
  const res = await addScanImages(params.id, await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer()))), form.get("source") === "camera" ? "camera" : "upload");
  let jobId: string | null = null;
  if (form.get("finalize") === "1" && res.added > 0 && getProvider().capabilities().analysis.available && !(await hasActiveJob(params.id))) {
    jobId = await enqueueJob(params.id, "analyze");
  }
  return { ...res, jobId };
});

/** Privacy: delete all scan photos of this project (models stay). */
export const DELETE = route<{ id: string }>(async (_req, { user, params }) => {
  await ownedProject(user, params.id);
  await deleteScanPhotos(user.id, params.id);
  return { ok: true };
});
