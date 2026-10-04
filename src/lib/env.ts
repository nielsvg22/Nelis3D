import path from "node:path";

/** Central, typed access to environment variables. Never hardcode secrets. */
export const env = {
  /** Postgres connection string (Neon etc.). Unset ⇒ embedded PGlite for local dev. */
  get databaseUrl() {
    return process.env.DATABASE_URL?.trim() || undefined;
  },
  get pglitePath() {
    return path.resolve(process.env.PGLITE_PATH ?? "./data/pglite");
  },
  /** "postgres" (default on Vercel) or "local" disk (default in dev) */
  get storageDriver() {
    return process.env.STORAGE_DRIVER ?? (process.env.VERCEL || process.env.DATABASE_URL ? "postgres" : "local");
  },
  get isServerless() {
    return !!process.env.VERCEL;
  },
  get cronSecret() {
    return process.env.CRON_SECRET?.trim() || undefined;
  },
  get storageDir() {
    return path.resolve(process.env.STORAGE_LOCAL_DIR ?? "./data/storage");
  },
  get aiProvider() {
    return (process.env.AI_PROVIDER ?? "auto") as "auto" | "local";
  },
  get anthropicKey() {
    return process.env.ANTHROPIC_API_KEY?.trim() || undefined;
  },
  get anthropicModel() {
    return process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5";
  },
  get meshyKey() {
    return process.env.MESHY_API_KEY?.trim() || undefined;
  },
  get meshyModel() {
    return process.env.MESHY_AI_MODEL?.trim() || "latest";
  },
  get devUserEmail() {
    return process.env.DEV_USER_EMAIL ?? "dev@nelis3d.local";
  },
  get scanRetentionHours() {
    return Number(process.env.SCAN_IMAGE_RETENTION_HOURS ?? 0);
  },
};
