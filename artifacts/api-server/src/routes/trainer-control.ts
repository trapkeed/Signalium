/**
 * Trainer Admin Control Plane
 *
 * Admin-only control surface for the trainer: start/stop training, create
 * experiments, launch shadow tests, plus read-only inspection views
 * (datasets, memory, reflections, research reports, active models, RunPod
 * jobs/GPU utilization/training costs). Deploy/rollback is intentionally NOT
 * duplicated here — it reuses the existing /qde/admin/deployments and
 * /research-lab/deployment-candidates endpoints, which already wrap
 * deploymentManager's atomic activate/rollback lifecycle.
 *
 * Every control action (start/stop training, create experiment, launch
 * shadow test) is audit-logged, including failures, so ops can trace every
 * attempted mutation against the trainer. Inspection views only need
 * requireAdmin — no separate audit entry, matching research-lab.ts's
 * pattern of only auditing the most production-impacting reads
 * (deployment candidates), not every list/detail call.
 *
 * All RunPod-related inspection (jobs, GPU utilization, training cost)
 * reads directly from runpodPodsTable (owned by the RunPod Orchestration
 * lib) rather than reimplementing pod lifecycle/state tracking.
 */
import { Router } from "express";
import { getAuth } from "../lib/auth";
import { db, runpodPodsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAudit } from "../lib/auditLog";
import * as researchLab from "../lib/researchLab";
import { ResearchLabUnavailableError } from "../lib/researchLab";

const router = Router();

router.use(requireAdmin);

/** Wraps a read-only proxy call, converting an unavailable trainer into a clean 503. */
async function proxy<T>(res: import("express").Response, fn: () => Promise<T>): Promise<void> {
  try {
    const data = await fn();
    res.json(data);
  } catch (err) {
    if (err instanceof ResearchLabUnavailableError) {
      res.status(503).json({ error: "trainer_unavailable", message: err.message });
      return;
    }
    throw err;
  }
}

router.get("/status", async (req, res) => {
  try {
    const configured = await researchLab.isResearchLabConfigured();
    res.json({ configured });
  } catch (err) {
    req.log.error(err, "Failed to check trainer status");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Control actions ──────────────────────────────────────────────────────────

router.post("/training/start", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const config = (req.body ?? {}) as Record<string, unknown>;
  try {
    const data = await researchLab.startTrainingRun(config);
    await logAudit(userId, "trainer_control.training_started", "trainer_training_run", String((data.run as any)?.id ?? "unknown"), { config });
    return res.json(data);
  } catch (err) {
    await logAudit(userId, "trainer_control.training_started", "trainer_training_run", "attempt", { config, failed: true, error: (err as Error).message }).catch(() => {});
    if (err instanceof ResearchLabUnavailableError) {
      return res.status(503).json({ error: "trainer_unavailable", message: err.message });
    }
    throw err;
  }
});

router.post("/training/:id/stop", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const id = req.params.id as string;
  const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
  try {
    const data = await researchLab.stopTrainingRun(id, reason);
    await logAudit(userId, "trainer_control.training_stopped", "trainer_training_run", id, { reason: reason ?? null, result: data });
    return res.json(data);
  } catch (err) {
    await logAudit(userId, "trainer_control.training_stopped", "trainer_training_run", id, { reason: reason ?? null, failed: true, error: (err as Error).message }).catch(() => {});
    if (err instanceof ResearchLabUnavailableError) {
      return res.status(503).json({ error: "trainer_unavailable", message: err.message });
    }
    throw err;
  }
});

router.post("/experiments", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const config = (req.body ?? {}) as Record<string, unknown>;
  try {
    const data = await researchLab.createExperiment(config);
    await logAudit(userId, "trainer_control.experiment_created", "trainer_experiment", String((data.experiment as any)?.id ?? "unknown"), { config });
    return res.status(201).json(data);
  } catch (err) {
    await logAudit(userId, "trainer_control.experiment_created", "trainer_experiment", "attempt", { config, failed: true, error: (err as Error).message }).catch(() => {});
    if (err instanceof ResearchLabUnavailableError) {
      return res.status(503).json({ error: "trainer_unavailable", message: err.message });
    }
    throw err;
  }
});

