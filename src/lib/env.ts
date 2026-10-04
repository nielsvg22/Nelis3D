import path from "node:path";

/** Central, typed access to environment variables. Never hardcode secrets. */
export const env = {
  get databasePath() {
    return path.resolve(process.env.DATABASE_PATH ?? "./data/nelis3d.db");
  },
  get storageDriver() {
    return process.env.STORAGE_DRIVER ?? "local";
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
