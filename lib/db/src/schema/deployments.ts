/**
 * S21B — QDE Runtime Deployment Client and Hot Swap Infrastructure
 *
 * Signalium consumes QDE deployments produced by signalium-trainer. This
 * schema tracks every deployment lifecycle event, health sample, and version
 * transition so the platform has complete deployment traceability.
 */

import {
  pgTable,
  pgEnum,
  text,
  serial,
  timestamp,
  integer,
  real,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── Deployment status enum ───────────────────────────────────────────────────

export const qdeDeploymentStatusEnum = pgEnum("qde_deployment_status", [
  "pending",      // detected from trainer, not yet downloaded
  "downloading",  // artifact download in progress
  "verifying",    // SHA256 integrity check in progress
  "warming",      // test-inference warm-up in progress
  "active",       // currently serving all inference requests
  "retired",      // superseded by a newer active deployment
  "failed",       // failed at some lifecycle stage, rolled back
]);

// ─── QDE Deployments ─────────────────────────────────────────────────────────
// One row per deployment fetched from signalium-trainer. The active deployment
// is the single row with status = 'active'.

export const qdeDeploymentsTable = pgTable(
  "qde_deployments",
  {
    id: serial("id").primaryKey(),
    /** UUID assigned by signalium-trainer — stable identifier across pulls. */
    deploymentId: text("deployment_id").notNull(),
    /** Semantic version from the trainer (e.g. "v2.1.4"). */
    version: text("version").notNull(),
    status: qdeDeploymentStatusEnum("status").notNull().default("pending"),
    /** SHA256 hash of the primary model artifact (weights file). */
    artifactHash: text("artifact_hash"),
    /** SHA256 hash of the deployment manifest JSON. */
    manifestHash: text("manifest_hash"),
    /** Feature-set / preprocessing version (decoupled from model version). */
    featureVersion: text("feature_version"),
    /** Full manifest JSON returned by GET /deployment/manifest/{id}. */
    manifestData: jsonb("manifest_data"),
    /** Local filesystem path where artifacts are cached, or object-storage key. */
    localCachePath: text("local_cache_path"),
    /** Trainer base URL that produced this deployment. */
    trainerUrl: text("trainer_url"),
    /** Whether the download has been verified as integrity-clean. */
    integrityVerified: boolean("integrity_verified").notNull().default(false),
    /** Measured warm-up inference latency in ms (null until warmed). */
    warmupLatencyMs: real("warmup_latency_ms"),
    /** Why this deployment failed or was rejected. */
    failureReason: text("failure_reason"),
    /** Arbitrary trainer metadata (model architecture, training run id, etc.). */
    metadata: jsonb("metadata"),
    downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    warmedAt: timestamp("warmed_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("qde_deployments_deployment_id_idx").on(t.deploymentId),
    index("qde_deployments_status_idx").on(t.status),
    index("qde_deployments_version_idx").on(t.version),
    index("qde_deployments_created_at_idx").on(t.createdAt),
  ],
);

export type QdeDeployment = typeof qdeDeploymentsTable.$inferSelect;

// ─── Deployment Health Snapshots ──────────────────────────────────────────────
// Rolling health samples collected during active operation. One row per
// collection interval (default every 5 minutes while active).

export const qdeDeploymentHealthTable = pgTable(
  "qde_deployment_health",
  {
    id: serial("id").primaryKey(),
    deploymentId: integer("deployment_id")
      .notNull()
      .references(() => qdeDeploymentsTable.id, { onDelete: "cascade" }),
    /** Median inference latency over the collection window. */
    latencyP50Ms: real("latency_p50_ms"),
    /** 95th-percentile inference latency. */
    latencyP95Ms: real("latency_p95_ms"),
    /** 99th-percentile inference latency. */
    latencyP99Ms: real("latency_p99_ms"),
    /** Error rate 0–1 (failed / total calls in window). */
    errorRate: real("error_rate"),
    /** Successful inference calls per minute in the collection window. */
    throughputPerMin: real("throughput_per_min"),
    /** RSS memory consumption reported by the process, in MB. */
    memoryUsageMb: real("memory_usage_mb"),
    /** CPU utilisation 0–100. */
    cpuUsagePct: real("cpu_usage_pct"),
    /** Number of inference samples in this collection window. */
    sampleCount: integer("sample_count").notNull().default(0),
    /**
     * Confidence distribution bucket counts:
     *   { low: N, medium: N, high: N }  where low < 0.4, high > 0.7
     */
    confidenceDistribution: jsonb("confidence_distribution"),
    /** Active alerts raised during this window (latency spikes, error surges). */
    alerts: text("alerts").array(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("qde_deployment_health_deployment_idx").on(t.deploymentId),
    index("qde_deployment_health_recorded_at_idx").on(t.recordedAt),
  ],
);

export type QdeDeploymentHealth = typeof qdeDeploymentHealthTable.$inferSelect;

// ─── Deployment Lifecycle Events ──────────────────────────────────────────────
// Full audit trail of every deployment state transition. Used by the admin
// dashboard to show rollback history and failure investigations.

export const qdeDeploymentEventsTable = pgTable(
  "qde_deployment_events",
  {
    id: serial("id").primaryKey(),
    /** Nullable — some events are global (e.g. "poll found no new version"). */
    deploymentId: integer("deployment_id").references(() => qdeDeploymentsTable.id, {
      onDelete: "set null",
    }),
    /**
     * Event types:
     *   detected          — trainer reported a new deployment version
     *   download_started  — artifact download initiated
     *   downloaded        — all artifacts written to local cache
     *   verify_passed     — SHA256 hashes validated
     *   verify_failed     — hash mismatch or download corruption
     *   warming           — test-inference warm-up started
     *   warmed            — warm-up succeeded within latency threshold
     *   warm_failed       — warm-up timed out or returned error
     *   activated         — deployment became the active version
     *   rollback_triggered — health checks failed; reverting
     *   rolled_back       — previous version restored successfully
     *   retired           — superseded, no longer active
     *   poll_no_change    — trainer polled but no new version detected
     *   health_alert      — abnormal health metric detected
     */
    eventType: text("event_type").notNull(),
    message: text("message"),
    metadata: jsonb("metadata"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("qde_deployment_events_deployment_idx").on(t.deploymentId),
    index("qde_deployment_events_occurred_at_idx").on(t.occurredAt),
    index("qde_deployment_events_type_idx").on(t.eventType),
  ],
);

export type QdeDeploymentEvent = typeof qdeDeploymentEventsTable.$inferSelect;
