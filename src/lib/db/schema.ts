import { boolean, customType, doublePrecision, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { PrintSettings } from "../printing/profiles";
import type { PrintReport } from "../geometry/printability";
import type { ObjectAnalysis } from "../ai/types";

const id = () => text("id").primaryKey();
const ts = (name: string) => timestamp(name, { mode: "date", withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const json = <T,>(name: string) => jsonb(name).$type<T>();
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: createdAt(),
});

export type ProjectMode = "reconstruct" | "modify" | "design" | "functional";

export const projects = pgTable(
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
    analysis: json<ObjectAnalysis | null>("analysis"),
    printSettings: json<Partial<PrintSettings>>("print_settings"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("projects_user_idx").on(t.userId, t.updatedAt)],
);

export const scans = pgTable("scans", {
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

export const scanImages = pgTable(
  "scan_images",
  {
    id: id(),
    scanId: text("scan_id").notNull().references(() => scans.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    storageKey: text("storage_key").notNull(),
    thumbKey: text("thumb_key").notNull(),
    included: boolean("included").notNull().default(true),
    quality: json<ImageQuality>("quality"),
    createdAt: createdAt(),
  },
  (t) => [index("scan_images_project_idx").on(t.projectId, t.position)],
);

/** A "model" is the lineage of versions belonging to a project (one per project today; kept separate for multi-part projects). */
export const models = pgTable("models", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"reconstructed" | "uploaded" | "designed">().notNull(),
  provider: text("provider"),
  createdAt: createdAt(),
});

export type VersionSource = "reconstruct" | "upload" | "design" | "edit" | "resize" | "repair" | "orient";

export const modelVersions = pgTable(
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
    dimX: doublePrecision("dim_x").notNull(),
    dimY: doublePrecision("dim_y").notNull(),
    dimZ: doublePrecision("dim_z").notNull(),
    triangles: integer("triangles").notNull(),
    settings: json<Partial<PrintSettings>>("settings"),
    report: json<PrintReport | null>("report"),
    createdAt: createdAt(),
  },
  (t) => [index("versions_project_idx").on(t.projectId, t.number)],
);

export const prompts = pgTable(
  "prompts",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant" | "system">().notNull(),
    content: text("content").notNull(),
    versionId: text("version_id"),
    meta: json<Record<string, unknown> | null>("meta"),
    createdAt: createdAt(),
  },
  (t) => [index("prompts_project_idx").on(t.projectId, t.createdAt)],
);

export const printProfiles = pgTable("print_profiles", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  settings: json<Partial<PrintSettings>>("settings").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: createdAt(),
});

/** Binary object store backed by Postgres (see lib/storage). Keys look like `<project>/models/model-v1.stl`. */
export const files = pgTable("files", {
  key: text("key").primaryKey(),
  data: bytea("data").notNull(),
  size: integer("size").notNull(),
  createdAt: createdAt(),
});

export type JobKind = "analyze" | "reconstruct" | "chat";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").$type<JobKind>().notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    stage: text("stage"),
    input: json<Record<string, unknown>>("input"),
    /** resumable provider state (e.g. external task id) – lets a restarted worker continue instead of paying twice */
    state: json<Record<string, unknown>>("state"),
    result: json<Record<string, unknown> | null>("result"),
    /** serverless job runner: a step holds this lock until it finishes or expires */
    lockedUntil: ts("locked_until"),
    error: text("error"),
    errorCode: text("error_code"),
    createdAt: createdAt(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("jobs_status_idx").on(t.status, t.createdAt), index("jobs_project_idx").on(t.projectId)],
);

export type Project = typeof projects.$inferSelect;
export type ScanImage = typeof scanImages.$inferSelect;
export type ModelVersion = typeof modelVersions.$inferSelect;
export type Prompt = typeof prompts.$inferSelect;
export type Job = typeof jobs.$inferSelect;
