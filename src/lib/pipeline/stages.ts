/**
 * The 3D pipeline as replaceable stages. Each stage is a plain async function / interface so it can be
 * swapped (e.g. local rembg container for segmentation, COLMAP/2DGS for reconstruction, a different mesh fixer).
 *
 *  Camera/photos → [preprocess] → [segment] → [reconstruct] → [cleanup] → [AI modify/design]
 *      → [validate] → [scale] → [export STL/3MF] → [print prep] → Creality K1 Max
 */
export const PIPELINE = [
  { id: "preprocess", impl: "sharp (EXIF strip, resize, quality score)", file: "lib/pipeline/preprocess.ts" },
  { id: "segment", impl: "provider-side (Meshy removes background); pluggable Segmenter below", file: "lib/pipeline/stages.ts" },
  { id: "reconstruct", impl: "AIProvider.reconstructModel (Meshy multi-image-to-3D)", file: "lib/ai/meshy.ts" },
  { id: "cleanup", impl: "weld · de-duplicate · consistent winding · outward normals", file: "lib/geometry/repair.ts" },
  { id: "modify", impl: "AIProvider.planTurn → manifold CSG edit ops / CadSpec", file: "lib/geometry/ops.ts, cadspec.ts" },
  { id: "validate", impl: "topology, BVH wall thickness, self-intersection, overhang", file: "lib/geometry/printability.ts" },
  { id: "scale", impl: "bbox resize with axis lock", file: "lib/geometry/mesh.ts" },
  { id: "export", impl: "binary STL + standards-compliant 3MF", file: "lib/geometry/io/*" },
  { id: "print-prep", impl: "orientation search, K1 Max profile, build-volume check", file: "lib/printing/*" },
] as const;

/** Optional background-removal stage. Default passthrough; implement with a rembg/SAM service to improve reconstructions. */
export interface Segmenter {
  segment(image: Buffer): Promise<Buffer>;
}
export const passthroughSegmenter: Segmenter = { segment: async (b) => b };
