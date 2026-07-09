/**
 * S23b — Shared platform-alert emission helper.
 *
 * Extracted out of routes/operational.ts (where it originated in S22A) so
 * the new background alert detectors (alertDetectors.ts) can emit alerts
 * through the same path — insert into platform_alerts, then fan out to
 * delivery channels — without importing an Express router module.
 */
import { db, platformAlertsTable } from "@workspace/db";
import { eq, and, gte } from "drizzle-orm";
import { dispatchAlert } from "./alertDispatch";
import { logger } from "./logger";
import { broadcastOpsEvent } from "../ws/adminOpsGateway";

export type PlatformAlertType = typeof platformAlertsTable.$inferInsert["type"];

export async function emitPlatformAlert(opts: {
  type: PlatformAlertType;
  severity: "info" | "warning" | "critical";
  message: string;
  userId?: string | null;
  eaId?: number | null;
  eaInstanceId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    const [row] = await db
      .insert(platformAlertsTable)
      .values({
        type: opts.type,
        severity: opts.severity,
        message: opts.message,
        userId: opts.userId ?? null,
        eaId: opts.eaId ?? null,
        eaInstanceId: opts.eaInstanceId ?? null,
        metadata: opts.metadata ?? null,
      })
      .returning();
    // Fire-and-forget: delivery failures must never block alert creation.
    if (row) {
      dispatchAlert(row).catch((err) => logger.warn({ err }, "Alert dispatch failed"));
      broadcastOpsEvent("alert.new", row);
    }
    return row ?? null;
  } catch (err) {
    logger.warn({ err }, "Failed to emit platform alert");
    return null;
  }
}

/**
 * Dedup guard for platform-wide (non-EA-scoped) alerts, e.g. the S23b
 * detectors. Returns true if an unacknowledged alert of the given type was
 * already created within `windowMs` — mirrors the `hasOpenAlert` pattern
 * used for EA risk alerts in operational.ts, generalized to platform_alerts.
 */
export async function hasRecentPlatformAlert(type: PlatformAlertType, windowMs: number): Promise<boolean> {
  const since = new Date(Date.now() - windowMs);
  const rows = await db
    .select({ id: platformAlertsTable.id })
    .from(platformAlertsTable)
    .where(and(eq(platformAlertsTable.type, type), eq(platformAlertsTable.acknowledged, false), gte(platformAlertsTable.createdAt, since)))
    .limit(1);
  return rows.length > 0;
}
