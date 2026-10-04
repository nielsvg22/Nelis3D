import { describe, expect, it } from "vitest";
import { buildCadSpec } from "../src/lib/geometry/cadspec";
import { parseMeshFile, write3mf, writeBinaryStl, parse3mf, parseStl } from "../src/lib/geometry/io";
import { applyEditOps } from "../src/lib/geometry/ops";
import { checkPrintability } from "../src/lib/geometry/printability";
import { dimensions, flipWinding, signedVolume } from "../src/lib/geometry/mesh";
import { repairMesh } from "../src/lib/geometry/repair";

const box = (x: number, y: number, z: number) => buildCadSpec({ name: "b", root: { op: "box", size: [x, y, z] } });

describe("geometry kernel", () => {
  it("builds a CSG part with a real hole and correct dimensions", async () => {
    const m = await buildCadSpec({
      name: "plate",
      root: { op: "difference", children: [{ op: "box", size: [40, 20, 5] }, { op: "translate", v: [20, 10, -1], child: { op: "cylinder", height: 8, radius: 3 } }] },
    });
    const d = dimensions(m);
    expect(d.x).toBeCloseTo(40, 3);
    expect(signedVolume(m)).toBeLessThan(40 * 20 * 5);
    expect(signedVolume(m)).toBeGreaterThan(40 * 20 * 5 - Math.PI * 9 * 5 - 5);
  });

  it("round-trips STL and 3MF", async () => {
    const m = await box(10, 20, 30);
    const stl = parseStl(writeBinaryStl(m));
    expect(dimensions(stl).y).toBeCloseTo(20, 3);
    expect(signedVolume(stl)).toBeCloseTo(6000, 1);
    const tmf = parse3mf(write3mf(m, { title: "t", bedCenter: { x: 150, y: 150 } }));
    expect(dimensions(tmf).z).toBeCloseTo(30, 3);
    expect(parseMeshFile("a.3mf", write3mf(m, { title: "t" })).indices.length).toBe(m.indices.length);
  });

  it("applies resize / hole / cut edits", async () => {
    const m = await box(20, 20, 20);
    const r = await applyEditOps(m, [{ type: "resize", x: 40, uniform: true }]);
    expect(dimensions(r).z).toBeCloseTo(40, 3);
    const h = await applyEditOps(m, [{ type: "hole", axis: "z", diameter: 6, at: [0.5, 0.5], bothSides: false, countersink: false }]);
    expect(signedVolume(h)).toBeCloseTo(8000 - Math.PI * 9 * 20, -1);
    const c = await applyEditOps(m, [{ type: "cut", axis: "z", at: 0.5, keep: "below" }]);
    expect(dimensions(c).z).toBeCloseTo(10, 3);
  });

  it("printability: clean cube ok, thin wall flagged, inverted normals repaired", async () => {
    const good = checkPrintability(await box(30, 30, 30));
    expect(good.checks.find((c) => c.id === "watertight")!.status).toBe("ok");
    expect(good.checks.find((c) => c.id === "volume")!.status).toBe("ok");

    const shell = await buildCadSpec({
      name: "thin",
      root: { op: "difference", children: [{ op: "box", size: [40, 40, 40] }, { op: "translate", v: [0.6, 0.6, 0.6], child: { op: "box", size: [38.8, 38.8, 38.8] } }] },
    });
    const rep = checkPrintability(shell);
    const wall = rep.checks.find((c) => c.id === "wall")!;
    expect(wall.status).toBe("warn");
    expect(rep.stats.minWallMm).toBeGreaterThan(0.4);
    expect(rep.stats.minWallMm).toBeLessThan(0.8);

    const inv = flipWinding(await box(10, 10, 10));
    expect(checkPrintability(inv).checks.find((c) => c.id === "normals")!.status).toBe("fail");
    expect(signedVolume(repairMesh(inv).mesh)).toBeGreaterThan(0);

    const huge = checkPrintability(await box(400, 10, 10));
    expect(huge.checks.find((c) => c.id === "volume")!.status).toBe("fail");
  });

  it("detects overhang and recommends orientation", async () => {
    // T-shape: stem up, cap overhangs when stem is down
    const t = await buildCadSpec({ name: "t", root: { op: "union", children: [{ op: "box", size: [10, 10, 30] }, { op: "translate", v: [-15, -15, 30], child: { op: "box", size: [40, 40, 5] } }] } });
    const rep = checkPrintability(t);
    expect(rep.orientations[0].overhangPercent).toBeLessThan(rep.orientations.find((o) => o.label === "As modelled")!.overhangPercent + 1e-6);
  });
});

import { phoneHolder, lidBox } from "../src/lib/ai/templates";
import { localPlanTurn } from "../src/lib/ai/local";
import { bounds } from "../src/lib/geometry/mesh";

describe("templates + offline planner", () => {
  it("builds a printable phone holder and box with lid", async () => {
    for (const spec of [phoneHolder({ width: 78, thickness: 8.75 }), lidBox({ x: 60, y: 40, z: 30 })]) {
      const m = await buildCadSpec(spec);
      const r = checkPrintability(m);
      expect(r.checks.find((c) => c.id === "watertight")!.status).toBe("ok");
      expect(bounds(m).min[2]).toBeGreaterThanOrEqual(-1e-6);
    }
  });
  it("parses Dutch scale commands", () => {
    const ctx = { projectName: "x", mode: "modify", analysis: null, currentMesh: null, currentDimensions: { x: 50, y: 50, z: 50 }, currentVersionNumber: 1, versions: [], history: [], settings: {} as never, report: null };
    const p = localPlanTurn("maak dit 10% groter", ctx);
    expect(p.kind).toBe("modify");
  });
});
