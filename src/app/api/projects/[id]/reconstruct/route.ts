import { route, ownedProject, HttpError, readJson } from "@/lib/api";
import { enqueueJob, hasActiveJob } from "@/lib/jobs/queue";
import { getProvider } from "@/lib/ai/registry";
import { AiError } from "@/lib/ai/types";
import { getDb, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";

export const POST = route<{ id: string }>(async (req, { user, params }) => {
  ownedProject(user, params.id);
  const body = await readJson<{ force?: boolean }>(req).catch(() => ({}) as { force?: boolean });
  if (hasActiveJob(params.id)) throw new HttpError(409, "Another task is still running for this project.");
  const cap = getProvider().capabilities().reconstruction;
  if (!cap.available) throw new AiError("NOT_CONFIGURED", cap.reason ?? "Reconstruction is not configured.");
  const n = getDb().select().from(schema.scanImages).where(eq(schema.scanImages.projectId, params.id)).all().filter((i) => i.included).length;
  if (n === 0) throw new HttpError(400, "Select at least one photo first.");
  const id = enqueueJob(params.id, "reconstruct");
  if (body.force) getDb().update(schema.jobs).set({ state: { force: true } }).where(eq(schema.jobs.id, id)).run();
  return { jobId: id };
});
