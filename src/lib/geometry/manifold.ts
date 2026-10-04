import Module from "manifold-3d";
import type { Mesh } from "./mesh";

type Wasm = Awaited<ReturnType<typeof Module>>;
export type Manifold = InstanceType<Wasm["Manifold"]>;

let wasmPromise: Promise<Wasm> | null = null;

/** Lazily boots the manifold WASM kernel once per process. */
export function getKernel(): Promise<Wasm> {
  if (!wasmPromise) {
    wasmPromise = Module().then((w) => {
      w.setup();
      return w;
    });
  }
  return wasmPromise;
}

/** Tracks WASM objects so they can be freed in one go (WASM memory is not garbage collected). */
export class Arena {
  private items: { delete(): void }[] = [];
  track<T extends { delete(): void }>(x: T): T {
    this.items.push(x);
    return x;
  }
  dispose() {
    for (const i of this.items) {
      try {
        i.delete();
      } catch {
        /* already freed */
      }
    }
    this.items = [];
  }
}

export class NotManifoldError extends Error {
  constructor(detail: string) {
    super(
      `The mesh is not a closed, watertight solid (${detail}). Editing operations need a clean solid – run mesh repair or re-generate the model.`,
    );
    this.name = "NotManifoldError";
  }
}

export async function toManifold(w: Wasm, arena: Arena, mesh: Mesh): Promise<Manifold> {
  const m = new w.Mesh({ numProp: 3, vertProperties: new Float32Array(mesh.positions), triVerts: new Uint32Array(mesh.indices) });
  m.merge();
  try {
    return arena.track(new w.Manifold(m));
  } catch (e) {
    throw new NotManifoldError(e instanceof Error ? e.message : String(e));
  }
}

export function fromManifold(m: Manifold): Mesh {
  const out = m.getMesh();
  const stride = out.numProp;
  const vp = out.vertProperties;
  const positions = new Float32Array((vp.length / stride) * 3);
  for (let i = 0, j = 0; i < vp.length; i += stride, j += 3) {
    positions[j] = vp[i];
    positions[j + 1] = vp[i + 1];
    positions[j + 2] = vp[i + 2];
  }
  const indices = new Uint32Array(out.triVerts);
  return { positions, indices };
}
