/**
 * S26 — Scalability, HA & Disaster Recovery admin endpoints.
 *
 * Everything here is admin/super_admin only (requireAdmin) — infrastructure
 * internals (backups, restore plans, queue internals, secret rotation
 * status) must never be visible to a normal user.
 */
import { Router, type IRouter } from "express";
import { getAuth } from "../lib/auth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { listBackups, runBackup, validateBackup, buildRestorePlan } from "../lib/backupService";
import { getQueueStats, listDeadLetterJobs, requeueJob } from "../lib/jobQueue";
import { getRotationStatuses, markSecretRotated } from "../lib/secretRotation";
import { getAllCircuitBreakerStatuses } from "../lib/circuitBreaker";
import { getAuditLogRetentionInfo } from "../lib/auditRetention";
import { exportConfig, importConfig } from "../lib/configManagement";
import { logAudit } from "../lib/auditLog";
import { logger } from "../lib/logger";

const router: IRouter = Router();
router.use(requireAdmin);

// ─── Backups ────────────────────────────────────────────────────────────────

router.get("/backups", async (_req, res) => {
  const backups = await listBackups();
  res.json({ backups });
});

router.post("/backups/run", async (req, res) => {
  const { userId } = getAuth(req);
  try {
    const backupId = await runBackup(userId ?? "unknown", "manual");
    res.json({ backupId });
  } catch (err) {
    logger.error({ err }, "Manual backup trigger failed");
    res.status(500).json({ error: "Backup failed — see server logs" });
  }
});

router.post("/backups/:id/validate", async (req, res) => {
  const { userId } = getAuth(req);
  const backupId = Number(req.params.id);
  if (!Number.isInteger(backupId)) {
    res.status(400).json({ error: "Invalid backup id" });
    return;
  }
  const result = await validateBackup(backupId);
  if (userId) await logAudit(userId, "backup.validated", "backup_record", String(backupId), result);
  res.json(result);
});

router.get("/backups/:id/restore-plan", async (req, res) => {
  const { userId } = getAuth(req);
  const backupId = Number(req.params.id);
  if (!Number.isInteger(backupId)) {
    res.status(400).json({ error: "Invalid backup id" });
    return;
  }
  try {
    const plan = await buildRestorePlan(backupId, userId ?? "unknown");
    res.json(plan);
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "Backup not found" });
  }
});

// ─── Job Queue ──────────────────────────────────────────────────────────────

router.get("/queue/stats", async (_req, res) => {
  const stats = await getQueueStats();
  res.json({ stats });
});

router.get("/queue/dead-letter", async (_req, res) => {
  const jobs = await listDeadLetterJobs();
  res.json({ jobs });
});

router.post("/queue/:id/requeue", async (req, res) => {
  const { userId } = getAuth(req);
  const jobId = Number(req.params.id);
  if (!Number.isInteger(jobId)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const requeued = await requeueJob(jobId);
  if (!requeued) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (userId) await logAudit(userId, "job_queue.requeued", "job_queue", String(jobId));
  res.json({ requeued: true });
});

// ─── Circuit Breakers ───────────────────────────────────────────────────────

router.get("/circuit-breakers", (_req, res) => {
  res.json({ breakers: getAllCircuitBreakerStatuses() });
});

// ─── Secret / Key Rotation ──────────────────────────────────────────────────

router.get("/secret-rotation", async (_req, res) => {
  const statuses = await getRotationStatuses();
  res.json({ secrets: statuses });
});

router.post("/secret-rotation/:secretName/mark-rotated", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    await markSecretRotated(req.params.secretName, userId);
    res.json({ marked: true });
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "Unknown secret" });
  }
});

// ─── Audit Log Retention ────────────────────────────────────────────────────

router.get("/audit-retention", async (_req, res) => {
  const info = await getAuditLogRetentionInfo();
  res.json(info);
});

// ─── Configuration Export / Restore ────────────────────────────────────────
// For disaster recovery and environment recreation: exports the tables that
// define platform *behavior* (feature flags, plans, symbols, broker configs,
// data provider configs) as a single portable JSON document — not user data
// (see configManagement.ts for the exact table list and rationale).

router.get("/config-export", async (req, res) => {
  const { userId } = getAuth(req);
  const snapshot = await exportConfig();
  if (userId) await logAudit(userId, "config.exported", "config_snapshot", String(Date.now()));
  res.json(snapshot);
});

router.post("/config-import", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const result = await importConfig(req.body, userId);
    await logAudit(userId, "config.imported", "config_snapshot", String(Date.now()), { tables: result.tables });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Config import failed");
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid config snapshot" });
  }
});

export default router;
