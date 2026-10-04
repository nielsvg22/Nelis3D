import { route, HttpError, ownedProject } from "@/lib/api";
import { getJob } from "@/lib/jobs/queue";
import { toJobDTO } from "@/lib/services/projects";

export const GET = route<{ id: string }>(async (_req, { user, params }) => {
  const job = getJob(params.id);
  if (!job) throw new HttpError(404, "Job not found");
  ownedProject(user, job.projectId);
  return toJobDTO(job);
});
