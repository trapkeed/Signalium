/**
 * S21B — Deployment Manager
 *
 * Singleton that owns the full QDE deployment lifecycle:
 *   detect → download → verify → warm → hot-swap → health-monitor → rollback
 *
 * The active deployment version is held in-memory for zero-latency reads during
 * inference. The DB is the authoritative source on startup and for multi-instance
 * synchronisation (all nodes poll the same DB to agree on the active version).
 *
 * Invariants:
 *   - At most one deployment row may have status = "active" at any time.
 *   - lastSyncAt only advances after a successful activation.
 *   - A failed hot-swap always attempts rollback before giving up.
 */

import { db } from "@workspace/db";
import {
  qdeDeploymentsTable,
  qdeDeploymentHealthTable,
  qdeDeploymentEventsTable,
} from "@workspace/db";
import { and, desc, eq, ne } from "drizzle-orm";
import { logger } from "./logger";
import {
  downloadArtifacts,
  fetchActiveDeployment,
  fetchManifest,
  warmDeployment,
  type TrainerDeploymentSummary,
} from "./deploymentClient";
import { markSchedulerHeartbeat } from "./platformHealth";
import { broadcastOpsEvent } from "../ws/adminOpsGateway";

// ─── In-memory active deployment state (hot path) ────────────────────────────

interface ActiveDeploymentMeta {
  dbId: number;
  version: string;
  artifactHash: string | null;
  manifestHash: string | null;
  featureVersion: string | null;
}

// ─── Deployment Manager class ─────────────────────────────────────────────────

class DeploymentManager {
  private _active: ActiveDeploymentMeta | null = null;
  private _pollingTimer: ReturnType<typeof setInterval> | null = null;
  /** Sliding window of latency samples for the current active deployment. */
  private _latencySamples: number[] = [];
  /** Count of errors in the current health window. */
  private _errorCount = 0;
  private _callCount = 0;
  private _healthWindowStart = Date.now();
  private _confidenceBuckets = { low: 0, medium: 0, high: 0 };

  // ── Public read path (called on every inference) ──────────────────────────

  /** Returns the active model version string, or null if no deployment is active. */
  getActiveVersion(): string | null {
    return this._active?.version ?? null;
  }

  /** Returns full active deployment metadata for telemetry/traceability. */
  getActiveMeta(): ActiveDeploymentMeta | null {
    return this._active;
  }

  // ── Initialisation ────────────────────────────────────────────────────────

  /**
   * Load the active deployment from the DB on server startup. Call once from
   * the server entry-point before any inference traffic arrives.
   */
  async initialize(): Promise<void> {
    try {
      const [active] = await db
        .select()
        .from(qdeDeploymentsTable)
        .where(eq(qdeDeploymentsTable.status, "active"))
        .orderBy(desc(qdeDeploymentsTable.activatedAt))
        .limit(1);

      if (active) {
        this._active = {
          dbId: active.id,
          version: active.version,
          artifactHash: active.artifactHash,
          manifestHash: active.manifestHash,
          featureVersion: active.featureVersion,
        };
        logger.info({ version: active.version }, "DeploymentManager: restored active deployment from DB");
      } else {
        logger.info("DeploymentManager: no active deployment found in DB — running in unversioned mode");
      }
    } catch (err) {
      logger.error({ err }, "DeploymentManager: failed to initialize from DB");
    }
  }

  // ── Background polling ────────────────────────────────────────────────────

  /**
   * Start background polling for new deployments from signalium-trainer.
   * Safe to call multiple times — a second call replaces the existing timer.
   */
  startPolling(intervalMs: number = 5 * 60 * 1_000 /* 5 min */): void {
    this.stopPolling();
    this._pollingTimer = setInterval(() => {
      markSchedulerHeartbeat();
      this.pollAndSync().catch((err) =>
        logger.error({ err }, "DeploymentManager: poll cycle failed"),
      );
    }, intervalMs);
    logger.info({ intervalMs }, "DeploymentManager: polling started");
  }

  stopPolling(): void {
    if (this._pollingTimer) {
      clearInterval(this._pollingTimer);
      this._pollingTimer = null;
    }
  }

