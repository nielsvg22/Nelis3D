import { route, ownedProject, readJson } from "@/lib/api";
import { deleteImage, setImageIncluded } from "@/lib/services/scans";

export const PATCH = route<{ id: string; imageId: string }>(async (req, { user, params }) => {
  ownedProject(user, params.id);
  const { included } = await readJson<{ included: boolean }>(req);
  setImageIncluded(params.id, params.imageId, !!included);
  return { ok: true };
});

export const DELETE = route<{ id: string; imageId: string }>(async (_req, { user, params }) => {
  ownedProject(user, params.id);
  await deleteImage(params.id, params.imageId);
  return { ok: true };
});
