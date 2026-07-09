/**
 * S26 — Audit log retention.
 *
 * Compliance requirement: keep admin audit history for a bounded, documented
 * window instead of growing the table forever. Default is 2 years (typical
 * financial-services audit retention baseline); override with
 * AUDIT_LOG_RETENTION_DAYS if the business needs a different window.
 */
import { db, auditLogTable } from "@workspace/db";
import { lt, sql } from "drizzle-orm";
import { logger } from "./logger";

export const AUDIT_LOG_RETENTION_DAYS = Number(process.env.AUDIT_LOG_RETENTION_DAYS ?? 730);

export async function pruneExpiredAuditLogs(): Promise<number> {
  const cutoff = new Date(Date.now() - AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await db.delete(auditLogTable).where(lt(auditLogTable.createdAt, cutoff)).returning({ id: auditLogTable.id });
  if (deleted.length > 0) {
    logger.info({ count: deleted.length, cutoff }, "auditRetention: pruned expired audit log rows");
  }
  return deleted.length;
}

export async function getAuditLogRetentionInfo() {
  const [{ count }] = await db.execute<{ count: string }>(sql`SELECT count(*) as count FROM audit_log`).then((r) => r.rows);
  const [oldest] = await db.select({ createdAt: auditLogTable.createdAt }).from(auditLogTable).orderBy(auditLogTable.createdAt).limit(1);
  return {
    retentionDays: AUDIT_LOG_RETENTION_DAYS,
    totalRows: Number(count),
    oldestEntryAt: oldest?.createdAt ?? null,
  };
}

let retentionTimer: ReturnType<typeof setInterval> | null = null;

export function startAuditRetentionSweep(intervalMs = 24 * 60 * 60 * 1_000): void {
  stopAuditRetentionSweep();
  retentionTimer = setInterval(() => {
    pruneExpiredAuditLogs().catch((err) => logger.warn({ err }, "auditRetention: sweep failed"));
  }, intervalMs);
  logger.info({ intervalMs, retentionDays: AUDIT_LOG_RETENTION_DAYS }, "auditRetention: sweep started");
}

export function stopAuditRetentionSweep(): void {
  if (retentionTimer) {
    clearInterval(retentionTimer);
    retentionTimer = null;
  }
}
