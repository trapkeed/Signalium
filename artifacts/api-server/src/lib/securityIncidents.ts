/**
 * S23c — Shared security-incident emission helper, mirroring the
 * emitPlatformAlert/hasRecentPlatformAlert pattern from S23b's alerting.ts
 * but scoped to security_incidents (auth abuse, signature failures, abnormal
 * trading) instead of platform_alerts (ops health).
 */
import { db, securityIncidentsTable, type SecurityIncident } from "@workspace/db";
import { and, eq, gte } from "drizzle-orm";
import { logger } from "./logger";
import { broadcastOpsEvent } from "../ws/adminOpsGateway";
import { maybeAutoBlockIp } from "../middlewares/ipReputationGate";

export type SecurityIncidentType = typeof securityIncidentsTable.$inferInsert["type"];
export type SecurityIncidentSeverity = typeof securityIncidentsTable.$inferInsert["severity"];

export interface EmitSecurityIncidentInput {
  type: SecurityIncidentType;
  severity: SecurityIncidentSeverity;
  message: string;
  userId?: string | null;
  ipAddress?: string | null;
  apiKeyId?: number | null;
  /**
   * Free-form dedup discriminator for incident types whose real scope isn't
   * one of userId/ipAddress/apiKeyId — e.g. the webhook provider name for
   * invalid_webhook_signature. Without it, all findings of that type would
   * dedup against each other regardless of provider/reason, silently
   * swallowing distinct incidents. Types already scoped by userId/ipAddress/
   * apiKeyId can omit it.
   */
  scopeKey?: string | null;
  detail?: Record<string, unknown>;
  /** Dedup window — defaults to 30 minutes, matching S23b's platform-alert cooldown. */
  dedupWindowMs?: number;
}

/**
 * Inserts a security incident unless an open one of the same type + scope
 * (same userId / ipAddress / apiKeyId, whichever are provided) already
 * exists within the dedup window. Returns null when deduped or on error —
 * callers treat this as fire-and-forget and must never let it throw into a
 * request-handling hot path.
 */
export async function emitSecurityIncident(input: EmitSecurityIncidentInput): Promise<SecurityIncident | null> {
  try {
    const windowMs = input.dedupWindowMs ?? 30 * 60_000;
    const since = new Date(Date.now() - windowMs);
    const conditions = [
      eq(securityIncidentsTable.type, input.type),
      eq(securityIncidentsTable.status, "open"),
      gte(securityIncidentsTable.createdAt, since),
    ];
    if (input.userId) conditions.push(eq(securityIncidentsTable.userId, input.userId));
    if (input.ipAddress) conditions.push(eq(securityIncidentsTable.ipAddress, input.ipAddress));
    if (input.apiKeyId != null) conditions.push(eq(securityIncidentsTable.apiKeyId, input.apiKeyId));
    if (input.scopeKey) conditions.push(eq(securityIncidentsTable.scopeKey, input.scopeKey));

    const [existing] = await db.select({ id: securityIncidentsTable.id })
      .from(securityIncidentsTable)
      .where(and(...conditions))
      .limit(1);
    if (existing) return null;

    const [row] = await db.insert(securityIncidentsTable).values({
      type: input.type,
      severity: input.severity,
      message: input.message,
      userId: input.userId ?? null,
      ipAddress: input.ipAddress ?? null,
      apiKeyId: input.apiKeyId ?? null,
      scopeKey: input.scopeKey ?? null,
      detail: input.detail ?? null,
    }).returning();

    logger.warn({ incidentId: row?.id, type: input.type, severity: input.severity }, "SecurityIncident: emitted");
    if (row) broadcastOpsEvent("security_incident.new", row);
    if (input.ipAddress) void maybeAutoBlockIp(input.ipAddress);
    return row ?? null;
  } catch (err) {
    logger.warn({ err }, "Failed to emit security incident");
    return null;
  }
}
