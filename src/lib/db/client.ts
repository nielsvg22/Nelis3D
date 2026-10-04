import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { env } from "../env";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;
const g = globalThis as unknown as { __nelisDb?: Db };

/** Singleton connection (survives Next.js hot reload). Migrations run automatically on first use. */
export function getDb(): Db {
  if (!g.__nelisDb) {
    fs.mkdirSync(path.dirname(env.databasePath), { recursive: true });
    const sqlite = new Database(env.databasePath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
    g.__nelisDb = db;
  }
  return g.__nelisDb;
}

export { schema };
