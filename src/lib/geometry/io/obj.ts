import type { Mesh } from "../mesh";

/** Minimal Wavefront OBJ reader: geometry only (v / f), polygons are fan-triangulated. */
export function parseObj(text: string): Mesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("v ")) {
      const [, x, y, z] = line.split(/\s+/);
      pos.push(+x, +y, +z);
    } else if (line.startsWith("f ")) {
      const n = pos.length / 3;
      const face = line
        .slice(2)
        .trim()
        .split(/\s+/)
        .map((tok) => {
          const i = parseInt(tok.split("/")[0], 10);
          return i < 0 ? n + i : i - 1;
        });
      for (let k = 1; k < face.length - 1; k++) idx.push(face[0], face[k], face[k + 1]);
    }
  }
  if (pos.length === 0 || idx.length === 0) throw new Error("OBJ contains no geometry");
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}
