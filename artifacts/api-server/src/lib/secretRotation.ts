/**
 * S26 — Secret & key rotation tracking.
 *
 * We cannot programmatically rotate most of these from application code —
 * Clerk keys and webhook signing secrets are managed outside this app (Clerk
 * dashboard / Replit secrets), and rotating them here would just be a fake
 * button. What this module actually does:
 *  - tracks a due-date per secret/key based on a configurable rotation interval
 *  - raises a platform alert when a rotation is overdue (reusing the existing
 *    alerting pipeline, so it shows up next to every other ops alert)
 *  - records rotation *events* with an actor + timestamp for audit purposes
 *  - the one secret this platform genuinely can rotate itself — the SSO
 *    signing key (see sso.ts `rotateSigningKey`) — writes its rotation event
 *    into this same table, so operators see one unified rotation calendar
 *    instead of two disconnected systems.
 */
import { db, secretRotationTable, platformAlertsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { logAudit } from "./auditLog";
import { emitPlatformAlert } from "./alerting";

export interface SecretDefinition {
  secretName: string;
  category: "api_key" | "signing_key" | "webhook_secret" | "db_credential";
  rotationIntervalDays: number;
  notes?: string;
}

/** Known secrets/keys this platform depends on. Extend as new integrations are added. */
export const KNOWN_SECRETS: SecretDefinition[] = [
  { secretName: "sso_signing_key", category: "signing_key", rotationIntervalDays: 90, notes: "Rotated automatically via the SSO admin panel (rotateSigningKey); old keys stay verifiable until their tokens expire." },
  { secretName: "SESSION_SECRET", category: "signing_key", rotationIntervalDays: 180, notes: "Rotate via your environment secrets. Rotating invalidates any externalized session state signed with the old value." },
  { secretName: "DATABASE_URL", category: "db_credential", rotationIntervalDays: 365, notes: "Credential rotation is managed by your database provider; mark rotated here after confirming via the database admin panel." },
];

/** Ensures every known secret has a tracking row (idempotent — call at startup). */
export async function seedSecretRotationTracking(): Promise<void> {
  for (const def of KNOWN_SECRETS) {
    const [existing] = await db.select().from(secretRotationTable).where(eq(secretRotationTable.secretName, def.secretName));
    if (!existing) {
      await db.insert(secretRotationTable).values({
        secretName: def.secretName,
        category: def.category,
        rotationIntervalDays: def.rotationIntervalDays,
        notes: def.notes,
      });
    }
  }
}

export interface RotationStatus {
  secretName: string;
  category: string;
  rotationIntervalDays: number;
  lastRotatedAt: Date | null;
  lastRotatedBy: string | null;
  notes: string | null;
  dueAt: Date | null;
  status: "current" | "due_soon" | "overdue" | "never_rotated";
}

function computeStatus(row: { rotationIntervalDays: number; lastRotatedAt: Date | null }): { dueAt: Date | null; status: RotationStatus["status"] } {
  if (!row.lastRotatedAt) return { dueAt: null, status: "never_rotated" };
  const dueAt = new Date(row.lastRotatedAt.getTime() + row.rotationIntervalDays * 24 * 60 * 60 * 1000);
  const daysUntilDue = (dueAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  if (daysUntilDue < 0) return { dueAt, status: "overdue" };
  if (daysUntilDue < 14) return { dueAt, status: "due_soon" };
  return { dueAt, status: "current" };
}

export async function getRotationStatuses(): Promise<RotationStatus[]> {
  const rows = await db.select().from(secretRotationTable);
  return rows.map((row) => {
    const { dueAt, status } = computeStatus(row);
    return {
      secretName: row.secretName,
      category: row.category,
      rotationIntervalDays: row.rotationIntervalDays,
      lastRotatedAt: row.lastRotatedAt,
      lastRotatedBy: row.lastRotatedBy,
      notes: row.notes,
      dueAt,
      status,
    };
  });
}

/** Records that a secret was rotated (manually, outside this app) — updates the due-date calendar and writes an audit entry. */
export async function markSecretRotated(secretName: string, actorUserId: string): Promise<void> {
  const [updated] = await db.update(secretRotationTable).set({
    lastRotatedAt: new Date(),
    lastRotatedBy: actorUserId,
    updatedAt: new Date(),
  }).where(eq(secretRotationTable.secretName, secretName)).returning();
  if (!updated) throw new Error(`Unknown secret: ${secretName}`);
  await logAudit(actorUserId, "secret_rotation.marked_rotated", "secret_rotation", secretName);
}

/** Sweeps for overdue rotations and raises one deduped alert per secret. Call on the same cadence as the other alert sweeps. */
export async function checkOverdueRotations(): Promise<void> {
  const statuses = await getRotationStatuses();
  const overdue = statuses.filter((s) => s.status === "overdue");
  for (const secret of overdue) {
    try {
      const existing = await db.select().from(platformAlertsTable).where(eq(platformAlertsTable.type, "secret_rotation_overdue"));
      const alreadyOpen = existing.some((a) => !a.acknowledged && (a.metadata as Record<string, unknown> | null)?.secretName === secret.secretName);
      if (alreadyOpen) continue;
      await emitPlatformAlert({
        type: "secret_rotation_overdue",
        severity: "warning",
        message: `Secret "${secret.secretName}" is overdue for rotation (due ${secret.dueAt?.toISOString() ?? "unknown"}).`,
        metadata: { secretName: secret.secretName },
      });
    } catch (err) {
      logger.warn({ err, secretName: secret.secretName }, "secretRotation: failed to raise overdue alert (non-fatal)");
    }
  }
}
