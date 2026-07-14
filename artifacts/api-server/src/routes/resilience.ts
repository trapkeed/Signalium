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

router.get("/backups", async (req, res) => {
  try {
    const backups = await listBackups();
    res.json({ backups });
  } catch (err) {
    req.log.error(err, "Failed to list backups");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/backups/run", async (req, res) => {
  const { userId } = getAuth(req);
  try {
    const backupId = await runBackup(userId ?? "unknown", "manual");
    res.json({ backupId });
  } catch (err) {
    req.log.error(err, "Manual backup trigger failed");
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
  try {
    const result = await validateBackup(backupId);
    if (userId) await logAudit(userId, "backup.validated", "backup_record", String(backupId), result);
    res.json(result);
  } catch (err) {
    req.log.error(err, "Failed to validate backup");
    res.status(500).json({ error: "Internal server error" });
  }
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
    req.log.error(err, "Failed to build restore plan");
    res.status(404).json({ error: err instanceof Error ? err.message : "Backup not found" });
  }
});

// ─── Job Queue ──────────────────────────────────────────────────────────────

router.get("/queue/stats", async (req, res) => {
  try {
    const stats = await getQueueStats();
    res.json({ stats });
  } catch (err) {
    req.log.error(err, "Failed to get queue stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/queue/dead-letter", async (req, res) => {
  try {
    const jobs = await listDeadLetterJobs();
    res.json({ jobs });
  } catch (err) {
    req.log.error(err, "Failed to list dead-letter jobs");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/queue/:id/requeue", async (req, res) => {
  const { userId } = getAuth(req);
  const jobId = Number(req.params.id);
  if (!Number.isInteger(jobId)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  try {
    const requeued = await requeueJob(jobId);
    if (!requeued) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (userId) await logAudit(userId, "job_queue.requeued", "job_queue", String(jobId));
    res.json({ requeued: true });
  } catch (err) {
    req.log.error(err, "Failed to requeue job");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Circuit Breakers ───────────────────────────────────────────────────────

router.get("/circuit-breakers", (_req, res) => {
  res.json({ breakers: getAllCircuitBreakerStatuses() });
});

// ─── Secret / Key Rotation ──────────────────────────────────────────────────

router.get("/secret-rotation", async (req, res) => {
  try {
    const statuses = await getRotationStatuses();
    res.json({ secrets: statuses });
  } catch (err) {
    req.log.error(err, "Failed to get rotation statuses");
    res.status(500).json({ error: "Internal server error" });
  }
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
    req.log.error(err, "Failed to mark secret rotated");
    res.status(404).json({ error: err instanceof Error ? err.message : "Unknown secret" });
  }
});

// ─── Audit Log Retention ────────────────────────────────────────────────────

router.get("/audit-retention", async (req, res) => {
  try {
    const info = await getAuditLogRetentionInfo();
    res.json(info);
  } catch (err) {
    req.log.error(err, "Failed to get audit retention info");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Configuration Export / Restore ────────────────────────────────────────
// For disaster recovery and environment recreation: exports the tables that
// define platform *behavior* (feature flags, plans, symbols, broker configs,
// data provider configs) as a single portable JSON document — not user data
// (see configManagement.ts for the exact table list and rationale).

router.get("/config-export", async (req, res) => {
  const { userId } = getAuth(req);
  try {
    const snapshot = await exportConfig();
    if (userId) await logAudit(userId, "config.exported", "config_snapshot", String(Date.now()));
    res.json(snapshot);
  } catch (err) {
    req.log.error(err, "Config export failed");
    res.status(500).json({ error: "Internal server error" });
  }
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
    req.log.error(err, "Config import failed");
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid config snapshot" });
  }
});

export default router;
