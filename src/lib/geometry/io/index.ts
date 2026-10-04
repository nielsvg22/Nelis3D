import type { Mesh } from "../mesh";
import { assertValidMesh } from "../mesh";
import { parseObj } from "./obj";
import { parseStl } from "./stl";
import { parse3mf } from "./threemf";

export type MeshFormat = "stl" | "obj" | "3mf";

export function formatFromName(name: string): MeshFormat | null {
  const ext = name.toLowerCase().split(".").pop();
  return ext === "stl" || ext === "obj" || ext === "3mf" ? ext : null;
}

export function parseMeshFile(name: string, data: Uint8Array): Mesh {
  const fmt = formatFromName(name);
  if (!fmt) throw new Error("Unsupported 3D format. Use STL, OBJ or 3MF.");
  const mesh =
    fmt === "stl" ? parseStl(data) : fmt === "obj" ? parseObj(new TextDecoder().decode(data)) : parse3mf(data);
  assertValidMesh(mesh);
  return mesh;
}

export { writeBinaryStl, parseStl } from "./stl";
export { write3mf, parse3mf } from "./threemf";
export { parseObj } from "./obj";
