/**
 * C8 Platform Integration — Command retry sweep
 *
 * Sweeps `trainer_actions` for commands stuck in `delivered` status that the
 * EA has not acknowledged within ACKED_TTL_MS. On each sweep cycle:
 *   1. Commands within MAX_RETRIES are reset to `queued` and their
 *      retry_count incremented — deliverAction() will pick them up on the
 *      next reconnect / poll / redeliver call.
 *   2. Commands that have exhausted MAX_RETRIES are marked `failed`.
 *
 * The sweep is reentrancy-guarded so a slow DB round trip can never cause
 * concurrent sweeps to pile up (same pattern as S23a platform-health monitor).
 */

import { db, trainerActionsTable } from "@workspace/db";
import { and, eq, lt, gte, sql } from "drizzle-orm";
import { logger } from "./logger";
import { deliverAction } from "../ws/eaGateway";

/** Delivered actions not acked within this window are eligible for retry. */
const ACKED_TTL_MS = 2 * 60 * 1_000; // 2 minutes

/** After this many retries the command is marked failed and not retried again. */
const MAX_RETRIES = 3;

let sweepRunning = false;

export async function runCommandRetrySweep(): Promise<void> {
  if (sweepRunning) return;
  sweepRunning = true;
  try {
    await sweep();
  } finally {
    sweepRunning = false;
  }
}

async function sweep(): Promise<void> {
  const cutoff = new Date(Date.now() - ACKED_TTL_MS);

  // ── 1. Expire exhausted deliveries → failed ────────────────────────────
  const [failedResult] = await db
    .update(trainerActionsTable)
    .set({ status: "failed" })
    .where(
      and(
        eq(trainerActionsTable.status, "delivered"),
        lt(trainerActionsTable.deliveredAt, cutoff),
        gte(trainerActionsTable.retryCount, MAX_RETRIES),
      ),
    )
    .returning({ id: trainerActionsTable.id });

  const failedIds = Array.isArray(failedResult) ? failedResult : (failedResult ? [failedResult] : []);
  if (failedIds.length > 0) {
    logger.warn({ count: failedIds.length }, "Command retry: exhausted retries — marked failed");
  }

  // ── 2. Re-queue eligible delivered actions ─────────────────────────────
  // Reset to `queued` so deliverAction() can attempt immediate re-delivery
  // when the EA is online, or the EA's next poll picks them up.
  const requeued = await db
    .update(trainerActionsTable)
    .set({
      status: "queued",
      retryCount: sql`${trainerActionsTable.retryCount} + 1`,
      deliveredAt: null,
    })
    .where(
      and(
        eq(trainerActionsTable.status, "delivered"),
        lt(trainerActionsTable.deliveredAt, cutoff),
      ),
    )
    .returning({ id: trainerActionsTable.id, eaRegistrationId: trainerActionsTable.eaRegistrationId });

  const requeuable = Array.isArray(requeued) ? requeued : (requeued ? [requeued] : []);

  if (requeuable.length > 0) {
    logger.info({ count: requeuable.length }, "Command retry: re-queued delivered actions for retry");
    // Attempt immediate re-delivery for any online EAs.
    for (const row of requeuable) {
      deliverAction(row.id).catch((err: unknown) =>
        logger.warn({ err, actionId: row.id }, "Command retry: immediate re-delivery failed (will retry next sweep)"),
      );
    }
  }
}

export function startCommandRetrySweep(intervalMs = 60_000): NodeJS.Timeout {
  logger.info({ intervalMs }, "Command retry sweep started");
  return setInterval(() => {
    runCommandRetrySweep().catch((err: unknown) =>
      logger.error({ err }, "Command retry sweep failed"),
    );
  }, intervalMs);
}
