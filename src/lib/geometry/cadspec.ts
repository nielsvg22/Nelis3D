import { z } from "zod";
import { Arena, type Manifold, fromManifold, getKernel } from "./manifold";
import type { Mesh } from "./mesh";

/**
 * CadSpec – a small, validated, declarative CSG language.
 * The AI designs parts by emitting this JSON; geometry is then built deterministically
 * with the manifold kernel, so every result is a real watertight solid (never a picture).
 * All lengths in millimetres, Z-up, angles in degrees.
 */
const v3 = z.tuple([z.number(), z.number(), z.number()]);
const pt = z.tuple([z.number(), z.number()]);

export type CadNode =
  | { op: "box"; size: [number, number, number]; center?: boolean }
  | { op: "roundedBox"; size: [number, number, number]; radius: number; center?: boolean }
  | { op: "cylinder"; height: number; radius: number; radiusTop?: number; center?: boolean; segments?: number }
  | { op: "sphere"; radius: number; segments?: number }
  | { op: "extrude"; polygon: [number, number][]; height: number }
  | { op: "revolve"; profile: [number, number][]; segments?: number }
  | { op: "translate"; v: [number, number, number]; child: CadNode }
  | { op: "rotate"; deg: [number, number, number]; child: CadNode }
  | { op: "scale"; v: [number, number, number]; child: CadNode }
  | { op: "mirror"; normal: [number, number, number]; child: CadNode }
  | { op: "union" | "intersection" | "hull"; children: CadNode[] }
  | { op: "difference"; children: CadNode[] };

const pos = z.number().positive().max(2000);

export const cadNodeSchema: z.ZodType<CadNode> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("box"), size: z.tuple([pos, pos, pos]), center: z.boolean().optional() }),
    z.object({
      op: z.literal("roundedBox"),
      size: z.tuple([pos, pos, pos]),
      radius: pos,
      center: z.boolean().optional(),
    }),
    z.object({
      op: z.literal("cylinder"),
      height: pos,
      radius: pos,
      radiusTop: z.number().min(0).max(2000).optional(),
      center: z.boolean().optional(),
      segments: z.number().int().min(8).max(256).optional(),
    }),
    z.object({ op: z.literal("sphere"), radius: pos, segments: z.number().int().min(8).max(256).optional() }),
    z.object({ op: z.literal("extrude"), polygon: z.array(pt).min(3).max(512), height: pos }),
    z.object({ op: z.literal("revolve"), profile: z.array(pt).min(3).max(512), segments: z.number().int().min(8).max(256).optional() }),
    z.object({ op: z.literal("translate"), v: v3, child: cadNodeSchema }),
    z.object({ op: z.literal("rotate"), deg: v3, child: cadNodeSchema }),
    z.object({ op: z.literal("scale"), v: z.tuple([pos, pos, pos]), child: cadNodeSchema }),
    z.object({ op: z.literal("mirror"), normal: v3, child: cadNodeSchema }),
    z.object({ op: z.enum(["union", "intersection", "hull"]), children: z.array(cadNodeSchema).min(1).max(256) }),
    z.object({ op: z.literal("difference"), children: z.array(cadNodeSchema).min(2).max(256) }),
  ]),
) as z.ZodType<CadNode>;

export const cadSpecSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  root: cadNodeSchema,
});
export type CadSpec = z.infer<typeof cadSpecSchema>;

export class CadSpecError extends Error {}

/** Builds a mesh from a CadSpec. Throws CadSpecError if the spec does not produce a solid. */
export async function buildCadSpec(spec: CadSpec): Promise<Mesh> {
  const parsed = cadSpecSchema.safeParse(spec);
  if (!parsed.success) {
    throw new CadSpecError(`Invalid design: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const w = await getKernel();
  const arena = new Arena();
  const { Manifold, CrossSection } = w;
  let nodes = 0;

  const ev = (n: CadNode): Manifold => {
    if (++nodes > 2000) throw new CadSpecError("Design is too complex");
    const t = <T extends { delete(): void }>(x: T) => arena.track(x);
    switch (n.op) {
      case "box":
        return t(Manifold.cube(n.size, n.center ?? false));
      case "roundedBox": {
        const r = Math.min(n.radius, Math.min(...n.size) / 2 - 1e-3);
        const [sx, sy, sz] = n.size;
        const corners: Manifold[] = [];
        for (const x of [r, sx - r])
          for (const y of [r, sy - r])
            for (const z of [r, sz - r]) corners.push(t(Manifold.sphere(r, 24).translate([x, y, z])));
        let h = t(Manifold.hull(corners));
        if (n.center) h = t(h.translate([-sx / 2, -sy / 2, -sz / 2]));
        return h;
      }
      case "cylinder":
        return t(Manifold.cylinder(n.height, n.radius, n.radiusTop ?? n.radius, n.segments ?? 64, n.center ?? false));
      case "sphere":
        return t(Manifold.sphere(n.radius, n.segments ?? 48));
      case "extrude": {
        const cs = t(new CrossSection([n.polygon.map(([x, y]) => [x, y] as [number, number])], "NonZero"));
        return t(Manifold.extrude(cs, n.height));
      }
      case "revolve": {
        const cs = t(new CrossSection([n.profile.map(([x, y]) => [x, y] as [number, number])], "NonZero"));
        // revolve around Z using profile (x = radius, y = height)
        return t(Manifold.revolve(cs, n.segments ?? 64));
      }
      case "translate":
        return t(ev(n.child).translate(n.v));
      case "rotate":
        return t(ev(n.child).rotate(n.deg));
      case "scale":
        return t(ev(n.child).scale(n.v));
      case "mirror":
        return t(ev(n.child).mirror(n.normal));
      case "union":
        return t(Manifold.union(n.children.map(ev)));
      case "intersection":
        return t(Manifold.intersection(n.children.map(ev)));
      case "hull":
        return t(Manifold.hull(n.children.map(ev)));
      case "difference":
        return t(Manifold.difference(n.children.map(ev)));
    }
  };

  try {
    const result = ev(parsed.data.root);
    if (result.isEmpty() || result.volume() < 1e-3) {
      throw new CadSpecError("The design resulted in an empty shape (check that subtracted parts overlap the base).");
    }
    return fromManifold(result);
  } catch (e) {
    if (e instanceof CadSpecError) throw e;
    throw new CadSpecError(`Could not build design: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    arena.dispose();
  }
}
