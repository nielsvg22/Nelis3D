import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { type Dimensions, type Mesh, bounds, dimensions, rotateMesh, signedVolume, surfaceArea } from "./mesh";
import { type PrintSettings, resolveProfile } from "../printing/profiles";

export type CheckStatus = "ok" | "warn" | "fail" | "skipped";

export interface PrintCheck {
  id: string;
  status: CheckStatus;
  title: string;
  detail: string;
  /** machine-readable hint for UI actions */
  fix?: "repair" | "orient" | "scale-to-fit" | "thicken";
}

export interface OrientationOption {
  label: string;
  rotation: [number, number, number];
  overhangPercent: number;
  bedContactMm2: number;
  fits: boolean;
}

export interface PrintReport {
  level: "ok" | "warn" | "fail";
  summary: string;
  checks: PrintCheck[];
  stats: {
    triangles: number;
    vertices: number;
    dimensions: Dimensions;
    volumeMm3: number;
    surfaceMm2: number;
    estimatedMassG: number;
    components: number;
    minWallMm: number | null;
  };
  orientations: OrientationOption[];
  bestOrientation: OrientationOption;
  settings: PrintSettings;
  generatedAt: string;
}

const fmt = (n: number, d = 1) => n.toFixed(d);

interface Topology {
  boundaryEdges: number;
  nonManifoldEdges: number;
  inconsistentEdges: number;
  components: { tris: number; volume: number; size: Dimensions }[];
}

function analyseTopology(m: Mesh): Topology {
  const n = m.positions.length / 3;
  const tri = m.indices.length / 3;
  const edges = new Map<number, { fwd: number; back: number }>();
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let t = 0; t < tri; t++) {
    for (let k = 0; k < 3; k++) {
      const a = m.indices[t * 3 + k], b = m.indices[t * 3 + ((k + 1) % 3)];
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const key = lo * n + hi;
      let e = edges.get(key);
      if (!e) edges.set(key, (e = { fwd: 0, back: 0 }));
      if (a < b) e.fwd++;
      else e.back++;
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }
  }
  let boundaryEdges = 0, nonManifoldEdges = 0, inconsistentEdges = 0;
  for (const e of edges.values()) {
    const total = e.fwd + e.back;
    if (total === 1) boundaryEdges++;
    else if (total > 2) nonManifoldEdges++;
    else if (e.fwd === 2 || e.back === 2) inconsistentEdges++;
  }
  const comp = new Map<number, { idx: number[] }>();
  for (let t = 0; t < tri; t++) {
    const r = find(m.indices[t * 3]);
    let c = comp.get(r);
    if (!c) comp.set(r, (c = { idx: [] }));
    c.idx.push(m.indices[t * 3], m.indices[t * 3 + 1], m.indices[t * 3 + 2]);
  }
  const components = [...comp.values()].map((c) => {
    const sub: Mesh = { positions: m.positions, indices: new Uint32Array(c.idx) };
    return { tris: c.idx.length / 3, volume: signedVolume(sub), size: dimensions(sub) };
  });
  return { boundaryEdges, nonManifoldEdges, inconsistentEdges, components };
}

/** Overhang area (mm²) = downward-facing faces steeper than the limit that are not touching the bed. */
function overhangStats(m: Mesh, limitDeg: number) {
  const p = m.positions;
  const minZ = bounds(m).min[2];
  // A face needs support when its normal points more than (90° − limit) below the horizon: n.z < −sin(limit).
  const nzLimit = -Math.sin((limitDeg * Math.PI) / 180);
  let over = 0, contact = 0, total = 0;
  for (let i = 0; i < m.indices.length; i += 3) {
    const a = m.indices[i] * 3, b = m.indices[i + 1] * 3, c = m.indices[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) continue;
    const area = len / 2;
    total += area;
    const nzn = nz / len;
    if (nzn < nzLimit) {
      const zmax = Math.max(p[a + 2], p[b + 2], p[c + 2]);
      if (zmax - minZ < 0.15) contact += area;
      else over += area;
    }
  }
  return { overhangArea: over, contactArea: contact, totalArea: total };
}

