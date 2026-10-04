import { api } from "../client";

/** Downscale a photo in the browser (max 1600 px JPEG). Falls back to the original if the browser can't decode it (e.g. HEIC in Chrome). */
export async function shrinkImage(file: Blob, name = "photo.jpg", maxSide = 1600): Promise<File> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.88));
    if (out) return new File([out], name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    /* not decodable here – send as is */
  }
  return file instanceof File ? file : new File([file], name);
}

const BATCH_BYTES = 3_200_000; // stays under the ~4.5 MB serverless request limit incl. multipart overhead

/** Uploads photos to a project in size-limited batches; the last batch starts the AI analysis. */
export async function uploadPhotos(projectId: string, files: File[], source: "camera" | "upload", onProgress?: (done: number, total: number) => void) {
  const shrunk: File[] = [];
  for (const f of files) shrunk.push(await shrinkImage(f, f.name));
  const batches: File[][] = [];
  let cur: File[] = [], size = 0;
  for (const f of shrunk) {
    if (f.size > BATCH_BYTES) throw new Error(`“${f.name}” is too large to upload (${(f.size / 1e6).toFixed(1)} MB).`);
    if (size + f.size > BATCH_BYTES && cur.length) { batches.push(cur); cur = []; size = 0; }
    cur.push(f); size += f.size;
  }
  if (cur.length) batches.push(cur);
  let done = 0;
  for (let i = 0; i < batches.length; i++) {
    const fd = new FormData();
    batches[i].forEach((f) => fd.append("files", f));
    fd.append("source", source);
    if (i === batches.length - 1) fd.append("finalize", "1");
    await api(`/api/projects/${projectId}/images`, { method: "POST", body: fd });
    done += batches[i].length;
    onProgress?.(done, shrunk.length);
  }
}

/** Creates an empty project and returns its id. */
export async function createEmptyProject(name: string, mode: string): Promise<string> {
  const fd = new FormData();
  fd.append("name", name);
  fd.append("mode", mode);
  return (await api<{ id: string }>("/api/projects", { method: "POST", body: fd })).id;
}
