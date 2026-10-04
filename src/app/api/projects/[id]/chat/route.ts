import { route, ownedProject, HttpError, readJson } from "@/lib/api";
import { enqueueJob, hasActiveJob } from "@/lib/jobs/queue";
import { addMessage } from "@/lib/services/projects";

export const POST = route<{ id: string }>(async (req, { user, params }) => {
  ownedProject(user, params.id);
  const { message } = await readJson<{ message: string }>(req);
  const text = String(message ?? "").trim();
  if (!text) throw new HttpError(400, "Message is empty");
  if (text.length > 2000) throw new HttpError(400, "Message is too long (max 2000 characters)");
  if (hasActiveJob(params.id)) throw new HttpError(409, "Please wait until the current task has finished.");
  const msg = addMessage(params.id, "user", text);
  return { messageId: msg.id, jobId: enqueueJob(params.id, "chat", { message: text }) };
});
