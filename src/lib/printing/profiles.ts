/**
 * Printer + material catalogue. Code-level defaults; per-project choices are stored in the
 * `print_profiles` table and reference these ids. Add PETG/ABS/… here – nothing else needs to change.
 */
export interface PrinterSpec {
  id: string;
  name: string;
  vendor: string;
  buildVolume: { x: number; y: number; z: number }; // mm
  nozzleDiameter: number; // mm
  maxNozzleTemp: number;
  maxBedTemp: number;
  enclosed: boolean;
  /** slicer application that opens our 3MF */
  slicer: { name: string; url: string };
  /** future direct-send transport (see lib/printing/connector.ts) */
  connector: "moonraker" | "none";
}

export interface MaterialSpec {
  id: string;
  name: string;
  density: number; // g/cm³
  nozzleTemp: number;
  bedTemp: number;
  /** recommended minimum wall for a 0.4 mm nozzle (≈ 3 perimeters) */
  minWall: number;
  /** smallest feature worth printing */
  minFeature: number;
  /** surfaces steeper than this from vertical need supports */
  maxOverhangDeg: number;
  /** needs an enclosure / is warp-prone */
  warpProne: boolean;
}

export const PRINTERS: Record<string, PrinterSpec> = {
  "creality-k1-max": {
    id: "creality-k1-max",
    name: "Creality K1 Max",
    vendor: "Creality",
    buildVolume: { x: 300, y: 300, z: 300 },
    nozzleDiameter: 0.4,
    maxNozzleTemp: 300,
    maxBedTemp: 100,
    enclosed: true,
    slicer: { name: "Creality Print", url: "https://www.crealitycloud.com/software-firmware/creality-print" },
    connector: "moonraker",
  },
};

export const MATERIALS: Record<string, MaterialSpec> = {
  PLA: { id: "PLA", name: "PLA", density: 1.24, nozzleTemp: 220, bedTemp: 60, minWall: 1.2, minFeature: 0.8, maxOverhangDeg: 45, warpProne: false },
  PETG: { id: "PETG", name: "PETG", density: 1.27, nozzleTemp: 245, bedTemp: 75, minWall: 1.2, minFeature: 0.8, maxOverhangDeg: 45, warpProne: false },
  ABS: { id: "ABS", name: "ABS", density: 1.04, nozzleTemp: 260, bedTemp: 100, minWall: 1.6, minFeature: 1.0, maxOverhangDeg: 40, warpProne: true },
  ASA: { id: "ASA", name: "ASA", density: 1.07, nozzleTemp: 260, bedTemp: 100, minWall: 1.6, minFeature: 1.0, maxOverhangDeg: 40, warpProne: true },
  TPU: { id: "TPU", name: "TPU", density: 1.21, nozzleTemp: 225, bedTemp: 50, minWall: 1.6, minFeature: 1.2, maxOverhangDeg: 35, warpProne: false },
};

export interface PrintSettings {
  printerId: string;
  material: string;
  layerHeight: number;
  infill: number; // percent
  supports: boolean;
  nozzle: number;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  printerId: "creality-k1-max",
  material: "PLA",
  layerHeight: 0.2,
  infill: 15,
  supports: false,
  nozzle: 0.4,
};

export function resolveProfile(s: Partial<PrintSettings> | null | undefined) {
  const settings = { ...DEFAULT_PRINT_SETTINGS, ...(s ?? {}) };
  const printer = PRINTERS[settings.printerId] ?? PRINTERS["creality-k1-max"];
  const material = MATERIALS[settings.material] ?? MATERIALS.PLA;
  return { settings, printer, material };
}