router.post("/shadow-tests", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const config = (req.body ?? {}) as Record<string, unknown>;
  try {
    const data = await researchLab.launchShadowTest(config);
    await logAudit(userId, "trainer_control.shadow_test_launched", "trainer_shadow_deployment", String((data.deployment as any)?.id ?? "unknown"), { config });
    return res.status(201).json(data);
  } catch (err) {
    await logAudit(userId, "trainer_control.shadow_test_launched", "trainer_shadow_deployment", "attempt", { config, failed: true, error: (err as Error).message }).catch(() => {});
    if (err instanceof ResearchLabUnavailableError) {
      return res.status(503).json({ error: "trainer_unavailable", message: err.message });
    }
    throw err;
  }
});

// ─── Inspection views ─────────────────────────────────────────────────────────

router.get("/datasets", async (req, res) => {
  await proxy(res, () => researchLab.listDatasets({ limit: req.query.limit ? Number(req.query.limit) : undefined }));
});
router.get("/datasets/:id", async (req, res) => {
  await proxy(res, () => researchLab.getDataset(req.params.id as string));
});
router.get("/memory", async (req, res) => {
  await proxy(res, () => researchLab.listMemoryEntries({ limit: req.query.limit ? Number(req.query.limit) : undefined }));
});
router.get("/reflections", async (req, res) => {
  await proxy(res, () => researchLab.listReflections({ limit: req.query.limit ? Number(req.query.limit) : undefined }));
});
router.get("/research-reports", async (req, res) => {
  await proxy(res, () => researchLab.listResearchReports({ limit: req.query.limit ? Number(req.query.limit) : undefined }));
});
router.get("/research-reports/:id", async (req, res) => {
  await proxy(res, () => researchLab.getResearchReport(req.params.id as string));
});
router.get("/active-models", async (_req, res) => {
  await proxy(res, () => researchLab.listActiveModels());
});

// RunPod jobs / GPU utilization / training costs — read directly from the
// RunPod orchestration tables (owned by lib/runpod/*) rather than proxying
// through the trainer, since Signalium (not the trainer) is authoritative
// for pod state.
router.get("/runpod/jobs", async (req, res) => {
  try {
    const pods = await db.select().from(runpodPodsTable).orderBy(desc(runpodPodsTable.createdAt));
    return res.json({ jobs: pods });
  } catch (err) {
    req.log.error(err, "Failed to list RunPod jobs for trainer control plane");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/runpod/gpu-utilization", async (req, res) => {
  try {
    const pods = await db.select().from(runpodPodsTable).orderBy(desc(runpodPodsTable.createdAt));
    const utilization = pods
      .filter((p) => p.status === "running")
      .map((p) => ({
        podId: p.id,
        runpodPodId: p.runpodPodId,
        name: p.name,
        gpuType: p.gpuType,
        utilizationPct: p.lastUtilizationPct,
        lastPolledAt: p.lastPolledAt,
      }));
    return res.json({ utilization });
  } catch (err) {
    req.log.error(err, "Failed to compute GPU utilization for trainer control plane");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/training-costs", async (req, res) => {
  try {
    const pods = await db.select().from(runpodPodsTable).orderBy(desc(runpodPodsTable.createdAt));
    const totalAccruedUsd = pods.reduce((sum, p) => sum + (p.accruedCostUsd ?? 0), 0);
    const activeHourlyUsd = pods
      .filter((p) => p.status === "running")
      .reduce((sum, p) => sum + (p.lastReportedCostPerHrUsd ?? p.costPerHrUsd ?? 0), 0);
    return res.json({
      totalAccruedUsd,
      activeHourlyUsd,
      pods: pods.map((p) => ({
        podId: p.id,
        name: p.name,
        gpuType: p.gpuType,
        status: p.status,
        accruedCostUsd: p.accruedCostUsd,
        costPerHrUsd: p.lastReportedCostPerHrUsd ?? p.costPerHrUsd,
      })),
    });
  } catch (err) {
    req.log.error(err, "Failed to compute training costs for trainer control plane");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
