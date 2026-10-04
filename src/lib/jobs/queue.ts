import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { after } from "next/server";
import { first, getDb, schema } from "../db/client";
import { env } from "../env";
import { newId } from "../ids";
import type { JobKind } from "../db/schema";
import { type StepResult, runHandler } from "./handlers";

const { jobs } = schema;

/**
 * Durable, serverless-friendly background jobs.
 *  • Jobs live in Postgres, so the user can close the page and come back later.
 *  • No long-running worker: work happens in short *steps* (each ≤ one function invocation).
 *    A step is kicked off right after the request (`after()`), and again whenever the open page polls
 *    the project (see `kickActive`) plus a daily cron safety-net (`/api/cron/maintenance`).
 *  • `locked_until` is both a mutex and a "not before" time, so concurrent kicks never double-run a step.
 *  • Provider state (e.g. the Meshy task id) is stored in `jobs.state`, so a reconstruction is never started (or paid) twice.
 * To use a real queue (Inngest / QStash / BullMQ) call `advanceJob` from its consumer instead of `kick`.
 */
const STEP_LOCK_MS = 290_000; // stay below the 300 s function limit
const POLL_GAP_MS = 4_000; // min gap between provider polls

export async function enqueueJob(projectId: string, kind: JobKind, input: Record<string, unknown> = {}, state: Record<string, unknown> = {}) {
  const id = newId("j_");
  await (await getDb()).insert(jobs).values({ id, projectId, kind, status: "queued", input, state });
  kick(id);
  return id;
}

/** Schedule one step after the current response has been sent. */
export function kick(jobId: string) {
  const run = () => advanceJob(jobId).catch((e) => console.error(`[job ${jobId}]`, e));
  try {
    after(run);
  } catch {
    void run(); // outside a request (scripts / tests)
  }
}

/** Advance every unfinished job of a project (called while the page is polling). */
export async function kickActive(projectId: string) {
  const db = await getDb();
  const rows = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.projectId, projectId), inArray(jobs.status, ["queued", "running"])));
  rows.forEach((r) => kick(r.id));
}

/** Runs ONE step of a job if nobody else holds it. Safe to call concurrently / repeatedly. */
export async function advanceJob(jobId: string): Promise<void> {
  const db = await getDb();
  const now = new Date();
  const [claimed] = await db
    .update(jobs)
    .set({ status: "running", lockedUntil: new Date(now.getTime() + STEP_LOCK_MS), startedAt: now })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ["queued", "running"]), or(isNull(jobs.lockedUntil), lt(jobs.lockedUntil, now))))
    .returning();
  if (!claimed) return;

  try {
    const res: StepResult = await runHandler(claimed);
    if (res.done) {
      await db.update(jobs).set({ status: "succeeded", progress: 100, stage: "Done", result: res.result ?? null, lockedUntil: null, finishedAt: new Date() }).where(eq(jobs.id, jobId));
    } else {
      await db
        .update(jobs)
        .set({ progress: Math.max(1, Math.min(99, Math.round(res.progress))), stage: res.stage, state: res.state ?? claimed.state, lockedUntil: new Date(Date.now() + POLL_GAP_MS) })
        .where(eq(jobs.id, jobId));
    }
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "UNKNOWN";
    const hint = (e as { hint?: string })?.hint;
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[job ${jobId}] ${claimed.kind} failed:`, e);
    await db.update(jobs).set({ status: "failed", error: hint ? `${message} ${hint}` : message, errorCode: code, lockedUntil: null, finishedAt: new Date() }).where(eq(jobs.id, jobId));
  }
}

export async function updateJob(id: string, patch: Partial<typeof jobs.$inferInsert>) {
  await (await getDb()).update(jobs).set(patch).where(eq(jobs.id, id));
}

export async function getJob(id: string) {
  return first((await getDb()).select().from(jobs).where(eq(jobs.id, id)));
}

export async function hasActiveJob(projectId: string, kinds?: JobKind[]) {
  const rows = await (await getDb()).select().from(jobs).where(and(eq(jobs.projectId, projectId), inArray(jobs.status, ["queued", "running"])));
  return rows.some((r) => !kinds || kinds.includes(r.kind));
}

/** Daily safety net: finish orphaned jobs and purge expired scan photos. */
export async function maintenance() {
  const db = await getDb();
  const open = await db.select({ id: jobs.id }).from(jobs).where(inArray(jobs.status, ["queued", "running"]));
  await Promise.all(open.map((j) => advanceJob(j.id)));
  if (env.scanRetentionHours) {
    const { purgeExpiredScanImages } = await import("../services/privacy");
    await purgeExpiredScanImages(env.scanRetentionHours);
  }
  return { advanced: open.length };
}
