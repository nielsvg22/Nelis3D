import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { type Mesh, bounds, weld } from "../mesh";

export interface ThreeMfMeta {
  title: string;
  designer?: string;
  description?: string;
  /** extra key/value pairs stored as <metadata> (e.g. printer profile hints) */
  extra?: Record<string, string>;
  /** place the object centred at this XY on the bed (mm). Defaults to origin. */
  bedCenter?: { x: number; y: number };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Standards-compliant 3MF core (unit = millimetre). Opens in Creality Print / Orca / Bambu Studio / PrusaSlicer.
 * The mesh is expected to already sit on z=0 (see placeOnBed); the build item transform centres it on the bed.
 */
export function write3mf(m: Mesh, meta: ThreeMfMeta): Uint8Array {
  const v: string[] = [];
  for (let i = 0; i < m.positions.length; i += 3) {
    v.push(`<vertex x="${+m.positions[i].toFixed(5)}" y="${+m.positions[i + 1].toFixed(5)}" z="${+m.positions[i + 2].toFixed(5)}"/>`);
  }
  const t: string[] = [];
  for (let i = 0; i < m.indices.length; i += 3) {
    t.push(`<triangle v1="${m.indices[i]}" v2="${m.indices[i + 1]}" v3="${m.indices[i + 2]}"/>`);
  }
  const b = bounds(m);
  const cx = meta.bedCenter?.x ?? 0;
  const cy = meta.bedCenter?.y ?? 0;
  const tx = cx - (b.min[0] + b.max[0]) / 2;
  const ty = cy - (b.min[1] + b.max[1]) / 2;
  const md = [
    `<metadata name="Title">${esc(meta.title)}</metadata>`,
    `<metadata name="Designer">${esc(meta.designer ?? "Nelis3D")}</metadata>`,
    `<metadata name="Application">Nelis3D</metadata>`,
    ...(meta.description ? [`<metadata name="Description">${esc(meta.description)}</metadata>`] : []),
    ...Object.entries(meta.extra ?? {}).map(([k, val]) => `<metadata name="${esc(k)}">${esc(val)}</metadata>`),
  ].join("");
  const model =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    md +
    `<resources><object id="1" type="model" name="${esc(meta.title)}"><mesh><vertices>${v.join("")}</vertices><triangles>${t.join("")}</triangles></mesh></object></resources>` +
    `<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 ${tx.toFixed(4)} ${ty.toFixed(4)} 0"/></build></model>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  const types =
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  return zipSync({
    "[Content_Types].xml": strToU8(types),
    "_rels/.rels": strToU8(rels),
    "3D/3dmodel.model": strToU8(model),
  });
}

interface ObjDef {
  mesh?: { pos: number[]; idx: number[] };
  components: { path?: string; id: string; tf: number[] }[];
}

const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const parseTf = (s?: string): number[] => {
  const a = s ? s.trim().split(/\s+/).map(Number) : [];
  return a.length === 12 && a.every(Number.isFinite) ? a : IDENT;
};
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

/** Reads meshes from a 3MF, honouring build/component transforms (incl. Bambu/Orca/Creality multi-file layout). */
export function parse3mf(data: Uint8Array): Mesh {
  const files = unzipSync(data);
  const modelPaths = Object.keys(files).filter((p) => p.toLowerCase().endsWith(".model"));
  if (modelPaths.length === 0) throw new Error("3MF contains no model part");
  const defs = new Map<string, ObjDef>();
  const mainPath = modelPaths.find((p) => /3D\/3dmodel\.model$/i.test(p)) ?? modelPaths[0];

  for (const path of modelPaths) {
    const xml = strFromU8(files[path]);
    const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
    let om: RegExpExecArray | null;
    while ((om = objRe.exec(xml))) {
      const id = attr(om[1], "id");
      if (!id) continue;
      const body = om[2];
      const def: ObjDef = { components: [] };
      const meshM = /<mesh>([\s\S]*?)<\/mesh>/.exec(body);
      if (meshM) {
        const pos: number[] = [];
        const idx: number[] = [];
        for (const vm of meshM[1].matchAll(/<vertex\b([^>]*)\/?>/g)) {
          pos.push(+attr(vm[1], "x")!, +attr(vm[1], "y")!, +attr(vm[1], "z")!);
        }
        for (const tm of meshM[1].matchAll(/<triangle\b([^>]*)\/?>/g)) {
          idx.push(+attr(tm[1], "v1")!, +attr(tm[1], "v2")!, +attr(tm[1], "v3")!);
        }
        def.mesh = { pos, idx };
      }
      for (const cm of body.matchAll(/<component\b([^>]*)\/?>/g)) {
        def.components.push({
          id: attr(cm[1], "objectid")!,
          path: attr(cm[1], "p:path") ?? attr(cm[1], "path"),
          tf: parseTf(attr(cm[1], "transform")),
        });
      }
      defs.set(`${path}#${id}`, def);
    }
  }

  const outPos: number[] = [];
  const outIdx: number[] = [];
  const apply = (tf: number[], x: number, y: number, z: number): [number, number, number] => [
    tf[0] * x + tf[3] * y + tf[6] * z + tf[9],
    tf[1] * x + tf[4] * y + tf[7] * z + tf[10],
    tf[2] * x + tf[5] * y + tf[8] * z + tf[11],
  ];
  const mul = (a: number[], b: number[]): number[] => {
    // apply b first, then a (row-vector convention used by 3MF)
    const r = new Array(12).fill(0);
    for (let c = 0; c < 3; c++) {
      for (let k = 0; k < 3; k++) r[k * 3 + c] = b[k * 3] * a[c] + b[k * 3 + 1] * a[3 + c] + b[k * 3 + 2] * a[6 + c];
      r[9 + c] = b[9] * a[c] + b[10] * a[3 + c] + b[11] * a[6 + c] + a[9 + c];
    }
    return r;
  };
  const emit = (path: string, id: string, tf: number[], depth: number) => {
    if (depth > 8) return;
    const def = defs.get(`${path}#${id}`);
    if (!def) return;
    if (def.mesh) {
      const base = outPos.length / 3;
      for (let i = 0; i < def.mesh.pos.length; i += 3) {
        outPos.push(...apply(tf, def.mesh.pos[i], def.mesh.pos[i + 1], def.mesh.pos[i + 2]));
      }
      for (const i of def.mesh.idx) outIdx.push(base + i);
    }
    for (const c of def.components) {
      const p = c.path ? c.path.replace(/^\//, "") : path;
      emit(p, c.id, mul(tf, c.tf), depth + 1);
    }
  };

  const mainXml = strFromU8(files[mainPath]);
  const items = [...mainXml.matchAll(/<item\b([^>]*)\/?>/g)];
  if (items.length) {
    for (const it of items) emit(mainPath, attr(it[1], "objectid")!, parseTf(attr(it[1], "transform")), 0);
  } else {
    for (const key of defs.keys()) if (defs.get(key)!.mesh) emit(key.split("#")[0], key.split("#")[1], IDENT, 0);
  }
  if (outPos.length === 0) throw new Error("3MF contains no mesh data");
  const pos = new Float32Array(outPos);
  const idx = new Uint32Array(outIdx);
  // weld by position so shared edges between separate objects/triangles connect
  const soup = new Float32Array(idx.length * 3);
  for (let i = 0; i < idx.length; i++) {
    soup[i * 3] = pos[idx[i] * 3];
    soup[i * 3 + 1] = pos[idx[i] * 3 + 1];
    soup[i * 3 + 2] = pos[idx[i] * 3 + 2];
  }
  return weld(soup);
}
