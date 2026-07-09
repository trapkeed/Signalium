/**
 * Task #4 — RunPod GPU orchestration. Signalium owns all RunPod
 * credentials/lifecycle; the trainer never holds a standing RunPod API key
 * and instead receives short-lived scoped worker credentials for a specific
 * launched pod (see runpodWorkerCredentialsTable).
 */

import {
  pgTable,
  pgEnum,
  text,
  serial,
  integer,
  real,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const runpodPodStatusEnum = pgEnum("runpod_pod_status", [
  "pending",       // launch requested, not yet confirmed by RunPod
  "provisioning",  // RunPod is allocating the GPU
  "running",
  "stopped",       // stopped but not terminated — can be restarted, still billed for storage
  "restarting",
  "terminating",
  "terminated",
  "failed",
]);

// ─── Pods ──────────────────────────────────────────────────────────────────

export const runpodPodsTable = pgTable(
  "runpod_pods",
  {
    id: serial("id").primaryKey(),
    /** RunPod's own pod id — null until the launch call succeeds. */
    runpodPodId: text("runpod_pod_id"),
    name: text("name").notNull(),
    gpuType: text("gpu_type").notNull(),
    templateId: text("template_id"),
    volumeId: text("volume_id"),
    region: text("region"),
    status: runpodPodStatusEnum("status").notNull().default("pending"),
    /** Configured/quoted hourly cost for the GPU type, used for budget checks before actuals are known. */
    costPerHrUsd: real("cost_per_hr_usd"),
    /** Latest cost-per-hour reported by RunPod for this running pod, if different from quoted. */
    lastReportedCostPerHrUsd: real("last_reported_cost_per_hr_usd"),
    /** Running total of accrued cost since launch, recomputed on each poll from elapsed running time. */
    accruedCostUsd: real("accrued_cost_usd").notNull().default(0),
    lastUtilizationPct: real("last_utilization_pct"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    lastError: text("last_error"),
    launchedBy: text("launched_by").notNull(),
    launchedAt: timestamp("launched_at", { withTimezone: true }),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    terminatedAt: timestamp("terminated_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("runpod_pods_runpod_pod_id_idx").on(t.runpodPodId),
    index("runpod_pods_status_idx").on(t.status),
  ],
);

export type RunpodPod = typeof runpodPodsTable.$inferSelect;

// ─── Budget configuration (singleton row, id = "global") ────────────────────

export const runpodBudgetConfigTable = pgTable("runpod_budget_config", {
  id: text("id").primaryKey().default("global"),
  maxHourlyCostUsd: real("max_hourly_cost_usd").notNull().default(10),
  maxActivePods: integer("max_active_pods").notNull().default(2),
  autoShutdownIdleMinutes: integer("auto_shutdown_idle_minutes"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RunpodBudgetConfig = typeof runpodBudgetConfigTable.$inferSelect;

// ─── Scoped worker credentials ───────────────────────────────────────────────
// Opaque bearer tokens (hashed at rest, like API keys) that Signalium issues
// to the trainer for a specific pod + short window, instead of ever handing
// out the underlying RunPod API key. Verified via requireRunpodWorkerAuth.

export const runpodWorkerCredentialsTable = pgTable(
  "runpod_worker_credentials",
  {
    id: serial("id").primaryKey(),
    podId: integer("pod_id")
      .notNull()
      .references(() => runpodPodsTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    /** Free-form label for what this credential is for (e.g. a trainer job id). */
    scopeLabel: text("scope_label"),
    issuedBy: text("issued_by").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** If this credential was produced by rotating an older one, points to it — keeps an audit chain. */
    rotatedFromId: integer("rotated_from_id"),
  },
  (t) => [
    uniqueIndex("runpod_worker_credentials_token_hash_idx").on(t.tokenHash),
    index("runpod_worker_credentials_pod_idx").on(t.podId),
    index("runpod_worker_credentials_expires_at_idx").on(t.expiresAt),
  ],
);

export type RunpodWorkerCredential = typeof runpodWorkerCredentialsTable.$inferSelect;
