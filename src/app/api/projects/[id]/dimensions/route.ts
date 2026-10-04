import { z } from "zod";
import { route, ownedProject, readJson, HttpError } from "@/lib/api";
import { getVersion, resizeVersion } from "@/lib/services/versions";

const body = z.object({
  versionId: z.string().optional(),
  x: z.number().positive().max(5000).optional(),
  y: z.number().positive().max(5000).optional(),
  z: z.number().positive().max(5000).optional(),
  /** keep proportions: only one axis is used and the others follow */
  uniform: z.boolean().default(false),
});

export const POST = route<{ id: string }>(async (req, { user, params }) => {
  const project = ownedProject(user, params.id);
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, "Invalid dimensions");
  const vid = parsed.data.versionId ?? project.currentVersionId;
  if (!vid || !getVersion(params.id, vid)) throw new HttpError(404, "No model to resize");
  const { x, y, z, uniform } = parsed.data;
  const v = await resizeVersion(params.id, vid, { x, y, z }, uniform);
  return { versionId: v.id };
});
