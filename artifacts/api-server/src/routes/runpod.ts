import { Router } from "express";
import { getAuth } from "../lib/auth";
import { db, runpodPodsTable, runpodWorkerCredentialsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAudit } from "../lib/auditLog";
import {
  launchPod,
  stopPod,
  resumePod,
  terminatePod,
  getPodLogs,
  listVolumeArtifacts,
  isRunpodConfigured,
  getRunpodLaunchDefaults,
  resolveTrustedGpuCost,
} from "../lib/runpod/client";
import { checkBudgetForLaunch, getBudgetConfig, setBudgetConfig } from "../lib/runpod/budget";
import { pollRunpodPod } from "../lib/runpod/monitor";
import { issueWorkerCredential, rotateWorkerCredential, revokeWorkerCredential, listCredentialsForPod } from "../lib/runpod/credentials";

const router = Router();

router.use(requireAdmin);

// ─── Config / defaults ────────────────────────────────────────────────────────

router.get("/config", async (req, res) => {
  try {
    const [configured, defaults, budget] = await Promise.all([
      isRunpodConfigured(),
      getRunpodLaunchDefaults(),
      getBudgetConfig(),
    ]);
    return res.json({ configured, defaults, budget });
  } catch (err) {
    req.log.error(err, "Failed to load RunPod config");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/budget", async (req, res) => {
  const { userId } = getAuth(req);
  const { maxHourlyCostUsd, maxActivePods, autoShutdownIdleMinutes, gpuPricingJson } = req.body as {
    maxHourlyCostUsd?: number;
    maxActivePods?: number;
    autoShutdownIdleMinutes?: number | null;
    gpuPricingJson?: Record<string, number>;
  };

  try {
    const patch: { maxHourlyCostUsd?: number; maxActivePods?: number; autoShutdownIdleMinutes?: number | null; gpuPricingJson?: Record<string, number> } = {};
    if (maxHourlyCostUsd !== undefined) patch.maxHourlyCostUsd = maxHourlyCostUsd;
    if (maxActivePods !== undefined) patch.maxActivePods = maxActivePods;
    if ("autoShutdownIdleMinutes" in req.body) patch.autoShutdownIdleMinutes = autoShutdownIdleMinutes ?? null;
    if (gpuPricingJson !== undefined && typeof gpuPricingJson === "object") patch.gpuPricingJson = gpuPricingJson;

    const result = await setBudgetConfig(patch, userId!);

    await logAudit(userId!, "runpod_budget.updated", "runpod_budget_config", "global", patch);
    return res.json(result);
  } catch (err) {
    req.log.error(err, "Failed to update RunPod budget config");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Pod lifecycle ────────────────────────────────────────────────────────────

router.get("/pods", async (req, res) => {
  try {
    const pods = await db.select().from(runpodPodsTable).orderBy(desc(runpodPodsTable.createdAt));
    return res.json(pods);
  } catch (err) {
    req.log.error(err, "Failed to list RunPod pods");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/pods", async (req, res) => {
  const { userId } = getAuth(req);
  const { name, gpuType, templateId, volumeId, region } = req.body as {
    name?: string;
    gpuType?: string;
    templateId?: string;
    volumeId?: string | null;
    region?: string | null;
  };

  if (!name || !gpuType || !templateId) {
    return res.status(400).json({ error: "'name', 'gpuType', and 'templateId' are required" });
  }

  try {
    if (!(await isRunpodConfigured())) {
      return res.status(409).json({ error: "RunPod is not configured — set runpod.api_key in Admin \u2192 Managed Secrets." });
    }

    const defaults = await getRunpodLaunchDefaults();
    if (defaults.allowedGpus.length > 0 && !defaults.allowedGpus.includes(gpuType)) {
      await logAudit(userId!, "runpod_pod.launch_denied_budget", "runpod_pod", name, { reason: "GPU type not in allowed_gpus", gpuType });
      return res.status(422).json({ error: `GPU type "${gpuType}" is not in the configured allowed_gpus list.` });
    }

    // Budget enforcement must use a server-trusted cost, never a
    // caller-supplied value — otherwise a request could understate its own
    // cost to slip past the budget cap. If the GPU has no configured price,
    // fail closed rather than treating it as free.
    const candidateCost = await resolveTrustedGpuCost(gpuType);
    if (candidateCost === null) {
      return res.status(422).json({
        error: `No hourly price configured for GPU type "${gpuType}" — add it in Admin \u2192 RunPod \u2192 GPU Pricing before launching this GPU type.`,
      });
    }
    const budgetCheck = await checkBudgetForLaunch(candidateCost);
    if (!budgetCheck.allowed) {
      await logAudit(userId!, "runpod_pod.launch_denied_budget", "runpod_pod", name, { reason: budgetCheck.reason, candidateCost });
      return res.status(422).json({ error: budgetCheck.reason, budget: budgetCheck });
    }

    const [pending] = await db
      .insert(runpodPodsTable)
      .values({
        name,
        gpuType,
        templateId,
        volumeId: volumeId ?? null,
        region: region ?? null,
        costPerHrUsd: candidateCost,
        status: "provisioning",
        launchedBy: userId!,
        launchedAt: new Date(),
      })
      .returning();

    try {
      const launched = await launchPod({ name, gpuType, templateId, volumeId, region });
      const [updated] = await db
        .update(runpodPodsTable)
        .set({ runpodPodId: launched.id, status: "running", costPerHrUsd: launched.costPerHr ?? candidateCost, updatedAt: new Date() })
        .where(eq(runpodPodsTable.id, pending.id))
        .returning();

      await logAudit(userId!, "runpod_pod.launched", "runpod_pod", String(updated.id), { runpodPodId: launched.id, gpuType, templateId });
      return res.status(201).json(updated);
    } catch (launchErr) {
      const [failed] = await db
        .update(runpodPodsTable)
        .set({ status: "failed", lastError: launchErr instanceof Error ? launchErr.message : String(launchErr), updatedAt: new Date() })
        .where(eq(runpodPodsTable.id, pending.id))
        .returning();
      req.log.error(launchErr, "Failed to launch RunPod pod");
      return res.status(502).json({ error: "Failed to launch pod on RunPod", pod: failed });
    }
  } catch (err) {
    req.log.error(err, "Failed to launch RunPod pod");
    return res.status(500).json({ error: "Internal server error" });
  }
});

async function requirePod(req: any, res: any): Promise<typeof runpodPodsTable.$inferSelect | null> {
  const id = Number(req.params.id);
  const [pod] = await db.select().from(runpodPodsTable).where(eq(runpodPodsTable.id, id));
  if (!pod) {
    res.status(404).json({ error: "Pod not found" });
    return null;
  }
  return pod;
}

router.post("/pods/:id/stop", async (req, res) => {
  const { userId } = getAuth(req);
  try {
    const pod = await requirePod(req, res);
    if (!pod) return;
    if (!pod.runpodPodId) return res.status(409).json({ error: "Pod has no RunPod id yet" });

    await stopPod(pod.runpodPodId);
    const [updated] = await db
      .update(runpodPodsTable)
      .set({ status: "stopped", stoppedAt: new Date(), updatedAt: new Date() })
      .where(eq(runpodPodsTable.id, pod.id))
      .returning();
    await logAudit(userId!, "runpod_pod.stopped", "runpod_pod", String(pod.id), { runpodPodId: pod.runpodPodId });
    return res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to stop RunPod pod");
    return res.status(502).json({ error: "Failed to stop pod on RunPod" });
  }
});

router.post("/pods/:id/restart", async (req, res) => {
  const { userId } = getAuth(req);
  try {
    const pod = await requirePod(req, res);
    if (!pod) return;
    if (!pod.runpodPodId) return res.status(409).json({ error: "Pod has no RunPod id yet" });

    const budgetCheck = await checkBudgetForLaunch(pod.lastReportedCostPerHrUsd ?? pod.costPerHrUsd ?? 0);
    if (pod.status === "stopped" && !budgetCheck.allowed) {
      return res.status(422).json({ error: budgetCheck.reason, budget: budgetCheck });
    }

    await resumePod(pod.runpodPodId);
    const [updated] = await db
      .update(runpodPodsTable)
      .set({ status: "running", stoppedAt: null, updatedAt: new Date() })
      .where(eq(runpodPodsTable.id, pod.id))
      .returning();
    await logAudit(userId!, "runpod_pod.restarted", "runpod_pod", String(pod.id), { runpodPodId: pod.runpodPodId });
    return res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to restart RunPod pod");
    return res.status(502).json({ error: "Failed to restart pod on RunPod" });
  }
});

router.post("/pods/:id/terminate", async (req, res) => {
  const { userId } = getAuth(req);
  try {
    const pod = await requirePod(req, res);
    if (!pod) return;

    if (pod.runpodPodId) {
      await terminatePod(pod.runpodPodId);
    }
    const [updated] = await db
      .update(runpodPodsTable)
      .set({ status: "terminated", terminatedAt: new Date(), updatedAt: new Date() })
      .where(eq(runpodPodsTable.id, pod.id))
      .returning();
    await logAudit(userId!, "runpod_pod.terminated", "runpod_pod", String(pod.id), { runpodPodId: pod.runpodPodId });
    return res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to terminate RunPod pod");
    return res.status(502).json({ error: "Failed to terminate pod on RunPod" });
  }
});

router.post("/pods/:id/refresh", async (req, res) => {
  try {
    const pod = await requirePod(req, res);
    if (!pod) return;
    await pollRunpodPod(pod.id);
    const [updated] = await db.select().from(runpodPodsTable).where(eq(runpodPodsTable.id, pod.id));
    return res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to refresh RunPod pod status");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Logs & artifacts ────────────────────────────────────────────────────────

router.get("/pods/:id/logs", async (req, res) => {
  try {
    const pod = await requirePod(req, res);
    if (!pod) return;
    if (!pod.runpodPodId) return res.json({ lines: [] });
    const lines = await getPodLogs(pod.runpodPodId);
    return res.json({ lines });
  } catch (err) {
    req.log.error(err, "Failed to fetch RunPod pod logs");
    return res.status(502).json({ error: "Failed to fetch logs from RunPod" });
  }
});

router.get("/pods/:id/artifacts", async (req, res) => {
  try {
    const pod = await requirePod(req, res);
    if (!pod) return;
    if (!pod.volumeId) return res.json({ files: [] });
    const files = await listVolumeArtifacts(pod.volumeId);
    return res.json({ files });
  } catch (err) {
    req.log.error(err, "Failed to list RunPod pod artifacts");
    return res.status(502).json({ error: "Failed to list artifacts from RunPod" });
  }
});

// ─── Worker credentials ───────────────────────────────────────────────────────

router.get("/pods/:id/credentials", async (req, res) => {
  try {
    const pod = await requirePod(req, res);
    if (!pod) return;
    const creds = await listCredentialsForPod(pod.id);
    // Never return tokenHash — only metadata needed for the admin list view.
    return res.json(creds.map(({ tokenHash, ...rest }) => rest));
  } catch (err) {
    req.log.error(err, "Failed to list RunPod worker credentials");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/pods/:id/credentials", async (req, res) => {
  const { userId } = getAuth(req);
  const { scopeLabel } = req.body as { scopeLabel?: string };
  try {
    const pod = await requirePod(req, res);
    if (!pod) return;
    const issued = await issueWorkerCredential(pod.id, userId!, scopeLabel);
    // Raw token is only ever returned once, at issuance time.
    return res.status(201).json(issued);
  } catch (err) {
    req.log.error(err, "Failed to issue RunPod worker credential");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/credentials/:credentialId/rotate", async (req, res) => {
  const { userId } = getAuth(req);
  try {
    const credentialId = Number(req.params.credentialId);
    const rotated = await rotateWorkerCredential(credentialId, userId!);
    return res.json(rotated);
  } catch (err) {
    req.log.error(err, "Failed to rotate RunPod worker credential");
    return res.status(err instanceof Error && err.message === "Credential not found" ? 404 : 500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

router.delete("/credentials/:credentialId", async (req, res) => {
  const { userId } = getAuth(req);
  try {
    const credentialId = Number(req.params.credentialId);
    await revokeWorkerCredential(credentialId, userId!);
    return res.status(204).send();
  } catch (err) {
    req.log.error(err, "Failed to revoke RunPod worker credential");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
