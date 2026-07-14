/**
 * S26 — Logical database backups.
 *
 * Replit's managed Postgres already gives us platform-level point-in-time
 * restore (7 days on Core, 28 days on Pro/Teams — via the Database pane),
 * which covers "oops, restore to 20 minutes ago" for the live instance. This
 * service is complementary, not a replacement: it produces portable,
 * downloadable `pg_dump` snapshots in object storage, which is what you
 * actually need for (a) environment recreation on a *different* database
 * instance, (b) exporting an audit-able artifact for compliance retention
 * beyond the PITR window, and (c) our own validation/retention/dashboard
 * visibility layered on top of pg_dump's guarantees. See
 * docs/DISASTER_RECOVERY.md for how the two mechanisms fit together.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db, backupRecordsTable } from "@workspace/db";
import { desc, eq, lt } from "drizzle-orm";
import { logger } from "./logger";
import { objectStorageClient } from "./objectStorage";
import { logAudit } from "./auditLog";
import { emitPlatformAlert } from "./alerting";

const execFileAsync = promisify(execFile);

const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
const BACKUP_OBJECT_PREFIX = "backups/db";

/** Strips anything resembling a connection string / credential-bearing URL out of an error message before it's persisted or logged. */
function sanitizeErrorMessage(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[redacted-connection-string]");
}

