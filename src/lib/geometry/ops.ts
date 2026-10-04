import { z } from "zod";
import { Arena, type Manifold, fromManifold, getKernel, toManifold } from "./manifold";
import { type Dimensions, type Mesh, type Vec3, bounds, dimensions, placeOnBed, resizeMesh, rotateMesh, scaleMesh } from "./mesh";

/** Edit operations the AI (or UI) can apply to an existing mesh. Units mm. */
export const editOpSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("scale"),
    /** uniform factor (1.1 = 10% bigger) */
    factor: z.number().positive().max(100).optional(),
    /** per-axis factors */
    factors: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).optional(),
  }),
  z.object({
    type: z.literal("resize"),
    /** target bounding-box size in mm; omit axes to keep them (or follow when uniform) */
    x: z.number().positive().max(5000).optional(),
    y: z.number().positive().max(5000).optional(),
    z: z.number().positive().max(5000).optional(),
    uniform: z.boolean().default(true),
  }),
  z.object({ type: z.literal("rotate"), deg: z.tuple([z.number(), z.number(), z.number()]) }),
  z.object({
    type: z.literal("hole"),
    axis: z.enum(["x", "y", "z"]),
    diameter: z.number().positive().max(500),
    /** position of the hole axis as FRACTION (0..1) of the bounding box on the two other axes */
    at: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).default([0.5, 0.5]),
    /** depth in mm from the min face; omit for through-hole */
    depth: z.number().positive().optional(),
    /** also drill from the opposite face (mirrored) */
    bothSides: z.boolean().default(false),
    countersink: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("add_box"),
    size: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
    /** centre of the box as fraction (0..1) of the bounding box per axis; values outside 0..1 are allowed (outside the object) */
    at: z.tuple([z.number(), z.number(), z.number()]),
    mode: z.enum(["union", "subtract"]).default("union"),
  }),
  z.object({
    type: z.literal("add_cylinder"),
    axis: z.enum(["x", "y", "z"]),
    diameter: z.number().positive(),
    length: z.number().positive(),
    at: z.tuple([z.number(), z.number(), z.number()]),
    mode: z.enum(["union", "subtract"]).default("union"),
  }),
  z.object({
    type: z.literal("cut"),
    axis: z.enum(["x", "y", "z"]),
    /** fraction (0..1) of bbox where to cut */
    at: z.number().min(0).max(1),
    keep: z.enum(["below", "above"]),
  }),
  z.object({ type: z.literal("mirror"), axis: z.enum(["x", "y", "z"]) }),
  z.object({ type: z.literal("place_on_bed") }),
]);
export type EditOp = z.infer<typeof editOpSchema>;

const AX = { x: 0, y: 1, z: 2 } as const;

function axisRotation(axis: "x" | "y" | "z"): Vec3 {
  // cylinders are built along Z; rotate to the requested axis
  return axis === "z" ? [0, 0, 0] : axis === "x" ? [0, 90, 0] : [-90, 0, 0];
}

