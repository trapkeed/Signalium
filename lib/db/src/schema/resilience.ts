/**
 * S26 — Scalability, High Availability & Disaster Recovery
 *
 * Tables backing:
 *  - a durable, DB-backed job queue (retry + dead-letter + delayed retry + priority)
 *  - logical backup records (our own pg_dump exports, distinct from Replit's
 *    platform-level automatic PITR on the managed Postgres instance)
 *  - secret/key rotation tracking (rotation due-dates + last-rotated audit trail)
 */
import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  jsonb,
  bigint,
  index,
} from "drizzle-orm/pg-core";

// ─── Durable Job Queue ──────────────────────────────────────────────────────
// A DB-backed queue (no Redis/BullMQ in this stack — see platformHealth.ts).
// Rows move pending -> processing -> completed, or pending -> processing ->
// failed -> (retry: pending again, with backoff via nextAttemptAt) -> after
// maxAttempts, dead_letter. Priority: lower number = processed first.

export const jobQueueTable = pgTable(
  "job_queue",
  {
    id: serial("id").primaryKey(),
    queueName: text("queue_name").notNull(), // logical queue, e.g. "backup", "trade-action-delivery"
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    priority: integer("priority").notNull().default(100), // lower = higher priority
    status: text("status").notNull().default("pending"), // pending | processing | completed | failed | dead_letter
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
    lastError: text("last_error"),
    lockedBy: text("locked_by"), // worker/instance id holding the row while processing
    lockedAt: timestamp("locked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("job_queue_dispatch_idx").on(table.status, table.priority, table.nextAttemptAt),
    index("job_queue_queue_name_idx").on(table.queueName),
  ],
);

// ─── Backup Records ─────────────────────────────────────────────────────────

export const backupRecordsTable = pgTable(
  "backup_records",
  {
    id: serial("id").primaryKey(),
    backupType: text("backup_type").notNull(), // scheduled | manual
    status: text("status").notNull().default("running"), // running | completed | failed | validated | validation_failed
    objectPath: text("object_path"), // path in object storage, once uploaded
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    checksumSha256: text("checksum_sha256"),
    triggeredBy: text("triggered_by"), // userId, or "scheduler"
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
    validatedAt: timestamp("validated_at"),
    retentionExpiresAt: timestamp("retention_expires_at"),
  },
  (table) => [
    index("backup_records_started_at_idx").on(table.startedAt),
    index("backup_records_status_idx").on(table.status),
  ],
);

// ─── Secret / Key Rotation Tracking ─────────────────────────────────────────
// We cannot programmatically rotate most third-party secrets (Clerk keys,
// webhook signing secrets) from application code — this table tracks rotation
// *status and due-dates* so overdue rotations surface as an admin alert, and
// records who last rotated what. The one secret this platform can actually
// rotate itself is the SSO signing key (see sso.ts / rotateSigningKey) — this
// table's row for that key reflects the same rotation event, not a duplicate mechanism.

export const secretRotationTable = pgTable(
  "secret_rotation",
  {
    id: serial("id").primaryKey(),
    secretName: text("secret_name").notNull().unique(), // e.g. "CLERK_SECRET_KEY", "sso_signing_key"
    category: text("category").notNull(), // api_key | signing_key | webhook_secret | db_credential
    rotationIntervalDays: integer("rotation_interval_days").notNull().default(90),
    lastRotatedAt: timestamp("last_rotated_at"),
    lastRotatedBy: text("last_rotated_by"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
);
