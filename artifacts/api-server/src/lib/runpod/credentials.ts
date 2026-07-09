/**
 * scoped, short-lived worker credentials issued to the trainer for
 * a specific launched pod. Never hand the trainer the underlying RunPod API
 * key — issue one of these instead (60-minute default lifetime, rotatable,
 * revocable, hashed at rest like the existing API-key pattern).
 */
import crypto from "crypto";
import { db, runpodWorkerCredentialsTable, runpodPodsTable } from "@workspace/db";
import { and, eq, isNull, gt } from "drizzle-orm";
import { logAudit } from "../auditLog";

const DEFAULT_TTL_MS = 60 * 60_000; // 60 minutes, per task requirement

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateToken(): { rawToken: string; tokenHash: string; tokenPrefix: string } {
  const rawToken = `rpw_${crypto.randomBytes(32).toString("hex")}`;
  return { rawToken, tokenHash: hashToken(rawToken), tokenPrefix: rawToken.slice(0, 12) + "..." };
}

export interface IssuedCredential {
  id: number;
  token: string;
  expiresAt: Date;
}

/** Issues a new scoped worker credential for a pod. */
export async function issueWorkerCredential(
  podId: number,
  issuedBy: string,
  scopeLabel?: string,
  ttlMs = DEFAULT_TTL_MS,
): Promise<IssuedCredential> {
  const { rawToken, tokenHash, tokenPrefix } = generateToken();
  const expiresAt = new Date(Date.now() + ttlMs);

  const [row] = await db
    .insert(runpodWorkerCredentialsTable)
    .values({ podId, tokenHash, tokenPrefix, scopeLabel: scopeLabel ?? null, issuedBy, expiresAt })
    .returning();

  await logAudit(issuedBy, "runpod_credential.issued", "runpod_worker_credential", String(row.id), {
    podId,
    scopeLabel,
    expiresAt: expiresAt.toISOString(),
  });

  return { id: row.id, token: rawToken, expiresAt };
}

/** Revokes an existing credential immediately and issues a fresh replacement for the same pod. */
export async function rotateWorkerCredential(credentialId: number, actorUserId: string, ttlMs = DEFAULT_TTL_MS): Promise<IssuedCredential> {
  const [existing] = await db.select().from(runpodWorkerCredentialsTable).where(eq(runpodWorkerCredentialsTable.id, credentialId));
  if (!existing) throw new Error("Credential not found");

  await db
    .update(runpodWorkerCredentialsTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(runpodWorkerCredentialsTable.id, credentialId), isNull(runpodWorkerCredentialsTable.revokedAt)));

  const { rawToken, tokenHash, tokenPrefix } = generateToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  const [row] = await db
    .insert(runpodWorkerCredentialsTable)
    .values({
      podId: existing.podId,
      tokenHash,
      tokenPrefix,
      scopeLabel: existing.scopeLabel,
      issuedBy: actorUserId,
      expiresAt,
      rotatedFromId: existing.id,
    })
    .returning();

  await logAudit(actorUserId, "runpod_credential.rotated", "runpod_worker_credential", String(row.id), {
    rotatedFromId: existing.id,
    podId: existing.podId,
  });

  return { id: row.id, token: rawToken, expiresAt };
}

export async function revokeWorkerCredential(credentialId: number, actorUserId: string): Promise<void> {
  const [row] = await db
    .update(runpodWorkerCredentialsTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(runpodWorkerCredentialsTable.id, credentialId), isNull(runpodWorkerCredentialsTable.revokedAt)))
    .returning();
  if (!row) return; // already revoked / doesn't exist — idempotent
  await logAudit(actorUserId, "runpod_credential.revoked", "runpod_worker_credential", String(credentialId), { podId: row.podId });
}

/**
 * Verifies a raw worker token presented by the trainer, returning the pod it
 * is scoped to if the credential is unrevoked and unexpired. Used by
 * whatever trainer-facing endpoint needs to authenticate a worker request
 * against a specific pod (out of scope to build that endpoint here, but this
 * is the verification primitive it should call).
 */
export async function verifyWorkerCredential(rawToken: string): Promise<{ podId: number } | null> {
  const tokenHash = hashToken(rawToken);
  const [row] = await db
    .select()
    .from(runpodWorkerCredentialsTable)
    .where(
      and(
        eq(runpodWorkerCredentialsTable.tokenHash, tokenHash),
        isNull(runpodWorkerCredentialsTable.revokedAt),
        gt(runpodWorkerCredentialsTable.expiresAt, new Date()),
      ),
    );
  if (!row) return null;
  return { podId: row.podId };
}

export async function listCredentialsForPod(podId: number) {
  return db.select().from(runpodWorkerCredentialsTable).where(eq(runpodWorkerCredentialsTable.podId, podId));
}
