import { route, HttpError, ownedProject, readJson } from "@/lib/api";
import { deleteProject, getProjectDetail, renameProject } from "@/lib/services/projects";

export const GET = route<{ id: string }>(async (_req, { user, params }) => {
  const d = getProjectDetail(user.id, params.id);
  if (!d) throw new HttpError(404, "Project not found");
  return d;
});

export const PATCH = route<{ id: string }>(async (req, { user, params }) => {
  ownedProject(user, params.id);
  const body = await readJson<{ name?: string }>(req);
  if (body.name) renameProject(user.id, params.id, body.name);
  return { ok: true };
});

export const DELETE = route<{ id: string }>(async (_req, { user, params }) => {
  const ok = await deleteProject(user.id, params.id);
  if (!ok) throw new HttpError(404, "Project not found");
  return { ok: true };
});
