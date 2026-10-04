import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "../db/client";
import { newId } from "../ids";
import { getStorage } from "../storage";
import { type Mesh, dimensions, placeOnBed, resizeMesh, rotateMesh } from "../geometry/mesh";
import { parseStl, writeBinaryStl } from "../geometry/io/stl";
import { checkPrintability } from "../geometry/printability";
import { repairMesh } from "../geometry/repair";
import { resolveProfile, type PrintSettings } from "../printing/profiles";
import type { VersionSource } from "../db/schema";
import type { VersionDTO } from "../types";

const { modelVersions, models, projects } = schema;

export interface NewVersion {
  projectId: string;
  mesh: Mesh;
  source: VersionSource;
  prompt?: string | null;
  note?: string | null;
  parentVersionId?: string | null;
  provider?: string | null;
  makeCurrent?: boolean;
}

export function toVersionDTO(v: typeof modelVersions.$inferSelect, currentId: string | null): VersionDTO {
  return {
    id: v.id,
    number: v.number,
    parentVersionId: v.parentVersionId,
    source: v.source,
    prompt: v.prompt,
    note: v.note,
    dimensions: { x: v.dimX, y: v.dimY, z: v.dimZ },
    triangles: v.triangles,
    hasPreview: !!v.previewKey,
    report: v.report ?? null,
    settings: v.settings ?? null,
    createdAt: v.createdAt.toISOString(),
    isCurrent: v.id === currentId,
  };
}

/** Stores mesh as binary STL, runs the printability check and records a new immutable version. */
export async function createVersion(input: NewVersion) {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();
  if (!project) throw new Error("Project not found");
  let model = db.select().from(models).where(eq(models.projectId, project.id)).get();
  if (!model) {
    const kind = input.source === "upload" ? "uploaded" : input.source === "design" ? "designed" : "reconstructed";
    model = { id: newId("m_"), projectId: project.id, kind, provider: input.provider ?? null, createdAt: new Date() };
    db.insert(models).values(model).run();
  }
  const last = db.select({ n: modelVersions.number }).from(modelVersions).where(eq(modelVersions.projectId, project.id)).orderBy(desc(modelVersions.number)).limit(1).get();
  const number = (last?.n ?? 0) + 1;
  const d = dimensions(input.mesh);
  const settings = project.printSettings ?? {};
  const report = checkPrintability(input.mesh, settings);
  const key = `${project.storagePrefix}models/model-v${number}.stl`;
  await getStorage().put(key, writeBinaryStl(input.mesh, `Nelis3D ${project.name} v${number}`));
  const id = newId("v_");
  const parent = input.parentVersionId ?? project.currentVersionId ?? null;
  db.insert(modelVersions)
    .values({
      id,
      modelId: model.id,
      projectId: project.id,
      number,
      parentVersionId: parent,
      source: input.source,
      prompt: input.prompt ?? null,
      note: input.note ?? null,
      storageKey: key,
      dimX: d.x,
      dimY: d.y,
      dimZ: d.z,
      triangles: input.mesh.indices.length / 3,
      settings,
      report,
    })
    .run();
  if (input.makeCurrent !== false) {
    db.update(projects).set({ currentVersionId: id, updatedAt: new Date() }).where(eq(projects.id, project.id)).run();
  }
  return db.select().from(modelVersions).where(eq(modelVersions.id, id)).get()!;
}

export function getVersion(projectId: string, versionId: string) {
  return getDb().select().from(modelVersions).where(and(eq(modelVersions.id, versionId), eq(modelVersions.projectId, projectId))).get();
}

export async function loadVersionMesh(v: { storageKey: string }): Promise<Mesh> {
  return parseStl(await getStorage().get(v.storageKey));
}

export function activateVersion(projectId: string, versionId: string) {
  const v = getVersion(projectId, versionId);
  if (!v) throw new Error("Version not found");
  getDb().update(projects).set({ currentVersionId: v.id, updatedAt: new Date() }).where(eq(projects.id, projectId)).run();
  return v;
}

export async function saveVersionPreview(projectId: string, versionId: string, png: Buffer) {
  const v = getVersion(projectId, versionId);
  if (!v) throw new Error("Version not found");
  const p = getDb().select().from(projects).where(eq(projects.id, projectId)).get()!;
  const key = `${p.storagePrefix}models/previews/model-v${v.number}.png`;
  await getStorage().put(key, png);
  getDb().update(modelVersions).set({ previewKey: key }).where(eq(modelVersions.id, v.id)).run();
}

/** Resize the bounding box (X/Y/Z in mm) → new version. */
export async function resizeVersion(projectId: string, versionId: string, target: { x?: number; y?: number; z?: number }, uniform: boolean, prompt?: string) {
  const v = getVersion(projectId, versionId);
  if (!v) throw new Error("Version not found");
  const mesh = await loadVersionMesh(v);
  const resized = resizeMesh(mesh, target, uniform);
  const d = dimensions(resized);
  return createVersion({
    projectId,
    mesh: resized,
    source: "resize",
    parentVersionId: v.id,
    prompt: prompt ?? `Resize to ${d.x.toFixed(1)} × ${d.y.toFixed(1)} × ${d.z.toFixed(1)} mm`,
  });
}

export async function repairVersion(projectId: string, versionId: string) {
  const v = getVersion(projectId, versionId);
  if (!v) throw new Error("Version not found");
  const { mesh, actions } = repairMesh(await loadVersionMesh(v));
  return createVersion({ projectId, mesh, source: "repair", parentVersionId: v.id, prompt: "Automatic mesh repair", note: actions.join("; ") || "No changes were necessary" });
}

export async function orientVersion(projectId: string, versionId: string, rotation: [number, number, number], label?: string) {
  const v = getVersion(projectId, versionId);
  if (!v) throw new Error("Version not found");
  const mesh = placeOnBed(rotateMesh(await loadVersionMesh(v), ...rotation));
  return createVersion({ projectId, mesh, source: "orient", parentVersionId: v.id, prompt: `Print orientation: ${label ?? rotation.join("/")}` });
}

/** Re-run the print check for a version with new settings (material etc.) and store it. */
export async function recheckVersion(projectId: string, versionId: string, settings: Partial<PrintSettings>) {
  const v = getVersion(projectId, versionId);
  if (!v) throw new Error("Version not found");
  const mesh = await loadVersionMesh(v);
  const report = checkPrintability(mesh, settings);
  getDb().update(modelVersions).set({ report, settings: resolveProfile(settings).settings }).where(eq(modelVersions.id, v.id)).run();
  return report;
}
