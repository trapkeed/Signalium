/**
 * S26 — Durable, DB-backed job queue.
 *
 * No Redis/BullMQ in this stack (see platformHealth.ts) — the queue lives in
 * Postgres, which every instance already connects to, giving durability
 * across restarts/deploys for free. Supports:
 *  - priority ordering (lower number = dispatched first)
 *  - delayed retry with exponential backoff (`nextAttemptAt`)
 *  - dead-letter after `maxAttempts` exhausted
 *  - row-level locking (`SELECT ... FOR UPDATE SKIP LOCKED`) so multiple
 *    horizontally-scaled instances can run the worker loop concurrently
 *    without double-processing a job.
 */
import { db, jobQueueTable } from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { getInstanceId } from "./pgBroadcast";
import { emitPlatformAlert, hasRecentPlatformAlert } from "./alerting";

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

const handlers = new Map<string, JobHandler>();
let workerTimer: ReturnType<typeof setInterval> | null = null;
let dispatchInFlight = false;

/** Registers the function that processes jobs enqueued under `queueName`. */
export function registerJobHandler(queueName: string, handler: JobHandler): void {
  handlers.set(queueName, handler);
}

export interface EnqueueOptions {
  priority?: number; // lower = sooner, default 100
  maxAttempts?: number;
  delayMs?: number; // delay before first attempt
}

export async function enqueueJob(queueName: string, payload: Record<string, unknown>, options: EnqueueOptions = {}): Promise<number> {
  const nextAttemptAt = options.delayMs ? new Date(Date.now() + options.delayMs) : new Date();
  const [row] = await db.insert(jobQueueTable).values({
    queueName,
    payload,
    priority: options.priority ?? 100,
    maxAttempts: options.maxAttempts ?? 5,
    nextAttemptAt,
  }).returning({ id: jobQueueTable.id });
  return row.id;
}

/** Backoff schedule for automatic retries: 30s, 2m, 10m, 30m, 1h (capped). `attempts` is the 1-based count of attempts made so far, so the 1st retry (attempts=1) maps to schedule[0]. */
function backoffDelayMs(attempts: number): number {
  const schedule = [30_000, 120_000, 600_000, 1_800_000, 3_600_000];
  return schedule[Math.min(attempts - 1, schedule.length - 1)];
}

/** Claims and processes up to `batchSize` due jobs across all registered queues. Safe to call concurrently from multiple instances. */
export async function dispatchDueJobs(batchSize = 10): Promise<number> {
  if (dispatchInFlight) return 0;
  dispatchInFlight = true;
  let processed = 0;
  try {
    for (let i = 0; i < batchSize; i++) {
      const claimed = await claimNextJob();
      if (!claimed) break;
      await processJob(claimed);
      processed++;
    }
  } finally {
    dispatchInFlight = false;
  }
  return processed;
}

interface ClaimedJob {
  id: number;
  queueName: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

interface ClaimedJobRow extends Record<string, unknown> {
  id: number;
  queue_name: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

async function claimNextJob(): Promise<ClaimedJob | null> {
  // Atomic claim: SKIP LOCKED lets concurrent workers (other instances) skip
  // rows already being claimed rather than blocking on them.
  const result = await db.execute<ClaimedJobRow>(sql`
    UPDATE job_queue
    SET status = 'processing', locked_by = ${getInstanceId()}, locked_at = now(), updated_at = now()
    WHERE id = (
      SELECT id FROM job_queue
      WHERE status = 'pending' AND next_attempt_at <= now()
      ORDER BY priority ASC, next_attempt_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, queue_name, payload, attempts, max_attempts
  `);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    queueName: row.queue_name,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  };
}

async function processJob(job: ClaimedJob): Promise<void> {
  const handler = handlers.get(job.queueName);
  if (!handler) {
    logger.warn({ queueName: job.queueName, jobId: job.id }, "jobQueue: no handler registered — sending straight to dead letter");
    await db.update(jobQueueTable).set({ status: "dead_letter", lastError: "No handler registered for queue", updatedAt: new Date() }).where(eq(jobQueueTable.id, job.id));
    return;
  }

  try {
    await handler(job.payload);
    await db.update(jobQueueTable).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() }).where(eq(jobQueueTable.id, job.id));
  } catch (err) {
    const attempts = job.attempts + 1;
    const message = err instanceof Error ? err.message : String(err);
    if (attempts >= job.maxAttempts) {
      await db.update(jobQueueTable).set({
        status: "dead_letter",
        attempts,
        lastError: message,
        updatedAt: new Date(),
      }).where(eq(jobQueueTable.id, job.id));
      logger.error({ jobId: job.id, queueName: job.queueName, err }, "jobQueue: job exhausted retries — moved to dead letter");
      await raiseDeadLetterAlert(job.queueName, job.id, message);
    } else {
      await db.update(jobQueueTable).set({
        status: "pending",
        attempts,
        lastError: message,
        nextAttemptAt: new Date(Date.now() + backoffDelayMs(attempts)),
        updatedAt: new Date(),
      }).where(eq(jobQueueTable.id, job.id));
      logger.warn({ jobId: job.id, queueName: job.queueName, attempts, err }, "jobQueue: job failed — scheduled for retry");
    }
  }
}

async function raiseDeadLetterAlert(queueName: string, jobId: number, error: string): Promise<void> {
  if (await hasRecentPlatformAlert("job_queue_dead_letter", 30 * 60_000)) return;
  await emitPlatformAlert({
    type: "job_queue_dead_letter",
    severity: "warning",
    message: `Job ${jobId} in queue "${queueName}" exhausted retries: ${error}`,
    metadata: { queueName, jobId },
  });
}

/** Starts the periodic worker loop. Safe to call once at server startup; multiple instances running this concurrently is expected and safe (SKIP LOCKED). */
export function startJobQueueWorker(intervalMs = 15_000): void {
  stopJobQueueWorker();
  workerTimer = setInterval(() => {
    dispatchDueJobs().catch((err) => logger.warn({ err }, "jobQueue: dispatch cycle failed"));
  }, intervalMs);
  logger.info({ intervalMs }, "jobQueue: worker loop started");
}

export function stopJobQueueWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

export async function getQueueStats() {
  const result = await db.execute<{ queue_name: string; status: string; count: string }>(sql`
    SELECT queue_name, status, count(*) as count FROM job_queue GROUP BY queue_name, status
  `);
  return result.rows;
}

export async function listDeadLetterJobs(limit = 50) {
  return db.select().from(jobQueueTable).where(eq(jobQueueTable.status, "dead_letter")).orderBy(asc(jobQueueTable.updatedAt)).limit(limit);
}

/** Requeues a dead-lettered job for another attempt, resetting its attempt counter. Restricted to `dead_letter` status so this can never rewind an already-completed or currently-processing job. */
export async function requeueJob(jobId: number): Promise<boolean> {
  const result = await db.update(jobQueueTable).set({
    status: "pending",
    attempts: 0,
    nextAttemptAt: new Date(),
    lastError: null,
    updatedAt: new Date(),
  }).where(and(eq(jobQueueTable.id, jobId), eq(jobQueueTable.status, "dead_letter"))).returning({ id: jobQueueTable.id });
  return result.length > 0;
}