function getBucketAndPrivateDir(): { bucketName: string; privateDir: string } {
  const privateDir = process.env.PRIVATE_OBJECT_DIR ?? "";
  if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR not set — object storage is not configured");
  // Matches objectStorage.ts's parseObjectPath convention: the path is
  // "/<bucketName>/<...>", so the bucket is the FIRST segment after the
  // leading slash, not the second.
  const [bucketName] = privateDir.replace(/^\//, "").split("/");
  if (!bucketName) throw new Error(`Could not parse bucket name from PRIVATE_OBJECT_DIR: ${privateDir}`);
  return { bucketName, privateDir };
}

/** Runs `pg_dump` against DATABASE_URL, uploads the compressed dump to object storage, records + returns the backup row. */
export async function runBackup(triggeredBy: string, backupType: "scheduled" | "manual" = "scheduled"): Promise<number> {
  const [record] = await db.insert(backupRecordsTable).values({ backupType, status: "running", triggeredBy }).returning();

  const tmpFile = path.join(os.tmpdir(), `signalium-backup-${record.id}-${Date.now()}.dump.gz`);
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL not set");

    // Custom format (-Fc) is compressed + supports selective pg_restore; pipe through gzip anyway for an extra layer / consistent extension.
    // DATABASE_URL is passed via env, not interpolated into the command
    // string or args — Node error objects on a failed execFile can include
    // the command/args verbatim, and logging that would leak DB credentials.
    await execFileAsync("bash", ["-c", `pg_dump "$BACKUP_DATABASE_URL" -Fc | gzip > "${tmpFile}"`], {
      maxBuffer: 1024 * 1024 * 512,
      env: { ...process.env, BACKUP_DATABASE_URL: databaseUrl },
    });

    const stat = await fs.stat(tmpFile);
    const buffer = await fs.readFile(tmpFile);
    const checksum = createHash("sha256").update(buffer).digest("hex");

    const { bucketName } = getBucketAndPrivateDir();
    const objectKey = `${BACKUP_OBJECT_PREFIX}/backup-${record.id}-${Date.now()}.dump.gz`;
    const bucket = objectStorageClient.bucket(bucketName);
    await bucket.file(objectKey).save(buffer, { contentType: "application/gzip" });

    const retentionExpiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await db.update(backupRecordsTable).set({
      status: "completed",
      objectPath: objectKey,
      sizeBytes: stat.size,
      checksumSha256: checksum,
      completedAt: new Date(),
      retentionExpiresAt,
    }).where(eq(backupRecordsTable.id, record.id));

    logger.info({ backupId: record.id, sizeBytes: stat.size, objectKey }, "backupService: backup completed");
    await logAudit(triggeredBy, "backup.triggered", "backup_record", String(record.id), { backupType, sizeBytes: stat.size });
    return record.id;
  } catch (err) {
    const message = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
    await db.update(backupRecordsTable).set({ status: "failed", errorMessage: message, completedAt: new Date() }).where(eq(backupRecordsTable.id, record.id));
    // Log only the sanitized message, never the raw error object — a failed
    // execFile's error can include the full command/args, and DATABASE_URL
    // must never end up in logs.
    logger.error({ backupId: record.id, message }, "backupService: backup failed");
    await raiseBackupFailureAlert(record.id, message);
    throw new Error(message);
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

/** Downloads a completed backup and re-verifies its checksum — proves the artifact is intact and restorable, not just that the upload call returned 200. */
export async function validateBackup(backupId: number): Promise<{ valid: boolean; detail: string }> {
  const [record] = await db.select().from(backupRecordsTable).where(eq(backupRecordsTable.id, backupId));
  if (!record) return { valid: false, detail: "Backup record not found" };
  if (!record.objectPath || !record.checksumSha256) return { valid: false, detail: "Backup has no stored object/checksum to validate" };

  try {
    const { bucketName } = getBucketAndPrivateDir();
    const [buffer] = await objectStorageClient.bucket(bucketName).file(record.objectPath).download();
    const checksum = createHash("sha256").update(buffer).digest("hex");
    const valid = checksum === record.checksumSha256;
    await db.update(backupRecordsTable).set({
      status: valid ? "validated" : "validation_failed",
      validatedAt: new Date(),
    }).where(eq(backupRecordsTable.id, backupId));
    return { valid, detail: valid ? "Checksum matches stored object — backup is intact and restorable." : "Checksum mismatch — stored object may be corrupted or tampered with." };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(backupRecordsTable).set({ status: "validation_failed" }).where(eq(backupRecordsTable.id, backupId));
    return { valid: false, detail: `Validation failed: ${message}` };
  }
}

/** Deletes backup objects/rows past their retention window. Never deletes the most recent completed/validated backup even if it's technically expired, so there's always at least one recovery point. */
export async function pruneExpiredBackups(): Promise<number> {
  const expired = await db.select().from(backupRecordsTable).where(lt(backupRecordsTable.retentionExpiresAt, new Date()));
  const [mostRecent] = await db.select().from(backupRecordsTable).orderBy(desc(backupRecordsTable.startedAt)).limit(1);

  let pruned = 0;
  const { bucketName } = getBucketAndPrivateDir();
  for (const record of expired) {
    if (mostRecent && record.id === mostRecent.id) continue;
    try {
      if (record.objectPath) {
        await objectStorageClient.bucket(bucketName).file(record.objectPath).delete({ ignoreNotFound: true });
      }
      await db.delete(backupRecordsTable).where(eq(backupRecordsTable.id, record.id));
      pruned++;
    } catch (err) {
      logger.warn({ err, backupId: record.id }, "backupService: failed to prune expired backup (will retry next sweep)");
    }
  }
  return pruned;
}

/** Human-readable restore steps for a given backup. This never executes a restore against the live database automatically — restoring is a deliberate, admin-run operation (see DISASTER_RECOVERY.md) not something the app should be able to trigger on itself. */
export async function buildRestorePlan(backupId: number, actorUserId: string) {
  const [record] = await db.select().from(backupRecordsTable).where(eq(backupRecordsTable.id, backupId));
  if (!record) throw new Error("Backup record not found");
  if (!record.objectPath) throw new Error("Backup has no stored object to restore from");

  await logAudit(actorUserId, "backup.restore_plan_generated", "backup_record", String(backupId));

  return {
    backupId,
    objectPath: record.objectPath,
    sizeBytes: record.sizeBytes,
    checksumSha256: record.checksumSha256,
    steps: [
      "1. Provision the target Postgres instance (new environment recreation) or confirm you intend to restore over the CURRENT database (destructive — take a fresh backup first).",
      `2. Download the dump from object storage: gsutil cp gs://<bucket>/${record.objectPath} ./restore.dump.gz`,
      "3. Decompress: gunzip restore.dump.gz",
      "4. Restore: pg_restore --clean --if-exists --no-owner -d \"$DATABASE_URL\" restore.dump",
      "5. Run `pnpm --filter @workspace/db run push` if the target schema predates this backup, to reconcile any schema drift.",
      "6. Verify: check row counts on a few core tables, then run the app's /ready endpoint against the restored database.",
      "7. For point-in-time (not just latest-backup) restores, use your database provider's PITR feature instead of this dump — see DISASTER_RECOVERY.md.",
    ],
  };
}

export async function listBackups(limit = 50) {
  return db.select().from(backupRecordsTable).orderBy(desc(backupRecordsTable.startedAt)).limit(limit);
}

async function raiseBackupFailureAlert(backupId: number, error: string): Promise<void> {
  await emitPlatformAlert({
    type: "backup_failure",
    severity: "critical",
    message: `Database backup ${backupId} failed: ${error}`,
    metadata: { backupId },
  });
}

let backupTimer: ReturnType<typeof setInterval> | null = null;

/** Starts the daily scheduled backup + retention prune. Safe to call once at server startup. */
export function startBackupScheduler(intervalMs = 24 * 60 * 60 * 1_000): void {
  stopBackupScheduler();
  backupTimer = setInterval(() => {
    runBackup("scheduler", "scheduled")
      .then(() => pruneExpiredBackups())
      .catch((err) => logger.error({ err }, "backupService: scheduled backup cycle failed"));
  }, intervalMs);
  logger.info({ intervalMs }, "backupService: scheduler started");
}

export function stopBackupScheduler(): void {
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
}
