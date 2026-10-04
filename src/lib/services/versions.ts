import { and, desc, eq } from "drizzle-orm";
import { first, getDb, schema } from "../db/client";
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
  const db = await getDb();
  const project = await first(db.select().from(projects).where(eq(projects.id, input.projectId)));
  if (!project) throw new Error("Project not found");
  let model = await first(db.select().from(models).where(eq(models.projectId, project.id)).limit(1));
  if (!model) {
    const kind = input.source === "upload" ? "uploaded" : input.source === "design" ? "designed" : "reconstructed";
    model = { id: newId("m_"), projectId: project.id, kind, provider: input.provider ?? null, createdAt: new Date() };
    await db.insert(models).values(model);
  }
  const last = await first(db.select({ n: modelVersions.number }).from(modelVersions).where(eq(modelVersions.projectId, project.id)).orderBy(desc(modelVersions.number)).limit(1));
  const number = (last?.n ?? 0) + 1;
  const d = dimensions(input.mesh);
  const settings = project.printSettings ?? {};
  const report = checkPrintability(input.mesh, settings);
  const key = `${project.storagePrefix}models/model-v${number}.stl`;
  await getStorage().put(key, writeBinaryStl(input.mesh, `Nelis3D ${project.name} v${number}`));
  const id = newId("v_");
  const parent = input.parentVersionId ?? project.currentVersionId ?? null;
  await db.insert(modelVersions)
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
    });
  if (input.makeCurrent !== false) {
    await db.update(projects).set({ currentVersionId: id, updatedAt: new Date() }).where(eq(projects.id, project.id));
  }
  return (await first(db.select().from(modelVersions).where(eq(modelVersions.id, id))))!;
}

export async function getVersion(projectId: string, versionId: string) {
  return first((await getDb()).select().from(modelVersions).where(and(eq(modelVersions.id, versionId), eq(modelVersions.projectId, projectId))));
}

export async function loadVersionMesh(v: { storageKey: string }): Promise<Mesh> {
  return parseStl(await getStorage().get(v.storageKey));
}

export async function activateVersion(projectId: string, versionId: string) {
  const v = await getVersion(projectId, versionId);
  if (!v) throw new Error("Version not found");
  await (await getDb()).update(projects).set({ currentVersionId: v.id, updatedAt: new Date() }).where(eq(projects.id, projectId));
  return v;
}

export async function saveVersionPreview(projectId: string, versionId: string, png: Buffer) {
  const v = await getVersion(projectId, versionId);
  if (!v) throw new Error("Version not found");
  const p = (await first((await getDb()).select().from(projects).where(eq(projects.id, projectId))))!;
  const key = `${p.storagePrefix}models/previews/model-v${v.number}.png`;
  await getStorage().put(key, png);
  await (await getDb()).update(modelVersions).set({ previewKey: key }).where(eq(modelVersions.id, v.id));
}

/** Resize the bounding box (X/Y/Z in mm) → new version. */
export async function resizeVersion(projectId: string, versionId: string, target: { x?: number; y?: number; z?: number }, uniform: boolean, prompt?: string) {
  const v = await getVersion(projectId, versionId);
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
  const v = await getVersion(projectId, versionId);
  if (!v) throw new Error("Version not found");
  const { mesh, actions } = repairMesh(await loadVersionMesh(v));
  return createVersion({ projectId, mesh, source: "repair", parentVersionId: v.id, prompt: "Automatic mesh repair", note: actions.join("; ") || "No changes were necessary" });
}

export async function orientVersion(projectId: string, versionId: string, rotation: [number, number, number], label?: string) {
  const v = await getVersion(projectId, versionId);
  if (!v) throw new Error("Version not found");
  const mesh = placeOnBed(rotateMesh(await loadVersionMesh(v), ...rotation));
  return createVersion({ projectId, mesh, source: "orient", parentVersionId: v.id, prompt: `Print orientation: ${label ?? rotation.join("/")}` });
}

/** Re-run the print check for a version with new settings (material etc.) and store it. */
export async function recheckVersion(projectId: string, versionId: string, settings: Partial<PrintSettings>) {
  const v = await getVersion(projectId, versionId);
  if (!v) throw new Error("Version not found");
  const mesh = await loadVersionMesh(v);
  const report = checkPrintability(mesh, settings);
  await (await getDb()).update(modelVersions).set({ report, settings: resolveProfile(settings).settings }).where(eq(modelVersions.id, v.id));
  return report;
}
