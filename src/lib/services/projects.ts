import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { first, getDb, schema } from "../db/client";
import { getProvider } from "../ai/registry";
import { newId, slugify } from "../ids";
import { getStorage } from "../storage";
import { DEFAULT_PRINT_SETTINGS, resolveProfile, type PrintSettings } from "../printing/profiles";
import type { ProjectMode } from "../db/schema";
import type { JobDTO, ProjectDetailDTO, ProjectSummaryDTO } from "../types";
import { toVersionDTO } from "./versions";

const { projects, scans, scanImages, modelVersions, prompts, jobs, printProfiles } = schema;

export const toJobDTO = (j: typeof jobs.$inferSelect): JobDTO => ({
  id: j.id,
  kind: j.kind,
  status: j.status,
  progress: j.progress,
  stage: j.stage,
  error: j.error,
  errorCode: j.errorCode,
  result: j.result ?? null,
  createdAt: j.createdAt.toISOString(),
});

export async function createProject(userId: string, name: string, mode: ProjectMode) {
  const db = await getDb();
  const id = newId("p_");
  const clean = name.trim().slice(0, 80) || "Untitled project";
  const prefix = `${slugify(clean)}-${id.slice(2, 8).toLowerCase().replace(/[^a-z0-9]/g, "x")}/`;
  await db.insert(projects).values({ id, userId, name: clean, mode, storagePrefix: prefix, printSettings: { ...DEFAULT_PRINT_SETTINGS } });
  // remember the user's default print profile
  if (!(await first(db.select().from(printProfiles).where(eq(printProfiles.userId, userId)).limit(1)))) {
    await db.insert(printProfiles).values({ id: newId("pp_"), userId, name: "Creality K1 Max · PLA", settings: DEFAULT_PRINT_SETTINGS, isDefault: true });
  }
  return (await first(db.select().from(projects).where(eq(projects.id, id))))!;
}

export async function getOwnedProject(userId: string, projectId: string) {
  return first((await getDb()).select().from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId))));
}

export async function listProjects(userId: string): Promise<ProjectSummaryDTO[]> {
  const db = await getDb();
  const rows = await db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.updatedAt));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const versions = await db.select().from(modelVersions).where(inArray(modelVersions.projectId, ids));
  const images = await db.select({ projectId: scanImages.projectId }).from(scanImages).where(inArray(scanImages.projectId, ids));
  const active = await db.select().from(jobs).where(inArray(jobs.projectId, ids)).orderBy(desc(jobs.createdAt));
  return rows.map((p) => {
    const vs = versions.filter((v) => v.projectId === p.id);
    const cur = vs.find((v) => v.id === p.currentVersionId) ?? null;
    const job = active.find((j) => j.projectId === p.id && (j.status === "queued" || j.status === "running")) ?? null;
    return {
      id: p.id,
      name: p.name,
      mode: p.mode,
      updatedAt: p.updatedAt.toISOString(),
      versionCount: vs.length,
      imageCount: images.filter((i) => i.projectId === p.id).length,
      current: cur ? { id: cur.id, number: cur.number, hasPreview: !!cur.previewKey, dimensions: { x: cur.dimX, y: cur.dimY, z: cur.dimZ } } : null,
      activeJob: job ? { id: job.id, kind: job.kind, status: job.status, progress: job.progress, stage: job.stage } : null,
    };
  });
}

export async function getProjectDetail(userId: string, projectId: string): Promise<ProjectDetailDTO | null> {
  const db = await getDb();
  const p = await getOwnedProject(userId, projectId);
  if (!p) return null;
  const images = await db.select().from(scanImages).where(eq(scanImages.projectId, p.id)).orderBy(asc(scanImages.position));
  const versions = await db.select().from(modelVersions).where(eq(modelVersions.projectId, p.id)).orderBy(asc(modelVersions.number));
  const messages = await db.select().from(prompts).where(eq(prompts.projectId, p.id)).orderBy(asc(prompts.createdAt));
  const projectJobs = await db.select().from(jobs).where(eq(jobs.projectId, p.id)).orderBy(desc(jobs.createdAt)).limit(10);
  const active = projectJobs.find((j) => j.status === "queued" || j.status === "running") ?? null;
  const latest = projectJobs[0];
  const provider = getProvider();
  return {
    id: p.id,
    name: p.name,
    mode: p.mode,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    currentVersionId: p.currentVersionId,
    analysis: p.analysis ?? null,
    settings: resolveProfile(p.printSettings).settings,
    images: images.map((i) => ({ id: i.id, position: i.position, included: i.included, issues: i.quality?.issues ?? [], sharpness: i.quality?.sharpness ?? null })),
    versions: versions.map((v) => toVersionDTO(v, p.currentVersionId)),
    messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, versionId: m.versionId, meta: m.meta ?? null, createdAt: m.createdAt.toISOString() })),
    activeJob: active ? toJobDTO(active) : null,
    lastFailedJob: !active && latest?.status === "failed" ? toJobDTO(latest) : null,
    capabilities: provider.capabilities(),
    providerId: provider.id,
  };
}

export async function addMessage(projectId: string, role: "user" | "assistant" | "system", content: string, versionId?: string | null, meta?: Record<string, unknown> | null) {
  const row = { id: newId("msg_"), projectId, role, content, versionId: versionId ?? null, meta: meta ?? null };
  await (await getDb()).insert(prompts).values(row);
  return row;
}

export async function updateSettings(userId: string, projectId: string, patch: Partial<PrintSettings>) {
  const p = await getOwnedProject(userId, projectId);
  if (!p) throw new Error("Project not found");
  const settings = resolveProfile({ ...(p.printSettings ?? {}), ...patch }).settings;
  await (await getDb()).update(projects).set({ printSettings: settings, updatedAt: new Date() }).where(eq(projects.id, projectId));
  return settings;
}

export async function renameProject(userId: string, projectId: string, name: string) {
  const p = await getOwnedProject(userId, projectId);
  if (!p) throw new Error("Project not found");
  await (await getDb()).update(projects).set({ name: name.trim().slice(0, 80) || p.name, updatedAt: new Date() }).where(eq(projects.id, projectId));
}

/** Irreversibly removes DB rows AND every stored file (photos, meshes, exports). */
export async function deleteProject(userId: string, projectId: string) {
  const p = await getOwnedProject(userId, projectId);
  if (!p) return false;
  await getStorage().deletePrefix(p.storagePrefix);
  await (await getDb()).delete(projects).where(eq(projects.id, projectId)); // cascades to scans, images, models, versions, prompts, jobs
  return true;
}

/** Privacy: remove only the scan photos, keep models. */
export async function deleteScanPhotos(userId: string, projectId: string) {
  const p = await getOwnedProject(userId, projectId);
  if (!p) return false;
  const db = await getDb();
  await getStorage().deletePrefix(`${p.storagePrefix}scan/`);
  await db.delete(scanImages).where(eq(scanImages.projectId, projectId));
  await db.delete(scans).where(eq(scans.projectId, projectId));
  return true;
}
