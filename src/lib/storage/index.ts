import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../env";

/**
 * Object storage abstraction. Keys look like `phone-holder-ab12cd/models/model-v1.stl`.
 * Implement this interface for S3 / R2 / GCS and switch via STORAGE_DRIVER – no other code changes.
 */
export interface Storage {
  put(key: string, data: Uint8Array | Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
}

class LocalStorage implements Storage {
  constructor(private root: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return p;
  }
  async put(key: string, data: Uint8Array) {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data);
  }
  async get(key: string) {
    return fs.readFile(this.resolve(key));
  }
  async exists(key: string) {
    return fs.access(this.resolve(key)).then(() => true, () => false);
  }
  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
  async deletePrefix(prefix: string) {
    await fs.rm(this.resolve(prefix), { recursive: true, force: true });
  }
}

let instance: Storage | null = null;
export function getStorage(): Storage {
  if (!instance) {
    if (env.storageDriver !== "local") {
      throw new Error(`STORAGE_DRIVER="${env.storageDriver}" is not implemented. Add a driver in src/lib/storage/index.ts (see README → Storage).`);
    }
    instance = new LocalStorage(env.storageDir);
  }
  return instance;
}