const ORIENTATIONS: { label: string; rotation: [number, number, number] }[] = [
  { label: "As modelled", rotation: [0, 0, 0] },
  { label: "Flipped upside-down", rotation: [180, 0, 0] },
  { label: "On its front", rotation: [90, 0, 0] },
  { label: "On its back", rotation: [-90, 0, 0] },
  { label: "On its left side", rotation: [0, 90, 0] },
  { label: "On its right side", rotation: [0, -90, 0] },
];

export function evaluateOrientations(m: Mesh, settings: Partial<PrintSettings>): OrientationOption[] {
  const { printer, material } = resolveProfile(settings);
  const bv = printer.buildVolume;
  return ORIENTATIONS.map((o) => {
    const r = o.rotation.every((v) => v === 0) ? m : rotateMesh(m, ...o.rotation);
    const d = dimensions(r);
    const s = overhangStats(r, material.maxOverhangDeg);
    return {
      label: o.label,
      rotation: o.rotation,
      overhangPercent: s.totalArea ? (s.overhangArea / s.totalArea) * 100 : 0,
      bedContactMm2: s.contactArea,
      fits: d.x <= bv.x && d.y <= bv.y && d.z <= bv.z,
    };
  }).sort((a, b) => Number(b.fits) - Number(a.fits) || a.overhangPercent - b.overhangPercent || b.bedContactMm2 - a.bedContactMm2);
}

function toGeometry(m: Mesh) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  return g;
}

/** Estimates wall thickness by shooting rays inward from sampled surface points. */
function estimateWalls(m: Mesh, bvh: MeshBVH, samples: number) {
  const p = m.positions;
  const tri = m.indices.length / 3;
  const step = Math.max(1, Math.floor(tri / samples));
  const ray = new THREE.Ray();
  const dists: number[] = [];
  for (let t = 0; t < tri; t += step) {
    const a = m.indices[t * 3] * 3, b = m.indices[t * 3 + 1] * 3, c = m.indices[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) continue;
    nx /= l; ny /= l; nz /= l;
    const cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    ray.origin.set(cx - nx * 1e-3, cy - ny * 1e-3, cz - nz * 1e-3);
    ray.direction.set(-nx, -ny, -nz);
    const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
    if (hit) dists.push(hit.distance);
  }
  dists.sort((x, y) => x - y);
  return dists;
}

function countSelfIntersections(m: Mesh, bvh: MeshBVH, cap: number): number {
  let count = 0;
  const idx = m.indices;
  const shares = (i: number, j: number) => {
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (idx[i * 3 + a] === idx[j * 3 + b]) return true;
    return false;
  };
  const identity = new THREE.Matrix4();
  bvh.bvhcast(bvh, identity, {
    intersectsTriangles: (t1: any, t2: any, i1: number, i2: number) => {
      if (i1 >= i2 || shares(i1, i2)) return false;
      if (t1.intersectsTriangle(t2, undefined, true)) {
        count++;
        if (count >= cap) return true;
      }
      return false;
    },
  } as any);
  return count;
}