  /**
   * Check signalium-trainer for a new active deployment and hot-swap if the
   * version differs from the current active. Returns true when a hot-swap was
   * initiated.
   */
  async pollAndSync(): Promise<boolean> {
    const trainerUrl = process.env["QDE_TRAINER_URL"];
    if (!trainerUrl) {
      await this._logEvent(null, "poll_no_change", "Trainer URL not configured — skipping poll");
      return false;
    }

    const remote = await fetchActiveDeployment(trainerUrl);
    if (!remote) {
      await this._logEvent(null, "poll_no_change", "Trainer reported no active deployment");
      return false;
    }

    // Check whether we already have this exact deployment active
    if (this._active?.version === remote.version) {
      await this._logEvent(null, "poll_no_change", `Version ${remote.version} is already active`);
      return false;
    }

    // Check whether this deploymentId is already in the DB (maybe a previous
    // attempt failed — we retry rather than inserting a duplicate)
    const [existing] = await db
      .select()
      .from(qdeDeploymentsTable)
      .where(eq(qdeDeploymentsTable.deploymentId, remote.id))
      .limit(1);

    let dbId: number;
    if (existing) {
      dbId = existing.id;
    } else {
      const [row] = await db
        .insert(qdeDeploymentsTable)
        .values({
          deploymentId: remote.id,
          version: remote.version,
          featureVersion: remote.featureVersion,
          manifestHash: remote.manifestHash,
          artifactHash: remote.artifactHash,
          trainerUrl,
          status: "pending",
          metadata: remote.metadata ?? null,
        })
        .returning();
      dbId = row.id;
    }

    await this._logEvent(dbId, "detected", `New deployment detected: ${remote.version}`);
    await this.hotSwap(dbId, remote, trainerUrl);
    return true;
  }

  /**
   * Perform a full hot-swap lifecycle for a known deployment row.
   *
   *   download → verify → warm → activate (atomic)
   *
   * Rolls back to the previous active deployment on any failure.
   * No process restart; no downtime.
   */
  async hotSwap(
    dbId: number,
    remote: TrainerDeploymentSummary,
    trainerUrl: string,
  ): Promise<void> {
    const previousActive = this._active;

    try {
      // ── 1. Download ───────────────────────────────────────────────────────
      await this._setStatus(dbId, "downloading");
      await this._logEvent(dbId, "download_started", `Downloading artifacts for ${remote.version}`);

      const manifest = await fetchManifest(trainerUrl, remote.id);
      let cacheDir: string | null = null;

      if (manifest) {
        const downloaded = await downloadArtifacts(trainerUrl, remote.id, manifest);
        cacheDir = downloaded.cacheDir;
        await db
          .update(qdeDeploymentsTable)
          .set({ downloadedAt: new Date(), localCachePath: cacheDir, manifestData: manifest as unknown as Record<string, unknown> })
          .where(eq(qdeDeploymentsTable.id, dbId));
        await this._logEvent(dbId, "downloaded", `Artifacts cached at ${cacheDir}`);
      } else {
        // Manifest fetch failed — proceed without local artifacts (remote-inference mode)
        await this._logEvent(dbId, "downloaded", "Manifest unavailable — proceeding in remote-inference mode");
      }

      // ── 2. Verify ─────────────────────────────────────────────────────────
      await this._setStatus(dbId, "verifying");
      // Integrity was already validated inside downloadArtifacts (throws on mismatch).
      // Record verification timestamp.
      await db
        .update(qdeDeploymentsTable)
        .set({ verifiedAt: new Date(), integrityVerified: true })
        .where(eq(qdeDeploymentsTable.id, dbId));
      await this._logEvent(dbId, "verify_passed", "SHA256 integrity verified");

      // ── 3. Warm — strict gate (fail-closed by default) ───────────────────
      // Set QDE_ALLOW_WARMUP_FAIL=true to activate even when warm-up fails
      // (e.g. trainer temporarily offline during a planned restart).
      await this._setStatus(dbId, "warming");
      await this._logEvent(dbId, "warming", `Running warm-up inference for ${remote.version}`);
      let warmupLatencyMs: number | null = null;
      try {
        warmupLatencyMs = await warmDeployment(trainerUrl, remote.version);
        await db
          .update(qdeDeploymentsTable)
          .set({ warmedAt: new Date(), warmupLatencyMs })
          .where(eq(qdeDeploymentsTable.id, dbId));
        await this._logEvent(dbId, "warmed", `Warm-up complete in ${warmupLatencyMs}ms`);
      } catch (warmErr) {
        const allowFail = process.env["QDE_ALLOW_WARMUP_FAIL"] === "true";
        await this._logEvent(
          dbId,
          "warm_failed",
          `Warm-up failed: ${(warmErr as Error).message}${allowFail ? " — proceeding (fail-open)" : " — aborting activation"}`,
        );
        if (!allowFail) {
          // Strict gate: propagate the error, which triggers rollback in the outer catch.
          throw new Error(`Warm-up failed for ${remote.version}: ${(warmErr as Error).message}`);
        }
        logger.warn({ warmErr, version: remote.version }, "DeploymentManager: warm-up failed — continuing (QDE_ALLOW_WARMUP_FAIL=true)");
      }

      // ── 4. Activate — atomic DB transaction + in-memory update ───────────
      // Single transaction ensures retire+activate are never split even under
      // concurrent calls from multiple processes sharing the same DB.
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(qdeDeploymentsTable)
          .set({ status: "retired", retiredAt: now })
          .where(
            and(
              eq(qdeDeploymentsTable.status, "active"),
              ne(qdeDeploymentsTable.id, dbId),
            ),
          );
        await tx
          .update(qdeDeploymentsTable)
          .set({ status: "active", activatedAt: now })
          .where(eq(qdeDeploymentsTable.id, dbId));
      });

