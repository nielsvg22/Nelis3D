import { route, ownedProject, filesFrom, HttpError } from "@/lib/api";
import { deleteScanPhotos } from "@/lib/services/projects";
import { addScanImages } from "@/lib/services/scans";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = route<{ id: string }>(async (req, { user, params }) => {
  ownedProject(user, params.id);
  const { form, files } = await filesFrom(req);
  if (!files.length) throw new HttpError(400, "No images received");
  const res = await addScanImages(params.id, await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer()))), form.get("source") === "camera" ? "camera" : "upload");
  return res;
});

/** Privacy: delete all scan photos of this project (models stay). */
export const DELETE = route<{ id: string }>(async (_req, { user, params }) => {
  ownedProject(user, params.id);
  await deleteScanPhotos(user.id, params.id);
  return { ok: true };
});