export function checkPrintability(mesh: Mesh, partial: Partial<PrintSettings> = {}): PrintReport {
  const { settings, printer, material } = resolveProfile(partial);
  const checks: PrintCheck[] = [];
  const dims = dimensions(mesh);
  const tri = mesh.indices.length / 3;
  const topo = analyseTopology(mesh);
  const vol = signedVolume(mesh);

  // --- manifold / holes ------------------------------------------------------
  if (topo.boundaryEdges === 0 && topo.nonManifoldEdges === 0) {
    checks.push({ id: "watertight", status: "ok", title: "Watertight", detail: "Every edge is shared by exactly two faces – the model is a closed solid." });
  } else {
    if (topo.boundaryEdges > 0) {
      checks.push({
        id: "holes",
        status: topo.boundaryEdges > 50 ? "fail" : "warn",
        title: "Open holes in the surface",
        detail: `${topo.boundaryEdges} open edges found. Slicers may fill these incorrectly or produce missing layers.`,
        fix: "repair",
      });
    }
    if (topo.nonManifoldEdges > 0) {
      checks.push({
        id: "non-manifold",
        status: "fail",
        title: "Non-manifold geometry",
        detail: `${topo.nonManifoldEdges} edges are shared by more than two faces, so the inside/outside is ambiguous.`,
        fix: "repair",
      });
    }
  }

  // --- normals ---------------------------------------------------------------
  if (topo.inconsistentEdges > 0) {
    checks.push({ id: "winding", status: "warn", title: "Inconsistent face orientation", detail: `${topo.inconsistentEdges} edges join faces that point in opposite directions.`, fix: "repair" });
  }
  if (vol < 0) {
    checks.push({ id: "normals", status: "fail", title: "Inverted normals", detail: "The model appears inside-out (negative volume). Slicers will treat it as empty.", fix: "repair" });
  } else if (topo.inconsistentEdges === 0) {
    checks.push({ id: "normals", status: "ok", title: "Normals point outward", detail: "Face orientation is consistent." });
  }

  // --- loose geometry --------------------------------------------------------
  const sorted = [...topo.components].sort((a, b) => Math.abs(b.volume) - Math.abs(a.volume));
  const mainVol = Math.abs(sorted[0]?.volume ?? 0) || 1;
  const debris = sorted.filter((c, i) => i > 0 && (Math.abs(c.volume) < mainVol * 0.01 || Math.max(c.size.x, c.size.y, c.size.z) < 2));
  if (debris.length > 0) {
    checks.push({ id: "loose", status: "warn", title: "Loose fragments", detail: `${debris.length} tiny disconnected piece(s) float around the model (scan debris). Remove them before printing.`, fix: "repair" });
  } else if (topo.components.length > 1) {
    checks.push({ id: "parts", status: "ok", title: `${topo.components.length} separate parts`, detail: "The model consists of multiple solid parts (e.g. a box and a lid). Make sure that is intended." });
  } else {
    checks.push({ id: "loose", status: "ok", title: "Single solid body", detail: "No loose geometry found." });
  }

  // --- thin walls + self-intersections (need a BVH) ---------------------------
  let minWall: number | null = null;
  const closed = topo.boundaryEdges === 0 && topo.nonManifoldEdges === 0 && vol > 0;
  if (tri > 0 && tri <= 400_000) {
    const bvh = new MeshBVH(toGeometry(mesh));
    if (closed) {
      const dists = estimateWalls(mesh, bvh, 4000);
      if (dists.length > 20) {
        minWall = dists[Math.floor(dists.length * 0.02)]; // 2nd percentile ignores sharp-corner noise
        const thinShare = dists.filter((d) => d < material.minWall).length / dists.length;
        if (minWall < settings.nozzle) {
          checks.push({ id: "wall", status: "fail", title: `Wall thickness only ${fmt(minWall)} mm`, detail: `Thinner than the ${fmt(settings.nozzle)} mm nozzle – these parts cannot be printed. Recommended for ${material.name}: at least ${fmt(material.minWall)} mm.`, fix: "thicken" });
        } else if (minWall < material.minWall) {
          checks.push({ id: "wall", status: "warn", title: `Wall thickness is only ${fmt(minWall)} mm`, detail: `Recommended for ${material.name}: at least ${fmt(material.minWall)} mm. About ${Math.round(thinShare * 100)}% of the surface is thinner than that.`, fix: "thicken" });
        } else {
          checks.push({ id: "wall", status: "ok", title: `Wall thickness ≥ ${fmt(minWall)} mm`, detail: `Meets the ${fmt(material.minWall)} mm recommendation for ${material.name}. (Estimated by sampling.)` });
        }
      }
    } else {
      checks.push({ id: "wall", status: "skipped", title: "Wall thickness not measured", detail: "Needs a closed mesh – repair the model first." });
    }
    if (tri <= 150_000) {
      const hits = countSelfIntersections(mesh, bvh, 200);
      checks.push(
        hits === 0
          ? { id: "self", status: "ok", title: "No self-intersections", detail: "No overlapping faces detected." }
          : { id: "self", status: hits > 20 ? "fail" : "warn", title: "Self-intersecting faces", detail: `${hits >= 200 ? "200+" : hits} intersecting face pairs. This is common in scans/AI meshes and can confuse slicers; a boolean re-union fixes most cases.`, fix: "repair" },
      );
    } else {
      checks.push({ id: "self", status: "skipped", title: "Self-intersection check skipped", detail: "Mesh is too dense for the quick check." });
    }
  } else {
    checks.push({ id: "wall", status: "skipped", title: "Wall thickness not measured", detail: "Mesh is too dense for the quick check." });
  }

  // --- tiny details ----------------------------------------------------------
  const tiny = topo.components.filter((c) => Math.max(c.size.x, c.size.y, c.size.z) < material.minFeature && !debris.includes(c));
  if (tiny.length) {
    checks.push({ id: "tiny", status: "warn", title: "Details smaller than the nozzle can resolve", detail: `${tiny.length} part(s) are smaller than ${fmt(material.minFeature)} mm and will not print cleanly.` });
  }

  // --- overhangs + orientation ----------------------------------------------
  const orientations = evaluateOrientations(mesh, settings);
  const asModelled = orientations.find((o) => o.rotation.every((v) => v === 0))!;
  const best = orientations[0];
  if (asModelled.overhangPercent < 2) {
    checks.push({ id: "overhang", status: "ok", title: "Hardly any overhangs", detail: `Less than 2% of the surface is steeper than ${material.maxOverhangDeg}° – prints without supports.` });
  } else {
    const better = best !== asModelled && best.overhangPercent < asModelled.overhangPercent * 0.7 && best.fits;
    checks.push({
      id: "overhang",
      status: asModelled.overhangPercent > 15 && !settings.supports ? "warn" : "ok",
      title: `${fmt(asModelled.overhangPercent, 0)}% overhanging surface`,
      detail: settings.supports
        ? "Supports are enabled in the profile."
        : `Surfaces steeper than ${material.maxOverhangDeg}° need supports.${better ? ` Printing "${best.label.toLowerCase()}" reduces this to ${fmt(best.overhangPercent, 0)}%.` : ""}`,
      fix: better ? "orient" : undefined,
    });
  }

  // --- build volume ----------------------------------------------------------
  const bv = printer.buildVolume;
  const fits = dims.x <= bv.x && dims.y <= bv.y && dims.z <= bv.z;
  if (fits) {
    checks.push({ id: "volume", status: "ok", title: `Fits the ${printer.name}`, detail: `${fmt(dims.x)} × ${fmt(dims.y)} × ${fmt(dims.z)} mm inside ${bv.x} × ${bv.y} × ${bv.z} mm.` });
  } else {
    const f = Math.min(bv.x / dims.x, bv.y / dims.y, bv.z / dims.z) * 0.98;
    const alt = orientations.find((o) => o.fits);
    checks.push({
      id: "volume",
      status: "fail",
      title: `Too large for the ${printer.name}`,
      detail: `${fmt(dims.x)} × ${fmt(dims.y)} × ${fmt(dims.z)} mm exceeds ${bv.x} × ${bv.y} × ${bv.z} mm. ${alt ? `It fits when printed "${alt.label.toLowerCase()}".` : `Scale to ${Math.floor(f * 100)}% or split the model.`}`,
      fix: alt ? "orient" : "scale-to-fit",
    });
  }

  const level = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "ok";
  const summary =
    level === "ok"
      ? `Model looks suitable for FDM printing on the ${printer.name}.`
      : level === "warn"
        ? "Printable, but there are points worth checking before you print."
        : "This model has problems that will likely cause a failed print.";

  return {
    level,
    summary,
    checks,
    stats: {
      triangles: tri,
      vertices: mesh.positions.length / 3,
      dimensions: dims,
      volumeMm3: Math.abs(vol),
      surfaceMm2: surfaceArea(mesh),
      // rough: shell + 15% infill — solid volume × density gives an upper bound; scale by an infill-aware factor
      estimatedMassG: (Math.abs(vol) / 1000) * material.density * Math.min(1, 0.25 + settings.infill / 100),
      components: topo.components.length,
      minWallMm: minWall,
    },
    orientations,
    bestOrientation: best,
    settings,
    generatedAt: new Date().toISOString(),
  };
}
