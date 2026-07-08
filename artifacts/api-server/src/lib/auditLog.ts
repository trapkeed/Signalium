import { db, auditLogTable, type AuditLog } from "@workspace/db";
import { desc, eq, and, gte, lte, type SQL } from "drizzle-orm";

export type AuditAction = AuditLog["action"];

/**
 * Records a platform-wide admin audit entry. Call this from every admin
 * mutation that changes something significant (role changes, subscription /
 * payment overrides, content publish/unpublish, etc) — see
 * lib/db/src/schema/audit-log.ts for the full action enum.
 */
export async function logAudit(
  actorUserId: string,
  action: AuditAction,
  targetType: string,
  targetId: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await db.insert(auditLogTable).values({ actorUserId, action, targetType, targetId, detail });
}

export interface AuditLogFilters {
  action?: string;
  actorUserId?: string;
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
}

export async function listAuditLog(filters: AuditLogFilters) {
  const conditions: SQL[] = [];
  if (filters.action) conditions.push(eq(auditLogTable.action, filters.action as AuditAction));
  if (filters.actorUserId) conditions.push(eq(auditLogTable.actorUserId, filters.actorUserId));
  if (filters.targetType) conditions.push(eq(auditLogTable.targetType, filters.targetType));
  if (filters.targetId) conditions.push(eq(auditLogTable.targetId, filters.targetId));
  if (filters.from) conditions.push(gte(auditLogTable.createdAt, filters.from));
  if (filters.to) conditions.push(lte(auditLogTable.createdAt, filters.to));

  const query = db.select().from(auditLogTable).orderBy(desc(auditLogTable.createdAt)).limit(500);
  if (conditions.length === 0) return query;
  return query.where(and(...conditions));
}
