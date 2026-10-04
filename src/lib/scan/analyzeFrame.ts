/** Cheap, on-device frame analysis used for live scan feedback (no network, no AI). */
export interface FrameStats {
  brightness: number; // 0..255
  sharpness: number; // variance of the Laplacian (focus measure)
  motion: number; // mean abs diff vs previous analysed frame
  centerEdges: number; // edge density in the middle 50 %
  borderEdges: number; // edge density in the outer ring
  gray: Uint8ClampedArray;
}

export const GRID = 96;

export function analyzeFrame(video: HTMLVideoElement, ctx: CanvasRenderingContext2D, prev: Uint8ClampedArray | null): FrameStats {
  const vw = video.videoWidth, vh = video.videoHeight;
  const w = GRID, h = Math.round((GRID * vh) / vw) || GRID;
  ctx.canvas.width = w;
  ctx.canvas.height = h;
  ctx.drawImage(video, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Uint8ClampedArray(w * h);
  let sum = 0;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[j] = g;
    sum += g;
  }
  let lapSum = 0, lapSq = 0, n = 0, cEdge = 0, cN = 0, bEdge = 0, bN = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      lapSum += lap; lapSq += lap * lap; n++;
      const edge = Math.abs(gray[i + 1] - gray[i - 1]) + Math.abs(gray[i + w] - gray[i - w]) > 40 ? 1 : 0;
      const inCenter = x > w * 0.25 && x < w * 0.75 && y > h * 0.25 && y < h * 0.75;
      if (inCenter) { cEdge += edge; cN++; } else { bEdge += edge; bN++; }
    }
  }
  let motion = 0;
  if (prev && prev.length === gray.length) {
    for (let i = 0; i < gray.length; i++) motion += Math.abs(gray[i] - prev[i]);
    motion /= gray.length;
  }
  return { brightness: sum / gray.length, sharpness: lapSq / n - (lapSum / n) ** 2, motion, centerEdges: cEdge / Math.max(1, cN), borderEdges: bEdge / Math.max(1, bN), gray };
}

export function meanDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length) return 99;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

export type Feedback = { id: string; level: "info" | "warn" | "bad"; text: string };

export function feedbackFor(
  s: FrameStats,
  c: { captured: number; sectors: number; hasHeading: boolean; msSinceStart: number; noveltyLow: boolean },
): Feedback[] {
  const f: Feedback[] = [];
  if (s.brightness < 55) f.push({ id: "dark", level: "bad", text: "Too dark – add light or turn on a lamp." });
  else if (s.brightness > 225) f.push({ id: "bright", level: "warn", text: "Overexposed – avoid direct light and glare." });

  if (s.motion > 22) f.push({ id: "fast", level: "bad", text: "Moving too fast – go slower." });
  else if (s.sharpness < 18 && s.brightness >= 55) f.push({ id: "blur", level: "warn", text: "Image is blurry – hold steady or step back." });

  const sharpEnough = s.sharpness >= 18 && s.brightness >= 55;
  // Edges everywhere, including the outer ring ⇒ either the object fills the frame or the background is cluttered.
  if (sharpEnough && s.borderEdges > 0.3) {
    f.push(
      s.centerEdges > 0.3
        ? { id: "close", level: "warn", text: "Too close – step back until the whole object is in view." }
        : { id: "busy", level: "warn", text: "Background looks busy – use a plain surface behind the object." },
    );
  }
  if (s.centerEdges < 0.02 && s.borderEdges < 0.02 && s.brightness >= 55) f.push({ id: "empty", level: "info", text: "Point the camera at the object." });
  if (c.captured >= 6 && c.noveltyLow && c.msSinceStart > 12_000) f.push({ id: "angles", level: "info", text: "Too few new angles – walk further around the object." });
  if (c.hasHeading && c.captured >= 10 && c.sectors < 5) f.push({ id: "sectors", level: "info", text: "Parts of the object are still missing – keep circling." });
  return f.slice(0, 3);
}
