import { type ObjectAnalysis, type ChatContext, type TurnPlan, AiError, type AiImage } from "./types";
import { lidBox, phoneHolder } from "./templates";
import { bounds, dimensions, type Mesh } from "../geometry/mesh";
import type { EditOp } from "../geometry/ops";

const num = (s: string) => parseFloat(s.replace(",", "."));
const NOT_CONFIGURED = new AiError(
  "NOT_CONFIGURED",
  "Photo analysis needs an AI vision model.",
  "Set ANTHROPIC_API_KEY in .env.local. Without it you can still upload STL/OBJ/3MF models and edit them.",
);

/** Purely geometric analysis for existing 3D models – no AI involved, and labelled as such. */
export function localAnalyzeMesh(mesh: Mesh, name: string): ObjectAnalysis {
  const d = dimensions(mesh);
  const b = bounds(mesh);
  const cx = (b.min[0] + b.max[0]) / 2;
  // crude mirror symmetry: compare vertex counts either side of the mid-plane
  let left = 0, right = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) (mesh.positions[i] < cx ? left++ : right++);
  const symmetric = Math.abs(left - right) / Math.max(1, left + right) < 0.05;
  return {
    objectName: name,
    category: "uploaded 3D model",
    description: `Uploaded mesh with ${mesh.indices.length / 3} triangles.`,
    confidence: 1,
    dimensions: { x: d.x, y: d.y, z: d.z, basis: "measured from the mesh", confidence: "high" },
    geometry: "Measured geometry; semantic analysis (holes, parts) requires an AI key.",
    symmetry: symmetric ? "mirror" : "none",
    features: [],
    visibleParts: [],
    missingViews: [],
    suggestions: ["Make it 10% bigger", "Add a 4 mm hole through the middle", "Cut it in half", "Scale it to 100 mm wide"],
    reconstruction: { feasible: true, reasons: [] },
    questions: [],
    provider: "local-geometry",
  };
}

export function localAnalyzePhotos(_images: AiImage[]): never {
  throw NOT_CONFIGURED;
}

const AXES: Record<string, "x" | "y" | "z"> = { breed: "x", wide: "x", width: "x", breedte: "x", diep: "y", deep: "y", depth: "y", diepte: "y", hoog: "z", high: "z", tall: "z", height: "z", hoogte: "z", lang: "x", long: "x" };

