import { z } from "zod";
import { eq } from "drizzle-orm";
import { route, ownedProject, readJson, HttpError } from "@/lib/api";
import { getDb, schema } from "@/lib/db/client";
import { resizeVersion } from "@/lib/services/versions";

const body = z.object({
  x: z.number().positive().max(5000).optional(),
  y: z.number().positive().max(5000).optional(),
  z: z.number().positive().max(5000).optional(),
  /** rescale the current model so its bounding box matches the corrected values */
  rescale: z.boolean().default(true),
});

/** User corrects the AI's size estimate (“the width is 92 mm”) → stored, and the model is rescaled as a new version. */
export const POST = route<{ id: string }>(async (req, { user, params }) => {
  const project = ownedProject(user, params.id);
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success || (!parsed.data.x && !parsed.data.y && !parsed.data.z)) throw new HttpError(400, "Provide at least one dimension in mm");
  const { x, y, z, rescale } = parsed.data;
  const given = { x, y, z };
  const db = getDb();
  if (project.analysis) {
    const userDimensions = { ...(project.analysis.userDimensions ?? {}), ...Object.fromEntries(Object.entries(given).filter(([, v]) => v)) };
    db.update(schema.projects).set({ analysis: { ...project.analysis, userDimensions }, updatedAt: new Date() }).where(eq(schema.projects.id, params.id)).run();
  }
  let versionId: string | null = null;
  if (rescale && project.currentVersionId) {
    const count = [x, y, z].filter(Boolean).length;
    const v = await resizeVersion(params.id, project.currentVersionId, given, count === 1, `Dimensions corrected to ${[x && `W ${x}`, y && `D ${y}`, z && `H ${z}`].filter(Boolean).join(", ")} mm`);
    versionId = v.id;
  }
  return { versionId };
});