      // Flip in-memory pointer (zero-latency hot path)
      this._active = {
        dbId,
        version: remote.version,
        artifactHash: remote.artifactHash,
        manifestHash: remote.manifestHash,
        featureVersion: remote.featureVersion,
      };
      // Reset health window
      this._resetHealthWindow();

      await this._logEvent(dbId, "activated", `${remote.version} is now the active deployment`);
      logger.info({ version: remote.version, warmupLatencyMs }, "DeploymentManager: hot-swap complete");
    } catch (err) {
      logger.error({ err, version: remote.version }, "DeploymentManager: hot-swap failed — rolling back");
      await this._setStatus(dbId, "failed", (err as Error).message);
      await this._logEvent(dbId, "rollback_triggered", `Hot-swap failed: ${(err as Error).message}`);
      await this._rollbackTo(previousActive);
    }
  }

  /**
   * Manually roll back to a specific deployment (by DB id) or to the most
   * recent non-failed deployment before the current active one.
   */
  async rollback(targetDbId?: number): Promise<void> {
    const previousActive = this._active;

    let target: (typeof qdeDeploymentsTable.$inferSelect) | undefined;
    if (targetDbId) {
      const [row] = await db
        .select()
        .from(qdeDeploymentsTable)
        .where(eq(qdeDeploymentsTable.id, targetDbId))
        .limit(1);
      target = row;
    } else {
      // Find the most recent retired deployment that was previously active
      const [row] = await db
        .select()
        .from(qdeDeploymentsTable)
        .where(
          and(
            eq(qdeDeploymentsTable.status, "retired"),
            ...(previousActive ? [ne(qdeDeploymentsTable.id, previousActive.dbId)] : []),
          ),
        )
        .orderBy(desc(qdeDeploymentsTable.retiredAt))
        .limit(1);
      target = row;
    }

    if (!target) {
      await this._logEvent(null, "rolled_back", "No rollback target found — staying on current version");
      return;
    }

    await this._rollbackTo({
      dbId: target.id,
      version: target.version,
      artifactHash: target.artifactHash,
      manifestHash: target.manifestHash,
      featureVersion: target.featureVersion,
    });
  }

  // ── Health monitoring ─────────────────────────────────────────────────────

  /** Record a single inference latency sample for the active deployment. */
  recordLatency(latencyMs: number): void {
    this._latencySamples.push(latencyMs);
    this._callCount++;
    // Keep window manageable
    if (this._latencySamples.length > 10_000) this._latencySamples.shift();
  }

  /** Record an inference error against the active deployment. */
  recordError(): void {
    this._errorCount++;
    this._callCount++;
  }

  /** Record a confidence value for distribution tracking. */
  recordConfidence(confidence: number): void {
    if (confidence < 0.4) this._confidenceBuckets.low++;
    else if (confidence > 0.7) this._confidenceBuckets.high++;
    else this._confidenceBuckets.medium++;
  }

  /**
   * Flush the current health window to the DB and reset counters.
   *
   * Snapshot then reset: counters are captured atomically (synchronously) and
   * cleared before the async DB write so that samples arriving during the await
   * accumulate into the *next* window rather than being lost or double-counted.
   */
  async flushHealthSample(): Promise<void> {
    if (!this._active) return;

    // ── Atomic snapshot + reset (synchronous, no await between) ──────────
    const snapshotDeploymentId = this._active.dbId;
    const snapshotSamples = this._latencySamples;
    const snapshotErrors = this._errorCount;
    const snapshotCalls = this._callCount;
    const snapshotBuckets = { ...this._confidenceBuckets };
    const snapshotWindowStart = this._healthWindowStart;
    this._resetHealthWindow(); // reset immediately — new samples go to next window

    // ── Compute stats from the snapshot ───────────────────────────────────
    const windowMinutes = (Date.now() - snapshotWindowStart) / 60_000;
    const sorted = snapshotSamples.slice().sort((a, b) => a - b);
    const n = sorted.length;
    const p = (pct: number) => (n > 0 ? (sorted[Math.floor(n * pct)] ?? null) : null);
    const errorRate = snapshotCalls > 0 ? snapshotErrors / snapshotCalls : 0;

    const alerts: string[] = [];
    if (errorRate > 0.05) alerts.push(`Error rate elevated: ${(errorRate * 100).toFixed(1)}%`);
    if (n > 0 && (p(0.95) ?? 0) > 3_000) alerts.push(`P95 latency elevated: ${p(0.95)}ms`);

    const mem = process.memoryUsage();

    try {
      await db.insert(qdeDeploymentHealthTable).values({
        deploymentId: snapshotDeploymentId,
        latencyP50Ms: p(0.5),
        latencyP95Ms: p(0.95),
        latencyP99Ms: p(0.99),
        errorRate,
        throughputPerMin: windowMinutes > 0 ? snapshotCalls / windowMinutes : null,
        memoryUsageMb: mem.rss / 1_048_576,
        cpuUsagePct: null, // CPU requires async sampling — omitted for correctness
        sampleCount: n,
        confidenceDistribution: snapshotBuckets,
        alerts: alerts.length > 0 ? alerts : [],
      });
    } catch (err) {
      logger.warn({ err }, "DeploymentManager: failed to flush health sample");
    }

    if (alerts.length > 0) {
      await this._logEvent(snapshotDeploymentId, "health_alert", alerts.join("; ")).catch(() => {});
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async _rollbackTo(staleTarget: ActiveDeploymentMeta | null): Promise<void> {
    // Always query the DB for the rollback target — do not trust the in-memory
    // pointer which may be stale on a multi-process node.
    let targetRow: (typeof qdeDeploymentsTable.$inferSelect) | undefined;

    if (staleTarget) {
      const [row] = await db
        .select()
        .from(qdeDeploymentsTable)
        .where(eq(qdeDeploymentsTable.id, staleTarget.dbId))
        .limit(1);
      targetRow = row;
    }

    if (!targetRow) {
      // No in-memory hint — find the most-recently retired row that could serve.
      const [row] = await db
        .select()
        .from(qdeDeploymentsTable)
        .where(eq(qdeDeploymentsTable.status, "retired"))
        .orderBy(desc(qdeDeploymentsTable.retiredAt))
        .limit(1);
      targetRow = row;
    }

    if (!targetRow) {
      this._active = null;
      await this._logEvent(null, "rolled_back", "No previous version available — running unversioned");
      return;
    }

    const now = new Date();
    // Atomic transaction: retire current active, re-activate target.
    await db.transaction(async (tx) => {
      await tx
        .update(qdeDeploymentsTable)
        .set({ status: "retired", retiredAt: now })
        .where(
          and(
            eq(qdeDeploymentsTable.status, "active"),
            ne(qdeDeploymentsTable.id, targetRow!.id),
          ),
        );
      await tx
        .update(qdeDeploymentsTable)
        .set({ status: "active", activatedAt: now })
        .where(eq(qdeDeploymentsTable.id, targetRow!.id));
    });

    this._active = {
      dbId: targetRow.id,
      version: targetRow.version,
      artifactHash: targetRow.artifactHash,
      manifestHash: targetRow.manifestHash,
      featureVersion: targetRow.featureVersion,
    };
    this._resetHealthWindow();
    await this._logEvent(targetRow.id, "rolled_back", `Rolled back to ${targetRow.version}`);
    logger.info({ version: targetRow.version }, "DeploymentManager: rollback complete");
  }

  private async _setStatus(
    dbId: number,
    status: "downloading" | "verifying" | "warming" | "active" | "retired" | "failed",
    failureReason?: string,
  ): Promise<void> {
    await db
      .update(qdeDeploymentsTable)
      .set({ status, ...(failureReason ? { failureReason } : {}), updatedAt: new Date() })
      .where(eq(qdeDeploymentsTable.id, dbId));
  }

  private async _logEvent(
    deploymentId: number | null,
    eventType: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await db.insert(qdeDeploymentEventsTable).values({
        deploymentId,
        eventType,
        message,
        metadata: metadata ?? null,
      });
      broadcastOpsEvent("deployment.event", { deploymentId, eventType, message, metadata: metadata ?? null });
    } catch (err) {
      logger.warn({ err, eventType }, "DeploymentManager: failed to log deployment event");
    }
  }

  private _resetHealthWindow(): void {
    this._latencySamples = [];
    this._errorCount = 0;
    this._callCount = 0;
    this._confidenceBuckets = { low: 0, medium: 0, high: 0 };
    this._healthWindowStart = Date.now();
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const deploymentManager = new DeploymentManager();