/** Offline, rule-based interpreter for common requests (Dutch + English). Deliberately conservative. */
export function localPlanTurn(message: string, ctx: ChatContext): TurnPlan {
  const m = message.toLowerCase();
  const nl = /\b(maak|groter|kleiner|gat|gaten|het|een|met|van)\b/.test(m);
  const t = (n: string, e: string) => (nl ? n : e);
  const dims = ctx.currentDimensions;

  const pct = m.match(/(\d+(?:[.,]\d+)?)\s*%\s*(groter|bigger|larger|kleiner|smaller|verkleinen|vergroten)?/);
  if (pct && dims && /(groter|bigger|larger|vergroot|kleiner|smaller|verklein)/.test(m)) {
    const p = num(pct[1]);
    const smaller = /(kleiner|smaller|verklein)/.test(m);
    const factor = smaller ? 1 - p / 100 : 1 + p / 100;
    return { kind: "modify", label: `Scaled ${smaller ? "−" : "+"}${p}%`, ops: [{ type: "scale", factor }], reply: t(`Klaar, ik schaal het model ${smaller ? "naar" : "met"} ${p}% ${smaller ? "kleiner" : "groter"}.`, `Scaling the model ${p}% ${smaller ? "smaller" : "bigger"}.`) };
  }

  const size = m.match(/(\d+(?:[.,]\d+)?)\s*(mm|cm)\s*(breed|wide|width|breedte|diep|deep|depth|diepte|hoog|high|tall|height|hoogte|lang|long)/);
  if (size && dims) {
    const mm = num(size[1]) * (size[2] === "cm" ? 10 : 1);
    const axis = AXES[size[3]];
    return { kind: "modify", label: `${axis === "x" ? "Width" : axis === "y" ? "Depth" : "Height"} ${mm} mm`, ops: [{ type: "resize", [axis]: mm, uniform: true } as EditOp], reply: t(`Ik schaal het model proportioneel zodat het ${mm} mm ${size[3]} is.`, `Scaling proportionally so it is ${mm} mm ${size[3]}.`) };
  }

  if (dims && /(\bgat\b|\bgaten\b|\bhole|\bholes\b)/.test(m)) {
    const dia = num(m.match(/(\d+(?:[.,]\d+)?)\s*mm/)?.[1] ?? "4");
    const ext = [dims.x, dims.y, dims.z];
    const axis = (["x", "y", "z"] as const)[ext.indexOf(Math.min(...ext))];
    const both = /(beide|both)/.test(m);
    const plural = /(gaten|holes)/.test(m);
    const ops: EditOp[] = plural
      ? [
          { type: "hole", axis, diameter: dia, at: [0.2, 0.5], bothSides: both, countersink: false },
          { type: "hole", axis, diameter: dia, at: [0.8, 0.5], bothSides: both, countersink: false },
        ]
      : [{ type: "hole", axis, diameter: dia, at: [0.5, 0.5], bothSides: both, countersink: false }];
    return { kind: "modify", label: `${ops.length} × Ø${dia} mm hole`, ops, reply: t(`Ik boor ${ops.length} gat(en) van Ø${dia} mm door de dunste richting (${axis.toUpperCase()}). Zeg het als ze ergens anders moeten zitten.`, `Drilling ${ops.length} Ø${dia} mm hole(s) through the thinnest direction (${axis.toUpperCase()}). Tell me if they should go elsewhere.`) };
  }

  if (dims && /(doorsnijden|in tweeën|helft|half|cut)/.test(m)) {
    return { kind: "modify", label: "Cut in half", ops: [{ type: "cut", axis: "z", at: 0.5, keep: "below" }], reply: t("Ik hou de onderste helft over.", "Keeping the lower half.") };
  }

  const box = m.match(/(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)/);
  if (/(doosje|box|dozen|kistje).*(deksel|lid)|(deksel|lid).*(doosje|box)/.test(m)) {
    const inner = box ? { x: num(box[1]), y: num(box[2]), z: num(box[3]) } : dims ? { x: dims.x + 4, y: dims.y + 4, z: dims.z + 2 } : { x: 60, y: 40, z: 30 };
    return { kind: "design", spec: lidBox(inner), reply: t(`Ik maak een doosje met deksel met binnenmaat ${inner.x.toFixed(0)}×${inner.y.toFixed(0)}×${inner.z.toFixed(0)} mm, 2 mm wanden en 0,25 mm speling voor het deksel.`, `Making a box with lid, inner size ${inner.x.toFixed(0)}×${inner.y.toFixed(0)}×${inner.z.toFixed(0)} mm, 2 mm walls and 0.25 mm lid clearance.`) };
  }

  if (/(telefoonhouder|phone holder|phone stand|telefoon.*standaard)/.test(m)) {
    if (box) {
      const [a, b, c] = [num(box[1]), num(box[2]), num(box[3])].sort((x, y) => y - x);
      return { kind: "design", spec: phoneHolder({ width: b, thickness: c }), reply: t(`Telefoonhouder voor ${a}×${b}×${c} mm met 2 mm speling rondom en 15° achterover.`, `Phone holder for ${a}×${b}×${c} mm with 2 mm clearance, reclined 15°.`) };
    }
    return { kind: "reply", reply: t("Welke afmetingen heeft je telefoon? Geef ze als lengte × breedte × dikte in mm, bijvoorbeeld 160 x 77 x 8,5. (Zonder AI-sleutel kan ik die niet zelf opzoeken.)", "What are your phone's dimensions? Give length × width × thickness in mm, e.g. 160 x 77 x 8.5. (Without an AI key I can't look them up.)") };
  }

  return {
    kind: "reply",
    reply: t(
      "Zonder AI-sleutel begrijp ik alleen basisopdrachten: '10% groter', 'maak dit 20 cm breed', 'maak gaten', 'doosje met deksel 60x40x30' of 'telefoonhouder 160x77x8,5'. Voeg ANTHROPIC_API_KEY toe voor vrije opdrachten.",
      "Without an AI key I only understand basic commands: '10% bigger', 'make this 20 cm wide', 'add holes', 'box with lid 60x40x30' or 'phone holder 160x77x8.5'. Add ANTHROPIC_API_KEY for free-form requests.",
    ),
  };
}
