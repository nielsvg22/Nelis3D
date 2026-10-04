import fs from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "../db/client";
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

/** Private binary store inside Postgres – works on any serverless host without extra services. Keep objects < ~20 MB. */
class PostgresStorage implements Storage {
  async put(key: string, data: Uint8Array) {
    const db = await getDb();
    const buf = Buffer.from(data);
    await db.insert(schema.files).values({ key, data: buf, size: buf.length }).onConflictDoUpdate({ target: schema.files.key, set: { data: buf, size: buf.length } });
  }
  async get(key: string) {
    const db = await getDb();
    const [row] = await db.select({ data: schema.files.data }).from(schema.files).where(eq(schema.files.key, key)).limit(1);
    if (!row) throw new Error(`File not found: ${key}`);
    return Buffer.from(row.data);
  }
  async exists(key: string) {
    const db = await getDb();
    return (await db.select({ k: schema.files.key }).from(schema.files).where(eq(schema.files.key, key)).limit(1)).length > 0;
  }
  async delete(key: string) {
    const db = await getDb();
    await db.delete(schema.files).where(eq(schema.files.key, key));
  }
  async deletePrefix(prefix: string) {
    const db = await getDb();
    await db.delete(schema.files).where(sql`starts_with(${schema.files.key}, ${prefix})`);
  }
}

let instance: Storage | null = null;
export function getStorage(): Storage {
  if (!instance) {
    if (env.storageDriver === "postgres") instance = new PostgresStorage();
    else if (env.storageDriver === "local") instance = new LocalStorage(env.storageDir);
    else throw new Error(`STORAGE_DRIVER="${env.storageDriver}" is not implemented. Add a driver in src/lib/storage/index.ts (see README → Storage).`);
  }
  return instance;
}