export async function applyEditOps(input: Mesh, ops: EditOp[]): Promise<Mesh> {
  let mesh = input;
  const w = await getKernel();
  for (const op of ops) {
    switch (op.type) {
      case "scale": {
        const f = op.factors ?? [op.factor ?? 1, op.factor ?? 1, op.factor ?? 1];
        const b0 = bounds(mesh);
        const s = scaleMesh(mesh, f[0], f[1], f[2]);
        const b1 = bounds(s);
        mesh = shift(s, [b0.min[0] - b1.min[0], b0.min[1] - b1.min[1], b0.min[2] - b1.min[2]]);
        break;
      }
      case "resize":
        mesh = resizeMesh(mesh, { x: op.x, y: op.y, z: op.z }, op.uniform && [op.x, op.y, op.z].filter(Boolean).length === 1);
        break;
      case "rotate":
        mesh = placeOnBed(rotateMesh(mesh, ...op.deg));
        break;
      case "place_on_bed":
        mesh = placeOnBed(mesh);
        break;
      case "mirror": {
        const f: Vec3 = [1, 1, 1];
        f[AX[op.axis]] = -1;
        const b0 = bounds(mesh);
        const s = scaleMesh(mesh, ...f);
        const b1 = bounds(s);
        mesh = shift(s, [b0.min[0] - b1.min[0], b0.min[1] - b1.min[1], b0.min[2] - b1.min[2]]);
        break;
      }
      default: {
        const arena = new Arena();
        try {
          const base = await toManifold(w, arena, mesh);
          const b = bounds(mesh);
          const d = dimensions(mesh);
          const at = (f: number[]): Vec3 => [b.min[0] + f[0] * d.x, b.min[1] + f[1] * d.y, b.min[2] + (f[2] ?? 0) * d.z];
          let out: Manifold;
          if (op.type === "hole") {
            const ai = AX[op.axis];
            const others = [0, 1, 2].filter((i) => i !== ai);
            const margin = 1;
            const len = (op.depth ?? d[op.axis]) + margin;
            const mk = (fromMax: boolean) => {
              let c = arena.track(w.Manifold.cylinder(len, op.diameter / 2, op.diameter / 2, 64, false));
              const parts: Manifold[] = [c];
              if (op.countersink) {
                parts.push(arena.track(w.Manifold.cylinder(op.diameter / 2, op.diameter / 2, op.diameter, 64, false).translate([0, 0, len - margin - op.diameter / 2])));
              }
              c = arena.track(w.Manifold.union(parts));
              c = arena.track(c.translate([0, 0, -margin])); // start slightly outside the min face
              c = arena.track(c.rotate(axisRotation(op.axis)));
              // after rotation, the cylinder runs along +axis from origin (z: +z, x: +x, y: +y)
              const pos: Vec3 = [0, 0, 0];
              pos[others[0]] = b.min[others[0]] + op.at[0] * (others[0] === 0 ? d.x : others[0] === 1 ? d.y : d.z);
              pos[others[1]] = b.min[others[1]] + op.at[1] * (others[1] === 0 ? d.x : others[1] === 1 ? d.y : d.z);
              pos[ai] = b.min[ai];
              if (fromMax) {
                const flip: Vec3 = [1, 1, 1];
                flip[ai] = -1;
                c = arena.track(c.scale(flip));
                pos[ai] = b.max[ai];
              }
              return arena.track(c.translate(pos));
            };
            const cutters = [mk(false)];
            if (op.bothSides || !op.depth) cutters.push(mk(true));
            out = arena.track(base.subtract(arena.track(w.Manifold.union(cutters))));
          } else if (op.type === "add_box") {
            const c = at(op.at);
            const box = arena.track(w.Manifold.cube(op.size, true).translate(c));
            out = arena.track(op.mode === "union" ? base.add(box) : base.subtract(box));
          } else if (op.type === "add_cylinder") {
            const c = at(op.at);
            let cyl = arena.track(w.Manifold.cylinder(op.length, op.diameter / 2, op.diameter / 2, 64, true));
            cyl = arena.track(cyl.rotate(axisRotation(op.axis)));
            cyl = arena.track(cyl.translate(c));
            out = arena.track(op.mode === "union" ? base.add(cyl) : base.subtract(cyl));
          } else if (op.type === "cut") {
            const n: Vec3 = [0, 0, 0];
            n[AX[op.axis]] = op.keep === "below" ? -1 : 1;
            const offsetAbs = b.min[AX[op.axis]] + op.at * d[op.axis];
            // trimByPlane keeps the side the normal points to: n·p >= offset
            const offset = op.keep === "below" ? -offsetAbs : offsetAbs;
            out = arena.track(base.trimByPlane(n, offset));
          } else {
            throw new Error("Unsupported operation");
          }
          if (out.isEmpty()) throw new Error("The operation removed the whole object.");
          mesh = fromManifold(out);
        } finally {
          arena.dispose();
        }
      }
    }
  }
  return mesh;
}

function shift(m: Mesh, d: Vec3): Mesh {
  const out = { positions: new Float32Array(m.positions), indices: new Uint32Array(m.indices) };
  for (let i = 0; i < out.positions.length; i += 3) {
    out.positions[i] += d[0];
    out.positions[i + 1] += d[1];
    out.positions[i + 2] += d[2];
  }
  return out;
}

export function describeOps(ops: EditOp[]): string {
  return ops
    .map((o) => {
      switch (o.type) {
        case "scale":
          return o.factor ? `scale ×${o.factor}` : `scale ${o.factors?.join("×")}`;
        case "resize":
          return `resize to ${[o.x, o.y, o.z].map((v) => v ?? "–").join(" × ")} mm`;
        case "hole":
          return `Ø${o.diameter} mm hole along ${o.axis.toUpperCase()}`;
        case "cut":
          return `cut along ${o.axis.toUpperCase()}`;
        default:
          return o.type.replace("_", " ");
      }
    })
    .join(", ");
}

export type { Dimensions };
