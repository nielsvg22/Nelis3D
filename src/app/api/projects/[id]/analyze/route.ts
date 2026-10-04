import { route, ownedProject, HttpError } from "@/lib/api";
import { enqueueJob, hasActiveJob } from "@/lib/jobs/queue";
import { getProvider } from "@/lib/ai/registry";
import { AiError } from "@/lib/ai/types";

export const maxDuration = 300;
export const POST = route<{ id: string }>(async (_req, { user, params }) => {
  await ownedProject(user, params.id);
  if (await hasActiveJob(params.id)) throw new HttpError(409, "Another task is still running for this project.");
  const cap = getProvider().capabilities().analysis;
  if (!cap.available) throw new AiError("NOT_CONFIGURED", cap.reason ?? "Analysis is not configured.");
  return { jobId: await enqueueJob(params.id, "analyze") };
});
