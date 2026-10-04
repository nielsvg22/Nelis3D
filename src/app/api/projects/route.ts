import { route, HttpError, filesFrom } from "@/lib/api";
import { enqueueJob } from "@/lib/jobs/queue";
import { getProvider } from "@/lib/ai/registry";
import { formatFromName, parseMeshFile } from "@/lib/geometry/io";
import { placeOnBed } from "@/lib/geometry/mesh";
import { repairMesh } from "@/lib/geometry/repair";
import { createProject, deleteProject, listProjects } from "@/lib/services/projects";
import { addScanImages } from "@/lib/services/scans";
import { createVersion } from "@/lib/services/versions";
import type { ProjectMode } from "@/lib/db/schema";

export const runtime = "nodejs";
export const maxDuration = 120;

export const GET = route(async (_req, { user }) => ({ projects: listProjects(user.id) }));

const MODES: ProjectMode[] = ["reconstruct", "modify", "design", "functional"];

/**
 * Creates a project from: camera frames / photos (field "files", images) OR a 3D model (STL/OBJ/3MF) OR nothing (describe-only).
 */
export const POST = route(async (req, { user }) => {
  const { form, files } = await filesFrom(req);
  const name = String(form.get("name") ?? "").trim();
  const source = form.get("source") === "camera" ? "camera" : "upload";
  const modeRaw = String(form.get("mode") ?? "reconstruct") as ProjectMode;
  const mode = MODES.includes(modeRaw) ? modeRaw : "reconstruct";
  const modelFiles = files.filter((f) => formatFromName(f.name));
  const imageFiles = files.filter((f) => !formatFromName(f.name));

  if (modelFiles.length > 1) throw new HttpError(400, "Upload one 3D model per project.");
  if (imageFiles.some((f) => !f.type.startsWith("image/") && !/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name))) throw new HttpError(400, "Only images and STL/OBJ/3MF files are supported.");
  if (imageFiles.length > 80) throw new HttpError(400, "Please upload at most 80 photos.");

  const defaultName = modelFiles[0] ? modelFiles[0].name.replace(/\.[^.]+$/, "") : imageFiles.length ? "New scan" : "New design";
  const project = createProject(user.id, name || defaultName, modelFiles[0] ? "modify" : mode);

  try {
    let jobId: string | null = null;
    if (modelFiles[0]) {
      const f = modelFiles[0];
      const parsed = parseMeshFile(f.name, new Uint8Array(await f.arrayBuffer()));
      const { mesh, actions } = repairMesh(parsed);
      await createVersion({ projectId: project.id, mesh: placeOnBed(mesh), source: "upload", prompt: `Uploaded ${f.name}`, note: actions.join("; ") || null, provider: "upload" });
      jobId = enqueueJob(project.id, "analyze");
    } else if (imageFiles.length) {
      const bufs = await Promise.all(imageFiles.map(async (f) => Buffer.from(await f.arrayBuffer())));
      const res = await addScanImages(project.id, bufs, source);
      if (res.added === 0) throw new HttpError(400, "None of the images could be read.");
      if (getProvider().capabilities().analysis.available) jobId = enqueueJob(project.id, "analyze");
    }
    return { id: project.id, jobId };
  } catch (e) {
    await deleteProject(user.id, project.id); // never leave half-created projects behind
    if (e instanceof Error && !(e instanceof HttpError) && /STL|OBJ|3MF|mesh|Mesh|zip|GLB/.test(e.message)) throw new HttpError(400, `Could not read that 3D file: ${e.message}`);
    throw e;
  }
});
