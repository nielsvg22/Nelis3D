import { eq, lt } from "drizzle-orm";
import { getDb, schema } from "../db/client";
import { getStorage } from "../storage";

/** Deletes scan photos of projects whose newest model version is older than `hours`. */
export async function purgeExpiredScanImages(hours: number) {
  const db = getDb();
  const cutoff = new Date(Date.now() - hours * 3600_000);
  const rows = db.select().from(schema.scanImages).where(lt(schema.scanImages.createdAt, cutoff)).all();
  const storage = getStorage();
  for (const r of rows) {
    const hasModel = db.select({ id: schema.modelVersions.id }).from(schema.modelVersions).where(eq(schema.modelVersions.projectId, r.projectId)).get();
    if (!hasModel) continue; // keep photos until a model exists
    await storage.delete(r.storageKey);
    await storage.delete(r.thumbKey);
    db.delete(schema.scanImages).where(eq(schema.scanImages.id, r.id)).run();
  }
}
