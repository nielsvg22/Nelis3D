import type { CadNode, CadSpec } from "../geometry/cadspec";

/** Deterministic parametric parts – used by the offline provider and as reference designs. */

export function lidBox(inner: { x: number; y: number; z: number }, wall = 2, clearance = 0.25): CadSpec {
  const ox = inner.x + 2 * wall, oy = inner.y + 2 * wall, oz = inner.z + wall;
  const base: CadNode = {
    op: "difference",
    children: [
      { op: "box", size: [ox, oy, oz] },
      { op: "translate", v: [wall, wall, wall], child: { op: "box", size: [inner.x, inner.y, inner.z + 1] } },
    ],
  };
  const lipT = 3;
  const lid: CadNode = {
    op: "translate",
    v: [ox + 8, 0, 0],
    child: {
      op: "union",
      children: [
        { op: "box", size: [ox, oy, wall] },
        { op: "translate", v: [wall + clearance, wall + clearance, wall - 0.2], child: { op: "box", size: [inner.x - 2 * clearance, inner.y - 2 * clearance, lipT + 0.2] } },
      ],
    },
  };
  return {
    name: "Box with lid",
    description: `Inner ${inner.x}×${inner.y}×${inner.z} mm, ${wall} mm walls, lid with ${clearance} mm fit clearance`,
    root: { op: "union", children: [base, lid] },
  };
}

/** Desk stand for a phone: a block with a backward-tilted slot and a cable hole. */
export function phoneHolder(phone: { width: number; thickness: number }, clearance = 2, tiltDeg = 15, wall = 6): CadSpec {
  const slotW = phone.width + 2 * clearance;
  const slotT = phone.thickness + 2 * clearance;
  const floor = 4;
  const H = 50;
  const hc = H - floor + 2;
  const sin = Math.sin((tiltDeg * Math.PI) / 180);
  const bx = slotW + 2 * wall;
  const by = slotT + hc * sin + 2 * wall + 2;
  const slot: CadNode = {
    op: "translate",
    v: [wall, wall, floor],
    child: { op: "rotate", deg: [-tiltDeg, 0, 0], child: { op: "box", size: [slotW, slotT, hc] } },
  };
  const cable: CadNode = {
    op: "translate",
    v: [bx / 2, -1, floor + 8],
    child: { op: "rotate", deg: [-90, 0, 0], child: { op: "cylinder", height: by + 2, radius: 6 } },
  };
  const screenWindow: CadNode = {
    op: "translate",
    v: [bx / 2 - slotW / 3, -1, floor + 12],
    child: { op: "box", size: [(2 * slotW) / 3, wall + 2, H] },
  };
  void screenWindow;
  return {
    name: "Phone holder",
    description: `Slot ${slotW.toFixed(1)}×${slotT.toFixed(1)} mm (phone ${phone.width}×${phone.thickness} + ${clearance} mm clearance), ${tiltDeg}° recline`,
    root: { op: "difference", children: [{ op: "box", size: [bx, by, H] }, slot, cable] },
  };
}
