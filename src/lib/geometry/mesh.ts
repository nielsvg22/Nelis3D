/** Indexed triangle mesh, units = millimetres, Z-up (printer convention). */
export interface Mesh {
  positions: Float32Array; // x,y,z * vertexCount
  indices: Uint32Array; // 3 * triangleCount
}

export type Vec3 = [number, number, number];

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export interface Dimensions {
  x: number;
  y: number;
  z: number;
}

export const triangleCount = (m: Mesh) => m.indices.length / 3;
export const vertexCount = (m: Mesh) => m.positions.length / 3;

export function bounds(m: Mesh): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const p = m.positions;
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  if (p.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

export function dimensions(m: Mesh): Dimensions {
  const b = bounds(m);
  return { x: b.max[0] - b.min[0], y: b.max[1] - b.min[1], z: b.max[2] - b.min[2] };
}

/** Signed volume (mm³). Negative ⇒ inverted normals (for a closed mesh). */
export function signedVolume(m: Mesh): number {
  const p = m.positions;
  const idx = m.indices;
  let v = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    v +=
      (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
      6;
  }
  return v;
}

export function surfaceArea(m: Mesh): number {
  const p = m.positions;
  const idx = m.indices;
  let area = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    area += 0.5 * Math.hypot(cx, cy, cz);
  }
  return area;
}

export function cloneMesh(m: Mesh): Mesh {
  return { positions: new Float32Array(m.positions), indices: new Uint32Array(m.indices) };
}

export function flipWinding(m: Mesh): Mesh {
  const out = cloneMesh(m);
  for (let i = 0; i < out.indices.length; i += 3) {
    const t = out.indices[i + 1];
    out.indices[i + 1] = out.indices[i + 2];
    out.indices[i + 2] = t;
  }
  return out;
}

/** Non-uniform scale about the origin. A negative factor mirrors and re-flips winding. */
export function scaleMesh(m: Mesh, sx: number, sy: number, sz: number): Mesh {
  const out = cloneMesh(m);
  for (let i = 0; i < out.positions.length; i += 3) {
    out.positions[i] *= sx;
    out.positions[i + 1] *= sy;
    out.positions[i + 2] *= sz;
  }
  return sx * sy * sz < 0 ? flipWinding(out) : out;
}

export function translateMesh(m: Mesh, dx: number, dy: number, dz: number): Mesh {
  const out = cloneMesh(m);
  for (let i = 0; i < out.positions.length; i += 3) {
    out.positions[i] += dx;
    out.positions[i + 1] += dy;
    out.positions[i + 2] += dz;
  }
  return out;
}

/** Rotate by Euler degrees (applied X, then Y, then Z). */
export function rotateMesh(m: Mesh, rxDeg: number, ryDeg: number, rzDeg: number): Mesh {
  const [rx, ry, rz] = [rxDeg, ryDeg, rzDeg].map((d) => (d * Math.PI) / 180);
  const out = cloneMesh(m);
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  const p = out.positions;
  for (let i = 0; i < p.length; i += 3) {
    let x = p[i], y = p[i + 1], z = p[i + 2];
    let t = y * cx - z * sx; z = y * sx + z * cx; y = t;
    t = x * cy + z * sy; z = -x * sy + z * cy; x = t;
    t = x * cz - y * sz; y = x * sz + y * cz; x = t;
    p[i] = x; p[i + 1] = y; p[i + 2] = z;
  }
  return out;
}

/** Centre in XY on the origin and drop the lowest point to z = 0. */
export function placeOnBed(m: Mesh): Mesh {
  const b = bounds(m);
  return translateMesh(m, -(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]);
}

/** Resize so the bounding box matches the requested size. Missing axes follow `uniform` if set. */
export function resizeMesh(
  m: Mesh,
  target: Partial<Dimensions>,
  uniform: boolean,
): Mesh {
  const d = dimensions(m);
  const f = (t: number | undefined, cur: number) => (t && cur > 1e-9 ? t / cur : undefined);
  const fx = f(target.x, d.x), fy = f(target.y, d.y), fz = f(target.z, d.z);
  let sx = fx ?? 1, sy = fy ?? 1, sz = fz ?? 1;
  if (uniform) {
    const s = fx ?? fy ?? fz ?? 1;
    sx = sy = sz = s;
  }
  const b0 = bounds(m);
  const scaled = scaleMesh(m, sx, sy, sz);
  // keep the min corner anchored so a resize does not teleport the object
  const b1 = bounds(scaled);
  return translateMesh(scaled, b0.min[0] - b1.min[0], b0.min[1] - b1.min[1], b0.min[2] - b1.min[2]);
}

/**
 * Weld duplicate vertices (needed for STL soup) and drop degenerate / duplicate-index triangles.
 * `tol` in mm.
 */
export function weld(positions: Float32Array, tol = 1e-4): Mesh {
  const n = positions.length / 3;
  const map = new Map<string, number>();
  const remap = new Uint32Array(n);
  const out: number[] = [];
  const inv = 1 / tol;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = out.length / 3;
      map.set(key, id);
      out.push(x, y, z);
    }
    remap[i] = id;
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i += 3) {
    const a = remap[i], b = remap[i + 1], c = remap[i + 2];
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  return { positions: new Float32Array(out), indices: new Uint32Array(idx) };
}

export function assertValidMesh(m: Mesh): void {
  if (m.indices.length === 0 || m.positions.length === 0) throw new Error("Mesh is empty");
  const n = m.positions.length / 3;
  for (let i = 0; i < m.indices.length; i++) {
    if (m.indices[i] >= n) throw new Error("Mesh has out-of-range vertex indices");
  }
  for (let i = 0; i < m.positions.length; i++) {
    if (!Number.isFinite(m.positions[i])) throw new Error("Mesh contains NaN/Infinity coordinates");
  }
}
