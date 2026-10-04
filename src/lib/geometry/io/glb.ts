import { type Mesh } from "../mesh";

/** Minimal GLB reader (geometry only, no Draco/meshopt). Applies node translation/scale/matrix transforms. */
export function parseGlb(data: Uint8Array): Mesh {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("Not a GLB file");
  let off = 12;
  let json: any = null;
  let bin: Uint8Array | null = null;
  while (off < data.byteLength) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const chunk = data.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942 && !bin) bin = chunk;
    off += 8 + len;
  }
  if (!json || !bin) throw new Error("GLB has no geometry buffer");
  const comp: Record<number, { n: number; get: (dv: DataView, o: number) => number }> = {
    5126: { n: 4, get: (d, o) => d.getFloat32(o, true) },
    5125: { n: 4, get: (d, o) => d.getUint32(o, true) },
    5123: { n: 2, get: (d, o) => d.getUint16(o, true) },
    5121: { n: 1, get: (d, o) => d.getUint8(o) },
  };
  const binDv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const readAccessor = (ai: number): number[] => {
    const acc = json.accessors[ai];
    const bv = json.bufferViews[acc.bufferView];
    const c = comp[acc.componentType];
    const nc = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type as string] ?? 1;
    const stride = bv.byteStride || c.n * nc;
    const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const out: number[] = [];
    for (let i = 0; i < acc.count; i++) for (let k = 0; k < nc; k++) out.push(c.get(binDv, base + i * stride + k * c.n));
    return out;
  };
  const pos: number[] = [];
  const idx: number[] = [];
  const emitMesh = (mi: number, m: number[]) => {
    for (const prim of json.meshes[mi].primitives) {
      if (prim.mode !== undefined && prim.mode !== 4) continue;
      const p = readAccessor(prim.attributes.POSITION);
      const base = pos.length / 3;
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i], y = p[i + 1], z = p[i + 2];
        pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
      }
      const ind = prim.indices !== undefined ? readAccessor(prim.indices) : Array.from({ length: p.length / 3 }, (_, i) => i);
      for (const i of ind) idx.push(base + i);
    }
  };
  const mul = (a: number[], b: number[]) => {
    const r = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) for (let k = 0; k < 4; k++) r[c * 4 + rr] += a[k * 4 + rr] * b[c * 4 + k];
    return r;
  };
  const local = (n: any): number[] => {
    if (n.matrix) return n.matrix;
    const [qx, qy, qz, qw] = n.rotation ?? [0, 0, 0, 1];
    const [sx, sy, sz] = n.scale ?? [1, 1, 1];
    const [tx, ty, tz] = n.translation ?? [0, 0, 0];
    return [
      (1 - 2 * (qy * qy + qz * qz)) * sx, 2 * (qx * qy + qz * qw) * sx, 2 * (qx * qz - qy * qw) * sx, 0,
      2 * (qx * qy - qz * qw) * sy, (1 - 2 * (qx * qx + qz * qz)) * sy, 2 * (qy * qz + qx * qw) * sy, 0,
      2 * (qx * qz + qy * qw) * sz, 2 * (qy * qz - qx * qw) * sz, (1 - 2 * (qx * qx + qy * qy)) * sz, 0,
      tx, ty, tz, 1,
    ];
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const walk = (ni: number, parent: number[], depth = 0) => {
    if (depth > 32) return;
    const n = json.nodes[ni];
    const m = mul(parent, local(n));
    if (n.mesh !== undefined) emitMesh(n.mesh, m);
    for (const c of n.children ?? []) walk(c, m, depth + 1);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  if (scene) for (const n of scene.nodes) walk(n, I);
  else json.meshes.forEach((_: unknown, i: number) => emitMesh(i, I));
  if (!pos.length) throw new Error("GLB has no triangle geometry");
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}
