import { type Mesh, weld } from "../mesh";

export function writeBinaryStl(m: Mesh, header = "Nelis3D"): Uint8Array {
  const tri = m.indices.length / 3;
  const buf = new ArrayBuffer(84 + tri * 50);
  const dv = new DataView(buf);
  for (let i = 0; i < Math.min(header.length, 80); i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, tri, true);
  const p = m.positions;
  let o = 84;
  for (let t = 0; t < tri; t++) {
    const a = m.indices[t * 3] * 3, b = m.indices[t * 3 + 1] * 3, c = m.indices[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    o += 12;
    for (const k of [a, b, c]) {
      dv.setFloat32(o, p[k], true); dv.setFloat32(o + 4, p[k + 1], true); dv.setFloat32(o + 8, p[k + 2], true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return new Uint8Array(buf);
}

export function parseStl(data: Uint8Array): Mesh {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.byteLength >= 84) {
    const tri = dv.getUint32(80, true);
    if (84 + tri * 50 === data.byteLength) return parseBinary(dv, tri);
  }
  const text = new TextDecoder().decode(data);
  if (/^\s*solid/i.test(text) && /facet\s+normal/i.test(text)) return parseAscii(text);
  if (data.byteLength >= 84) {
    // some exporters write a wrong/padded size – trust the count if it fits
    const tri = dv.getUint32(80, true);
    if (84 + tri * 50 <= data.byteLength) return parseBinary(dv, tri);
  }
  throw new Error("Not a valid STL file");
}

function parseBinary(dv: DataView, tri: number): Mesh {
  const pos = new Float32Array(tri * 9);
  let o = 84;
  for (let t = 0; t < tri; t++) {
    o += 12;
    for (let k = 0; k < 9; k++) {
      pos[t * 9 + k] = dv.getFloat32(o, true);
      o += 4;
    }
    o += 2;
  }
  return weld(pos);
}

function parseAscii(text: string): Mesh {
  const out: number[] = [];
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3]);
  if (out.length === 0 || (out.length / 3) % 3 !== 0) throw new Error("Malformed ASCII STL");
  return weld(new Float32Array(out));
}
