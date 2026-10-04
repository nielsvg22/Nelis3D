import sharp from "sharp";
import type { ImageQuality } from "../db/schema";

/**
 * Stage 1 of the pipeline – image preprocessing:
 *  • apply EXIF rotation, then strip ALL metadata (GPS, device info) → privacy
 *  • downscale to ≤1600 px JPEG for AI/reconstruction, 360 px thumbnail for the UI
 *  • score sharpness + exposure so the UI can warn about unusable frames
 */
export interface Preprocessed {
  full: Buffer;
  thumb: Buffer;
  quality: ImageQuality;
}

export async function preprocessImage(input: Buffer): Promise<Preprocessed> {
  const base = sharp(input, { failOn: "none" }).rotate();
  const full = await base.clone().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  const thumb = await sharp(full).resize(360, 360, { fit: "inside" }).jpeg({ quality: 72 }).toBuffer();
  const meta = await sharp(full).metadata();

  const S = 256;
  const { data, info } = await sharp(full).greyscale().resize(S, S, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  let mean = 0;
  for (let i = 0; i < data.length; i++) mean += data[i];
  mean /= data.length;
  // variance of the Laplacian = standard focus measure
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - w] - data[i + w];
      sum += lap;
      sum2 += lap * lap;
      n++;
    }
  }
  const sharpness = n ? sum2 / n - (sum / n) ** 2 : 0;

  const issues: string[] = [];
  if (sharpness < 25) issues.push("blurry");
  if (mean < 55) issues.push("too dark");
  if (mean > 220) issues.push("overexposed");
  if ((meta.width ?? 0) < 640 && (meta.height ?? 0) < 640) issues.push("low resolution");
  return { full, thumb, quality: { sharpness: Math.round(sharpness), brightness: Math.round(mean), width: meta.width ?? 0, height: meta.height ?? 0, issues } };
}
