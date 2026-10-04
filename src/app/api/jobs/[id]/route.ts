import { route, HttpError, ownedProject } from "@/lib/api";
import { getJob, kickActive } from "@/lib/jobs/queue";

export const maxDuration = 300;
import { toJobDTO } from "@/lib/services/projects";

export const GET = route<{ id: string }>(async (_req, { user, params }) => {
  const job = await getJob(params.id);
  if (!job) throw new HttpError(404, "Job not found");
  await ownedProject(user, job.projectId);
  await kickActive(job.projectId);
  return toJobDTO(job);
});
