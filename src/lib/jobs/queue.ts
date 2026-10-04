import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "../db/client";
import { env } from "../env";
import { newId } from "../ids";
import type { JobKind } from "../db/schema";
import { runHandler } from "./handlers";

const { jobs } = schema;

/**
 * Durable background jobs.
 *  • Jobs live in the DB, so the user can close the page / restart the server and come back later.
 *  • A single in-process worker polls the table (SQLite = single node). To scale out, run the same
 *    `processNext` loop in a dedicated worker, or swap this file for BullMQ / Inngest / pg-boss –
 *    handlers are queue-agnostic.
 *  • Jobs that were "running" when the process died are re-queued; provider state (e.g. Meshy task id)
 *    is persisted in `jobs.state` so they resume instead of starting (and paying) twice.
 */
const CONCURRENCY = 2;
const g = globalThis as unknown as { __nelisWorker?: { timer: NodeJS.Timeout; running: Set<string> } };

export function enqueueJob(projectId: string, kind: JobKind, input: Record<string, unknown> = {}) {
  const id = newId("j_");
  getDb().insert(jobs).values({ id, projectId, kind, status: "queued", input, state: {} }).run();
  ensureWorker();
  return id;
}

export function ensureWorker() {
  if (g.__nelisWorker) return;
  const db = getDb();
  db.update(jobs).set({ status: "queued", stage: "Resuming after restart" }).where(eq(jobs.status, "running")).run();
  const running = new Set<string>();
  const tick = () => {
    void processNext(running);
    void maybePurge();
  };
  g.__nelisWorker = { timer: setInterval(tick, 1000), running };
  g.__nelisWorker.timer.unref?.();
  tick();
}

async function processNext(running: Set<string>) {
  if (running.size >= CONCURRENCY) return;
  const db = getDb();
  const next = db.select().from(jobs).where(eq(jobs.status, "queued")).orderBy(asc(jobs.createdAt)).limit(1).get();
  if (!next || running.has(next.id)) return;
  running.add(next.id);
  db.update(jobs).set({ status: "running", startedAt: new Date(), progress: Math.max(next.progress, 1) }).where(eq(jobs.id, next.id)).run();
  try {
    const result = await runHandler(next.id);
    db.update(jobs).set({ status: "succeeded", progress: 100, stage: "Done", result: result ?? null, finishedAt: new Date() }).where(eq(jobs.id, next.id)).run();
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "UNKNOWN";
    const hint = (e as { hint?: string })?.hint;
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[job ${next.id}] ${next.kind} failed:`, e);
    db.update(jobs).set({ status: "failed", error: hint ? `${message} ${hint}` : message, errorCode: code, finishedAt: new Date() }).where(eq(jobs.id, next.id)).run();
  } finally {
    running.delete(next.id);
  }
}

let lastPurge = 0;
async function maybePurge() {
  if (!env.scanRetentionHours || Date.now() - lastPurge < 10 * 60_000) return;
  lastPurge = Date.now();
  const { purgeExpiredScanImages } = await import("../services/privacy");
  await purgeExpiredScanImages(env.scanRetentionHours).catch((e) => console.error("[purge]", e));
}

export function updateJob(id: string, patch: Partial<typeof jobs.$inferInsert>) {
  getDb().update(jobs).set(patch).where(eq(jobs.id, id)).run();
}

export function getJob(id: string) {
  return getDb().select().from(jobs).where(eq(jobs.id, id)).get();
}

export function cancelQueuedJobs(projectId: string) {
  getDb().update(jobs).set({ status: "cancelled", finishedAt: new Date() }).where(and(eq(jobs.projectId, projectId), inArray(jobs.status, ["queued"]))).run();
}

export function hasActiveJob(projectId: string, kinds?: JobKind[]) {
  const rows = getDb().select().from(jobs).where(and(eq(jobs.projectId, projectId), inArray(jobs.status, ["queued", "running"]))).all();
  return rows.some((r) => !kinds || kinds.includes(r.kind));
}

void lt;
