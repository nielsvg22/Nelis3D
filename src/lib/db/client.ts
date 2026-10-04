import fs from "node:fs";
import path from "node:path";
import { env } from "../env";
import * as schema from "./schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export type Db = NodePgDatabase<typeof schema>;
const g = globalThis as unknown as { __nelisDb?: Promise<Db> };

/**
 * Postgres everywhere, same schema:
 *  • DATABASE_URL set  → node-postgres pool (Neon/Supabase/any Postgres) – used on Vercel
 *  • otherwise         → PGlite, an in-process Postgres stored in ./data/pglite (zero-setup local dev)
 * Pending migrations are applied once per process on first use.
 */
export function getDb(): Promise<Db> {
  return (g.__nelisDb ??= open());
}

async function open(): Promise<Db> {
  const migrationsFolder = path.resolve(process.cwd(), "drizzle");
  if (env.databaseUrl) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const url = env.databaseUrl.replace(/[?&]channel_binding=[^&]*/g, "");
    const pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 15_000, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
    const db = drizzle(pool, { schema });
    // advisory lock: two cold-starting instances must not migrate at the same time
    const lock = await pool.connect();
    try {
      await lock.query("select pg_advisory_lock(727272)");
      await migrate(db, { migrationsFolder });
    } finally {
      await lock.query("select pg_advisory_unlock(727272)").catch(() => null);
      lock.release();
    }
    return db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  fs.mkdirSync(path.dirname(env.pglitePath), { recursive: true });
  const db = drizzle(new PGlite(env.pglitePath), { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

export { schema };

/** First row or undefined – drizzle's pg API returns arrays. */
export async function first<T>(q: PromiseLike<T[]>): Promise<T | undefined> {
  return (await q)[0];
}
