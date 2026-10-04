import { type Mesh, signedVolume, weld, flipWinding } from "./mesh";

/**
 * Conservative automatic repair: weld, drop degenerate triangles, make winding consistent,
 * make normals point outward. Does NOT invent geometry (holes are reported, not filled).
 */
export function repairMesh(input: Mesh): { mesh: Mesh; actions: string[] } {
  const actions: string[] = [];
  const soup = new Float32Array(input.indices.length * 3);
  for (let i = 0; i < input.indices.length; i++) {
    soup.set(input.positions.subarray(input.indices[i] * 3, input.indices[i] * 3 + 3), i * 3);
  }
  let mesh = weld(soup, 1e-3);
  if (mesh.indices.length !== input.indices.length) {
    actions.push(`Removed ${(input.indices.length - mesh.indices.length) / 3} degenerate triangles`);
  }
  const { mesh: oriented, flipped } = orientConsistently(mesh);
  mesh = oriented;
  if (flipped > 0) actions.push(`Re-oriented ${flipped} triangles for consistent winding`);
  if (signedVolume(mesh) < 0) {
    mesh = flipWinding(mesh);
    actions.push("Flipped inverted normals");
  }
  return { mesh, actions };
}

/** BFS over edge-adjacent triangles making the winding agree with the seed triangle of each shell. */
function orientConsistently(m: Mesh): { mesh: Mesh; flipped: number } {
  const tri = m.indices.length / 3;
  const idx = new Uint32Array(m.indices);
  const n = m.positions.length / 3;
  const edgeTris = new Map<number, number[]>();
  const key = (a: number, b: number) => (a < b ? a * n + b : b * n + a);
  for (let t = 0; t < tri; t++) {
    for (let k = 0; k < 3; k++) {
      const e = key(idx[t * 3 + k], idx[t * 3 + ((k + 1) % 3)]);
      const l = edgeTris.get(e);
      if (l) l.push(t);
      else edgeTris.set(e, [t]);
    }
  }
  const seen = new Uint8Array(tri);
  let flipped = 0;
  const hasDirectedEdge = (t: number, a: number, b: number) => {
    for (let k = 0; k < 3; k++) if (idx[t * 3 + k] === a && idx[t * 3 + ((k + 1) % 3)] === b) return true;
    return false;
  };
  for (let s = 0; s < tri; s++) {
    if (seen[s]) continue;
    seen[s] = 1;
    const stack = [s];
    while (stack.length) {
      const t = stack.pop()!;
      for (let k = 0; k < 3; k++) {
        const a = idx[t * 3 + k], b = idx[t * 3 + ((k + 1) % 3)];
        const nb = edgeTris.get(key(a, b))!;
        if (nb.length !== 2) continue;
        const o = nb[0] === t ? nb[1] : nb[0];
        if (seen[o]) continue;
        seen[o] = 1;
        // neighbour must traverse the shared edge as b→a; if it does a→b it is flipped
        if (hasDirectedEdge(o, a, b)) {
          const x = idx[o * 3 + 1];
          idx[o * 3 + 1] = idx[o * 3 + 2];
          idx[o * 3 + 2] = x;
          flipped++;
        }
        stack.push(o);
      }
    }
  }
  return { mesh: { positions: m.positions, indices: idx }, flipped };
}
