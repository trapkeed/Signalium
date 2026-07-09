/**
 * S21B — Deployment Admin Routes
 *
 * All endpoints are admin-only and live under the /qde namespace (mounted
 * via routes/index.ts at /qde/admin/deployments).
 *
 * Endpoints:
 *   GET  /qde/admin/deployments              — list all deployments
 *   GET  /qde/admin/deployments/active       — current active deployment
 *   POST /qde/admin/deployments/poll         — trigger manual trainer poll
 *   POST /qde/admin/deployments/:id/activate — manually activate a deployment
 *   POST /qde/admin/deployments/:id/rollback — rollback to a specific deployment
 *   GET  /qde/admin/deployments/:id          — single deployment detail
 *   GET  /qde/admin/deployments/:id/health   — health metrics for a deployment
 *   GET  /qde/admin/deployments/:id/events   — lifecycle events for a deployment
 *   GET  /qde/admin/deployments/health/current — health metrics for active deployment
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  qdeDeploymentsTable,
  qdeDeploymentHealthTable,
  qdeDeploymentEventsTable,
} from "@workspace/db";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { deploymentManager } from "../lib/deploymentManager";
import { fetchActiveDeployment, fetchManifest } from "../lib/deploymentClient";

const router = Router();

// ─── GET /qde/admin/deployments ──────────────────────────────────────────────

router.get("/admin/deployments", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const status = req.query.status as string | undefined;

    const rows = await db
      .select()
      .from(qdeDeploymentsTable)
      .where(
        status
          ? eq(qdeDeploymentsTable.status, status as "pending" | "downloading" | "verifying" | "warming" | "active" | "retired" | "failed")
          : undefined,
      )
      .orderBy(desc(qdeDeploymentsTable.createdAt))
      .limit(limit);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(qdeDeploymentsTable);

    return res.json({ deployments: rows, total });
  } catch (err) {
    req.log.error(err, "Failed to list deployments");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /qde/admin/deployments/active ───────────────────────────────────────

router.get("/admin/deployments/active", requireAdmin, async (req, res) => {
  try {
    const [active] = await db
      .select()
      .from(qdeDeploymentsTable)
      .where(eq(qdeDeploymentsTable.status, "active"))
      .orderBy(desc(qdeDeploymentsTable.activatedAt))
      .limit(1);

    const inMemory = deploymentManager.getActiveMeta();

    return res.json({
      deployment: active ?? null,
      inMemoryVersion: inMemory?.version ?? null,
      synchronized: active?.version === inMemory?.version,
    });
  } catch (err) {
    req.log.error(err, "Failed to get active deployment");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /qde/admin/deployments/health/current ───────────────────────────────
// Must be declared before /:id routes to avoid ambiguous matching.

router.get("/admin/deployments/health/current", requireAdmin, async (req, res) => {
  try {
    const meta = deploymentManager.getActiveMeta();
    if (!meta) return res.json({ health: null, message: "No active deployment" });

    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const rows = await db
      .select()
      .from(qdeDeploymentHealthTable)
      .where(eq(qdeDeploymentHealthTable.deploymentId, meta.dbId))
      .orderBy(desc(qdeDeploymentHealthTable.recordedAt))
      .limit(limit);

    return res.json({ deploymentDbId: meta.dbId, version: meta.version, health: rows });
  } catch (err) {
    req.log.error(err, "Failed to get current health");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /qde/admin/deployments/poll ────────────────────────────────────────

router.post("/admin/deployments/poll", requireAdmin, async (req, res) => {
  const trainerUrl = process.env["QDE_TRAINER_URL"];
  if (!trainerUrl) {
    return res.status(503).json({ error: "QDE_TRAINER_URL is not configured" });
  }

  try {
    // Flush any pending health data first
    await deploymentManager.flushHealthSample().catch(() => {});

    const remote = await fetchActiveDeployment(trainerUrl);
    if (!remote) {
      return res.json({ changed: false, message: "Trainer reports no active deployment" });
    }

    const currentVersion = deploymentManager.getActiveVersion();
    if (currentVersion === remote.version) {
      return res.json({ changed: false, message: `Version ${remote.version} is already active`, version: remote.version });
    }

    // Kick off hot-swap asynchronously — respond immediately so the HTTP call
    // doesn't time out on slow model downloads
    deploymentManager.pollAndSync().catch((err) =>
      req.log.error(err, "Async poll-and-sync failed"),
    );

    return res.json({
      changed: true,
      message: `Hot-swap initiated: ${currentVersion ?? "none"} → ${remote.version}`,
      previousVersion: currentVersion,
      newVersion: remote.version,
    });
  } catch (err) {
    req.log.error(err, "Deployment poll failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /qde/admin/deployments/:id ──────────────────────────────────────────

router.get("/admin/deployments/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid deployment id" });

  try {
    const [deployment] = await db
      .select()
      .from(qdeDeploymentsTable)
      .where(eq(qdeDeploymentsTable.id, id))
      .limit(1);

    if (!deployment) return res.status(404).json({ error: "Deployment not found" });
    return res.json({ deployment });
  } catch (err) {
    req.log.error(err, "Failed to get deployment");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /qde/admin/deployments/:id/activate ────────────────────────────────

router.post("/admin/deployments/:id/activate", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid deployment id" });

  const trainerUrl = process.env["QDE_TRAINER_URL"];
  if (!trainerUrl) {
    return res.status(503).json({ error: "QDE_TRAINER_URL is not configured" });
  }

  try {
    const [deployment] = await db
      .select()
      .from(qdeDeploymentsTable)
      .where(eq(qdeDeploymentsTable.id, id))
      .limit(1);

    if (!deployment) return res.status(404).json({ error: "Deployment not found" });
    if (deployment.status === "active") {
      return res.json({ ok: true, message: "Deployment is already active" });
    }
    if (deployment.status === "downloading" || deployment.status === "verifying" || deployment.status === "warming") {
      return res.status(409).json({ error: `Deployment is currently in status: ${deployment.status}` });
    }

    // Fetch fresh manifest and re-run hot-swap
    const manifest = await fetchManifest(trainerUrl, deployment.deploymentId);
    const remoteDeployment = {
      id: deployment.deploymentId,
      version: deployment.version,
      featureVersion: deployment.featureVersion,
      manifestHash: deployment.manifestHash ?? "",
      artifactHash: deployment.artifactHash ?? "",
      status: "ACTIVE" as const,
      activatedAt: new Date().toISOString(),
      metadata: deployment.metadata as Record<string, unknown> | undefined,
    };

    // Fire async — respond immediately
    deploymentManager.hotSwap(id, remoteDeployment, trainerUrl).catch((err) =>
      req.log.error(err, "Async activate failed"),
    );

    return res.json({ ok: true, message: `Activation initiated for ${deployment.version}`, manifest: manifest ?? null });
  } catch (err) {
    req.log.error(err, "Failed to activate deployment");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /qde/admin/deployments/:id/rollback ────────────────────────────────

router.post("/admin/deployments/:id/rollback", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid deployment id" });

  try {
    const [target] = await db
      .select()
      .from(qdeDeploymentsTable)
      .where(eq(qdeDeploymentsTable.id, id))
      .limit(1);

    if (!target) return res.status(404).json({ error: "Deployment not found" });

    await deploymentManager.rollback(id);
    return res.json({ ok: true, message: `Rolled back to ${target.version}` });
  } catch (err) {
    req.log.error(err, "Failed to rollback deployment");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /qde/admin/deployments/:id/health ───────────────────────────────────

router.get("/admin/deployments/:id/health", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid deployment id" });

  try {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const rows = await db
      .select()
      .from(qdeDeploymentHealthTable)
      .where(eq(qdeDeploymentHealthTable.deploymentId, id))
      .orderBy(desc(qdeDeploymentHealthTable.recordedAt))
      .limit(limit);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(qdeDeploymentHealthTable)
      .where(eq(qdeDeploymentHealthTable.deploymentId, id));

    return res.json({ health: rows, total });
  } catch (err) {
    req.log.error(err, "Failed to get deployment health");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /qde/admin/deployments/:id/events ───────────────────────────────────

router.get("/admin/deployments/:id/events", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid deployment id" });

  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rows = await db
      .select()
      .from(qdeDeploymentEventsTable)
      .where(eq(qdeDeploymentEventsTable.deploymentId, id))
      .orderBy(desc(qdeDeploymentEventsTable.occurredAt))
      .limit(limit);

    return res.json({ events: rows });
  } catch (err) {
    req.log.error(err, "Failed to get deployment events");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
