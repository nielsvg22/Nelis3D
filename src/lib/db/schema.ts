import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { PrintSettings } from "../printing/profiles";
import type { PrintReport } from "../geometry/printability";
import type { ObjectAnalysis } from "../ai/types";

const id = () => text("id").primaryKey();
const createdAt = () => integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: createdAt(),
});

export type ProjectMode = "reconstruct" | "modify" | "design" | "functional";

export const projects = sqliteTable(
  "projects",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** A reconstruct · B modify existing · C design from scan · D functional part */
    mode: text("mode").$type<ProjectMode>().notNull().default("reconstruct"),
    /** storage folder, e.g. "phone-holder-ab12cd/" */
    storagePrefix: text("storage_prefix").notNull(),
    currentVersionId: text("current_version_id"),
    analysis: text("analysis", { mode: "json" }).$type<ObjectAnalysis | null>(),
    printSettings: text("print_settings", { mode: "json" }).$type<Partial<PrintSettings>>(),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("projects_user_idx").on(t.userId, t.updatedAt)],
);

export const scans = sqliteTable("scans", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  source: text("source").$type<"camera" | "upload">().notNull(),
  createdAt: createdAt(),
});

export interface ImageQuality {
  sharpness: number;
  brightness: number;
  width: number;
  height: number;
  issues: string[];
}

export const scanImages = sqliteTable(
  "scan_images",
  {
    id: id(),
    scanId: text("scan_id").notNull().references(() => scans.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    storageKey: text("storage_key").notNull(),
    thumbKey: text("thumb_key").notNull(),
    included: integer("included", { mode: "boolean" }).notNull().default(true),
    quality: text("quality", { mode: "json" }).$type<ImageQuality>(),
    createdAt: createdAt(),
  },
  (t) => [index("scan_images_project_idx").on(t.projectId, t.position)],
);

/** A "model" is the lineage of versions belonging to a project (one per project today; kept separate for multi-part projects). */
export const models = sqliteTable("models", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"reconstructed" | "uploaded" | "designed">().notNull(),
  provider: text("provider"),
  createdAt: createdAt(),
});

export type VersionSource = "reconstruct" | "upload" | "design" | "edit" | "resize" | "repair" | "orient";

export const modelVersions = sqliteTable(
  "model_versions",
  {
    id: id(),
    modelId: text("model_id").notNull().references(() => models.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    parentVersionId: text("parent_version_id"),
    source: text("source").$type<VersionSource>().notNull(),
    /** prompt / instruction that created this version */
    prompt: text("prompt"),
    note: text("note"),
    storageKey: text("storage_key").notNull(), // binary STL
    previewKey: text("preview_key"),
    dimX: real("dim_x").notNull(),
    dimY: real("dim_y").notNull(),
    dimZ: real("dim_z").notNull(),
    triangles: integer("triangles").notNull(),
    settings: text("settings", { mode: "json" }).$type<Partial<PrintSettings>>(),
    report: text("report", { mode: "json" }).$type<PrintReport | null>(),
    createdAt: createdAt(),
  },
  (t) => [index("versions_project_idx").on(t.projectId, t.number)],
);

export const prompts = sqliteTable(
  "prompts",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant" | "system">().notNull(),
    content: text("content").notNull(),
    versionId: text("version_id"),
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown> | null>(),
    createdAt: createdAt(),
  },
  (t) => [index("prompts_project_idx").on(t.projectId, t.createdAt)],
);

export const printProfiles = sqliteTable("print_profiles", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  settings: text("settings", { mode: "json" }).$type<Partial<PrintSettings>>().notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
});

export type JobKind = "analyze" | "reconstruct" | "chat";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export const jobs = sqliteTable(
  "jobs",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").$type<JobKind>().notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    stage: text("stage"),
    input: text("input", { mode: "json" }).$type<Record<string, unknown>>(),
    /** resumable provider state (e.g. external task id) – lets a restarted worker continue instead of paying twice */
    state: text("state", { mode: "json" }).$type<Record<string, unknown>>(),
    result: text("result", { mode: "json" }).$type<Record<string, unknown> | null>(),
    error: text("error"),
    errorCode: text("error_code"),
    createdAt: createdAt(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("jobs_status_idx").on(t.status, t.createdAt), index("jobs_project_idx").on(t.projectId)],
);

export type Project = typeof projects.$inferSelect;
export type ScanImage = typeof scanImages.$inferSelect;
export type ModelVersion = typeof modelVersions.$inferSelect;
export type Prompt = typeof prompts.$inferSelect;
export type Job = typeof jobs.$inferSelect;
