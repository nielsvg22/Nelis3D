import { eq } from "drizzle-orm";
import { first, getDb, schema } from "../db/client";
import { getStorage } from "../storage";
import { placeOnBed, rotateMesh, dimensions } from "../geometry/mesh";
import { write3mf } from "../geometry/io/threemf";
import { writeBinaryStl } from "../geometry/io/stl";
import { evaluateOrientations } from "../geometry/printability";
import { resolveProfile } from "../printing/profiles";
import { getVersion, loadVersionMesh } from "./versions";

export type ExportFormat = "stl" | "3mf";

export class ExportBlockedError extends Error {}

/**
 * Builds an export for a version. `orient: "best"` applies the lowest-overhang orientation that fits the printer.
 * The file is also persisted under `<project>/exports/model-v<N>.<ext>`.
 */
export async function exportVersion(projectId: string, versionId: string, format: ExportFormat, opts: { orient?: "as-is" | "best"; force?: boolean } = {}) {
  const v = await getVersion(projectId, versionId);
  if (!v) throw new Error("Version not found");
  const p = (await first((await getDb()).select().from(schema.projects).where(eq(schema.projects.id, projectId))))!;
  const { settings, printer, material } = resolveProfile(p.printSettings);
  let mesh = await loadVersionMesh(v);

  let orientationLabel = "as modelled";
  if (opts.orient === "best") {
    const best = evaluateOrientations(mesh, settings)[0];
    if (best.fits && best.rotation.some((r) => r !== 0)) mesh = rotateMesh(mesh, ...best.rotation);
    orientationLabel = best.label.toLowerCase();
  }
  mesh = placeOnBed(mesh);

  const d = dimensions(mesh);
  const bv = printer.buildVolume;
  if (!opts.force && (d.x > bv.x || d.y > bv.y || d.z > bv.z)) {
    throw new ExportBlockedError(`Model (${d.x.toFixed(0)}×${d.y.toFixed(0)}×${d.z.toFixed(0)} mm) does not fit the ${printer.name} build volume (${bv.x}×${bv.y}×${bv.z} mm).`);
  }

  const base = `model-v${v.number}`;
  let bytes: Uint8Array;
  if (format === "stl") bytes = writeBinaryStl(mesh, `Nelis3D ${p.name} v${v.number}`);
  else
    bytes = write3mf(mesh, {
      title: `${p.name} v${v.number}`,
      description: v.prompt ?? undefined,
      bedCenter: { x: bv.x / 2, y: bv.y / 2 },
      extra: {
        PrinterModel: printer.name,
        Material: material.name,
        LayerHeight: String(settings.layerHeight),
        InfillPercent: String(settings.infill),
        Orientation: orientationLabel,
      },
    });
  const key = `${p.storagePrefix}exports/${base}.${format}`;
  await getStorage().put(key, bytes);
  return { bytes, filename: `${p.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "model"}-v${v.number}.${format}`, contentType: format === "stl" ? "model/stl" : "model/3mf", orientation: orientationLabel };
}
