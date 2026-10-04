import { eq } from "drizzle-orm";
import { route, ownedProject, HttpError } from "@/lib/api";
import { getDb, schema } from "@/lib/db/client";
import { getStorage } from "@/lib/storage";

export const GET = route<{ id: string; imageId: string }>(async (req, { user, params }) => {
  ownedProject(user, params.id);
  const img = getDb().select().from(schema.scanImages).where(eq(schema.scanImages.id, params.imageId)).get();
  if (!img || img.projectId !== params.id) throw new HttpError(404, "Image not found");
  const full = new URL(req.url).searchParams.get("size") === "full";
  const buf = await getStorage().get(full ? img.storageKey : img.thumbKey);
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
});
