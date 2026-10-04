import { and, asc, eq } from "drizzle-orm";
import { first, getDb, schema } from "../db/client";
import { newId } from "../ids";
import { preprocessImage } from "../pipeline/preprocess";
import { getStorage } from "../storage";
import type { AiImage } from "../ai/types";

const { scans, scanImages, projects } = schema;

/** Preprocess + store photos. Creates a scan on first use. */
export async function addScanImages(projectId: string, files: Buffer[], source: "camera" | "upload") {
  const db = await getDb();
  const p = await first(db.select().from(projects).where(eq(projects.id, projectId)));
  if (!p) throw new Error("Project not found");
  let scan = await first(db.select().from(scans).where(eq(scans.projectId, projectId)).limit(1));
  if (!scan) {
    scan = { id: newId("s_"), projectId, source, createdAt: new Date() };
    await db.insert(scans).values(scan);
  }
  const existing = await db.select({ position: scanImages.position }).from(scanImages).where(eq(scanImages.projectId, projectId));
  let pos = existing.reduce((m, r) => Math.max(m, r.position), 0);
  const storage = getStorage();
  const results: { id: string; issues: string[] }[] = [];
  const failed: number[] = [];
  for (let i = 0; i < files.length; i++) {
    try {
      const pre = await preprocessImage(files[i]);
      pos++;
      const n = String(pos).padStart(4, "0");
      const key = `${p.storagePrefix}scan/images/${n}.jpg`;
      const thumbKey = `${p.storagePrefix}scan/images/thumbs/${n}.jpg`;
      await storage.put(key, pre.full);
      await storage.put(thumbKey, pre.thumb);
      const id = newId("img_");
      await db.insert(scanImages).values({ id, scanId: scan.id, projectId, position: pos, storageKey: key, thumbKey, included: true, quality: pre.quality });
      results.push({ id, issues: pre.quality.issues });
    } catch {
      failed.push(i);
    }
  }
  await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
  return { added: results.length, failed: failed.length, images: results };
}

/** Images selected by the user, evenly sub-sampled to `max` for AI calls. */
export async function loadIncludedImages(projectId: string, max = 8): Promise<AiImage[]> {
  const rows = (await (await getDb()).select().from(scanImages).where(eq(scanImages.projectId, projectId)).orderBy(asc(scanImages.position))).filter((r) => r.included);
  const picked = rows.length <= max ? rows : Array.from({ length: max }, (_, i) => rows[Math.round((i * (rows.length - 1)) / (max - 1))]);
  const storage = getStorage();
  return Promise.all(picked.map(async (r) => ({ id: r.id, mediaType: "image/jpeg" as const, data: await storage.get(r.storageKey) })));
}

/** Sharpest frames first, but keep angular spread (positions are chronological = roughly angular for a walk-around). */
export async function loadReconstructionImages(projectId: string, max = 4): Promise<AiImage[]> {
  const rows = (await (await getDb()).select().from(scanImages).where(eq(scanImages.projectId, projectId)).orderBy(asc(scanImages.position))).filter((r) => r.included);
  if (rows.length === 0) return [];
  const n = Math.min(max, rows.length);
  const bucketSize = rows.length / n;
  const picked = Array.from({ length: n }, (_, b) => {
    const bucket = rows.slice(Math.floor(b * bucketSize), Math.max(Math.floor(b * bucketSize) + 1, Math.floor((b + 1) * bucketSize)));
    return bucket.reduce((best, r) => ((r.quality?.sharpness ?? 0) > (best.quality?.sharpness ?? 0) ? r : best), bucket[0]);
  });
  const storage = getStorage();
  return Promise.all(picked.map(async (r) => ({ id: r.id, mediaType: "image/jpeg" as const, data: await storage.get(r.storageKey) })));
}

export async function setImageIncluded(projectId: string, imageId: string, included: boolean) {
  await (await getDb()).update(scanImages).set({ included }).where(and(eq(scanImages.id, imageId), eq(scanImages.projectId, projectId)));
}

export async function deleteImage(projectId: string, imageId: string) {
  const db = await getDb();
  const row = await first(db.select().from(scanImages).where(eq(scanImages.id, imageId)));
  if (!row || row.projectId !== projectId) return;
  const storage = getStorage();
  await storage.delete(row.storageKey);
  await storage.delete(row.thumbKey);
  await db.delete(scanImages).where(eq(scanImages.id, imageId));
}
