import { db, auditLogTable, type AuditLog } from "@workspace/db";
import { desc, eq, and, gte, lte, asc, sql, type SQL } from "drizzle-orm";
import crypto from "crypto";

export type AuditAction = AuditLog["action"];

/**
 * S28 — tamper-resistant hash chain. Each row commits to its own fields plus
 * the previous row's hash, so an attacker (or a rogue DB admin) who edits or
 * deletes a historical row breaks the chain from that point forward — the
 * break is detectable by verifyAuditChain() by recomputing hashes in order,
 * without requiring a separate write-once store. Not a substitute for DB
 * access control — a defense-in-depth tamper *detector*, not a tamper
 * *preventer*.
 */
function computeEntryHash(input: {
  eventUuid: string;
  sequenceNum: number;
  prevHash: string | null;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: Record<string, unknown> | undefined;
  createdAtIso: string;
}): string {
  const canonical = JSON.stringify({
    eventUuid: input.eventUuid,
    sequenceNum: input.sequenceNum,
    prevHash: input.prevHash,
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    detail: input.detail ?? null,
    createdAtIso: input.createdAtIso,
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * Records a platform-wide audit entry — both admin actions (role changes,
 * subscription/payment overrides, content publish/unpublish) and
 * self-service actions a user takes on their own account (API key creation,
 * consent, data export/deletion). `actorUserId` is whoever performed the
 * action, which for self-service events is the same as `targetId`. See
 * lib/db/src/schema/audit-log.ts for the full action enum.
 *
 * Appends to the tamper-evident hash chain — always call this rather than
 * inserting into auditLogTable directly, or the chain will break.
 */
export async function logAudit(
  actorUserId: string,
  action: AuditAction,
  targetType: string,
  targetId: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  // Serialize chain appends: reading the tail and inserting the next link
  // must be atomic with respect to concurrent writers, or two concurrent
  // inserts could compute the same prevHash/sequenceNum and silently corrupt
  // the chain. A single Postgres advisory lock (scoped to this table) is
  // cheap and correct without needing a dedicated queue.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('audit_log_chain'))`);
    const [tail] = await tx.select({ sequenceNum: auditLogTable.sequenceNum, hash: auditLogTable.hash })
      .from(auditLogTable)
      .orderBy(desc(auditLogTable.sequenceNum))
      .limit(1);

    const sequenceNum = (tail?.sequenceNum ?? 0) + 1;
    const prevHash = tail?.hash ?? null;
    const eventUuid = crypto.randomUUID();
    const createdAt = new Date();
    const hash = computeEntryHash({
      eventUuid, sequenceNum, prevHash, actorUserId, action, targetType, targetId, detail,
      createdAtIso: createdAt.toISOString(),
    });

    await tx.insert(auditLogTable).values({
      actorUserId, action, targetType, targetId, detail,
      createdAt, eventUuid, sequenceNum, prevHash, hash,
    });
  });
}

export interface AuditChainVerification {
  ok: boolean;
  rowsChecked: number;
  brokenAt: { sequenceNum: number; id: number } | null;
}

/**
 * Recomputes the hash chain over all currently-stored rows and reports the
 * first break, if any. O(n) over the whole table — intended for on-demand
 * admin verification, not a hot path.
 *
 * Note: the audit-retention sweep (auditRetention.ts) prunes rows older than
 * AUDIT_LOG_RETENTION_DAYS, which necessarily removes the earliest links in
 * the chain. That is an intentional, policy-driven prune, not tampering, so
 * verification treats the oldest *surviving* row's prevHash as the trusted
 * starting point rather than requiring it to be null — only breaks *among
 * currently-stored rows* are flagged.
 */
export async function verifyAuditChain(): Promise<AuditChainVerification> {
  const rows = await db.select().from(auditLogTable).orderBy(asc(auditLogTable.sequenceNum));
  let expectedPrevHash: string | null = rows[0]?.prevHash ?? null;
  let rowsChecked = 0;
  for (const row of rows) {
    const recomputed = computeEntryHash({
      eventUuid: row.eventUuid,
      sequenceNum: row.sequenceNum,
      prevHash: row.prevHash,
      actorUserId: row.actorUserId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      detail: row.detail ?? undefined,
      createdAtIso: row.createdAt.toISOString(),
    });
    rowsChecked++;
    if (row.prevHash !== expectedPrevHash || recomputed !== row.hash) {
      return { ok: false, rowsChecked, brokenAt: { sequenceNum: row.sequenceNum, id: row.id } };
    }
    expectedPrevHash = row.hash;
  }
  return { ok: true, rowsChecked, brokenAt: null };
}

export interface AuditLogFilters {
  action?: string;
  actorUserId?: string;
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
}

export async function listAuditLog(filters: AuditLogFilters, limit = 500) {
  const conditions: SQL[] = [];
  if (filters.action) conditions.push(eq(auditLogTable.action, filters.action as AuditAction));
  if (filters.actorUserId) conditions.push(eq(auditLogTable.actorUserId, filters.actorUserId));
  if (filters.targetType) conditions.push(eq(auditLogTable.targetType, filters.targetType));
  if (filters.targetId) conditions.push(eq(auditLogTable.targetId, filters.targetId));
  if (filters.from) conditions.push(gte(auditLogTable.createdAt, filters.from));
  if (filters.to) conditions.push(lte(auditLogTable.createdAt, filters.to));

  const query = db.select().from(auditLogTable).orderBy(desc(auditLogTable.createdAt)).limit(limit);
  if (conditions.length === 0) return query;
  return query.where(and(...conditions));
}

/**
 * Self-service view: a normal user's own audit trail — actions they
 * performed themselves (actorUserId) OR actions taken on their account by
 * someone else, e.g. an admin support action (targetType "user", targetId
 * their own id). Never accepts an arbitrary userId from the client — always
 * call with the caller's own authenticated id.
 */
export async function listOwnAuditLog(userId: string, limit = 200) {
  return db.select().from(auditLogTable)
    .where(sql`${auditLogTable.actorUserId} = ${userId} OR (${auditLogTable.targetType} = 'user' AND ${auditLogTable.targetId} = ${userId})`)
    .orderBy(desc(auditLogTable.createdAt))
    .limit(limit);
}
