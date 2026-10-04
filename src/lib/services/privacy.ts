import { eq, lt } from "drizzle-orm";
import { first, getDb, schema } from "../db/client";
import { getStorage } from "../storage";

/** Deletes scan photos older than `hours` for projects that already have a model. */
export async function purgeExpiredScanImages(hours: number) {
  const db = await getDb();
  const cutoff = new Date(Date.now() - hours * 3600_000);
  const rows = await db.select().from(schema.scanImages).where(lt(schema.scanImages.createdAt, cutoff));
  const storage = getStorage();
  for (const r of rows) {
    const hasModel = await first(db.select({ id: schema.modelVersions.id }).from(schema.modelVersions).where(eq(schema.modelVersions.projectId, r.projectId)).limit(1));
    if (!hasModel) continue; // keep photos until a model exists
    await storage.delete(r.storageKey);
    await storage.delete(r.thumbKey);
    await db.delete(schema.scanImages).where(eq(schema.scanImages.id, r.id));
  }
}
