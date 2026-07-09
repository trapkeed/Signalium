/**
 * S24B — Research Lab Integration Hub (admin gateway)
 *
 * Signalium is the identity provider / access gateway / admin frontend for
 * signalium-trainer's Research Lab — it never re-implements trainer business
 * logic. Every endpoint below proxies a read or action to researchLab.ts and
 * returns the trainer's response (or an explicit "unavailable" signal) —
 * never fabricated data.
 *
 * All routes are admin-only (requireAdmin, not requireStaff — this exposes
 * training/deployment internals). Deployment candidate approve/rollback
 * actions, plus access to the deployment-candidates views, are written to
 * the platform audit log (research_lab.* actions) since they are the most
 * production-impacting / sensitive surface in this hub.
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAudit } from "../lib/auditLog";
import * as researchLab from "../lib/researchLab";
import { ResearchLabUnavailableError } from "../lib/researchLab";

const router = Router();

router.use(requireAdmin);

/**
 * Wraps a proxy call so an unavailable trainer degrades to a clean 503 signal
 * instead of a 500. Returns whether the underlying call actually succeeded,
 * so callers can gate audit logging on real success rather than logging an
 * "accessed" event for a request that only reached an unavailable trainer.
 */
async function proxy<T>(res: import("express").Response, fn: () => Promise<T>): Promise<boolean> {
  try {
    const data = await fn();
    res.json(data);
    return true;
  } catch (err) {
    if (err instanceof ResearchLabUnavailableError) {
      res.status(503).json({ error: "research_lab_unavailable", message: err.message });
      return false;
    }
    throw err;
  }
}

router.get("/status", async (_req, res) => {
  res.json({ configured: researchLab.isResearchLabConfigured() });
});

// ─── 1. Experiments ───────────────────────────────────────────────────────────

router.get("/experiments", async (req, res) => {
  await proxy(res, () => researchLab.listExperiments({
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    status: req.query.status as string | undefined,
  }));
});
router.get("/experiments/:id", async (req, res) => {
  await proxy(res, () => researchLab.getExperiment(req.params.id));
});
router.get("/experiments/:id/lineage", async (req, res) => {
  await proxy(res, () => researchLab.getExperimentLineage(req.params.id));
});
router.get("/experiments/:id/history", async (req, res) => {
  await proxy(res, () => researchLab.getExperimentHistory(req.params.id));
});

// ─── 2. Training ──────────────────────────────────────────────────────────────

router.get("/training/runs", async (req, res) => {
  await proxy(res, () => researchLab.listTrainingRuns({
    status: req.query.status as string | undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  }));
});
router.get("/training/runs/:id", async (req, res) => {
  await proxy(res, () => researchLab.getTrainingRun(req.params.id));
});
router.get("/training/resource-usage", async (_req, res) => {
  await proxy(res, () => researchLab.getTrainingResourceUsage());
});

// ─── 3. Validation ────────────────────────────────────────────────────────────

router.get("/validation/reports", async (req, res) => {
  await proxy(res, () => researchLab.listValidationReports({ limit: req.query.limit ? Number(req.query.limit) : undefined }));
});
router.get("/validation/reports/:id", async (req, res) => {
  await proxy(res, () => researchLab.getValidationReport(req.params.id));
});
router.get("/validation/drift", async (_req, res) => {
  await proxy(res, () => researchLab.getDriftMonitoring());
});
router.get("/validation/robustness", async (req, res) => {
  await proxy(res, () => researchLab.getRobustnessTests({ limit: req.query.limit ? Number(req.query.limit) : undefined }));
});

// ─── 4. Shadow Testing ────────────────────────────────────────────────────────

router.get("/shadow-testing/deployments", async (req, res) => {
  await proxy(res, () => researchLab.listShadowDeployments({ status: req.query.status as string | undefined }));
});
router.get("/shadow-testing/deployments/:id/comparison", async (req, res) => {
  await proxy(res, () => researchLab.getShadowComparison(req.params.id));
});
router.get("/shadow-testing/deployments/:id/agreement", async (req, res) => {
  await proxy(res, () => researchLab.getShadowAgreementAnalysis(req.params.id));
});
router.get("/shadow-testing/deployments/:id/regimes", async (req, res) => {
  await proxy(res, () => researchLab.getShadowRegimeComparison(req.params.id));
});

// ─── 5. Deployment (candidates) — sensitive: audited on read and action ──────

router.get("/deployment-candidates", async (req, res) => {
  const { userId } = getAuth(req);
  const ok = await proxy(res, () => researchLab.listDeploymentCandidates({ status: req.query.status as string | undefined }));
  if (ok && userId) {
    await logAudit(userId, "research_lab.sensitive_view_accessed", "research_lab_deployment_candidates", "list").catch(() => {});
  }
});
router.get("/deployment-candidates/history", async (req, res) => {
  const { userId } = getAuth(req);
  const ok = await proxy(res, () => researchLab.getResearchDeploymentHistory({ limit: req.query.limit ? Number(req.query.limit) : undefined }));
  if (ok && userId) {
    await logAudit(userId, "research_lab.sensitive_view_accessed", "research_lab_deployment_candidates", "history").catch(() => {});
  }
});
router.get("/deployment-candidates/:id", async (req, res) => {
  const { userId } = getAuth(req);
  const ok = await proxy(res, () => researchLab.getDeploymentCandidate(req.params.id));
  if (ok && userId) {
    await logAudit(userId, "research_lab.sensitive_view_accessed", "research_lab_deployment_candidate", req.params.id).catch(() => {});
  }
});
router.post("/deployment-candidates/:id/approve", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const data = await researchLab.approveDeploymentCandidate(req.params.id, userId);
    await logAudit(userId, "research_lab.candidate_approved", "research_lab_deployment_candidate", req.params.id, { result: data });
    return res.json(data);
  } catch (err) {
    if (err instanceof ResearchLabUnavailableError) {
      return res.status(503).json({ error: "research_lab_unavailable", message: err.message });
    }
    throw err;
  }
});
router.post("/deployment-candidates/:id/rollback", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
  try {
    const data = await researchLab.rollbackDeploymentCandidate(req.params.id, userId, reason);
    await logAudit(userId, "research_lab.candidate_rolled_back", "research_lab_deployment_candidate", req.params.id, { reason: reason ?? null, result: data });
    return res.json(data);
  } catch (err) {
    if (err instanceof ResearchLabUnavailableError) {
      return res.status(503).json({ error: "research_lab_unavailable", message: err.message });
    }
    throw err;
  }
});

// ─── 6. Research Intelligence ─────────────────────────────────────────────────

router.get("/research-intelligence/features", async (req, res) => {
  await proxy(res, () => researchLab.listDiscoveredFeatures({ limit: req.query.limit ? Number(req.query.limit) : undefined }));
});
router.get("/research-intelligence/failure-investigations", async (req, res) => {
  await proxy(res, () => researchLab.listFailureInvestigations({ limit: req.query.limit ? Number(req.query.limit) : undefined }));
});
router.get("/research-intelligence/self-evaluations", async (req, res) => {
  await proxy(res, () => researchLab.listSelfEvaluationFindings({ limit: req.query.limit ? Number(req.query.limit) : undefined }));
});
router.get("/research-intelligence/retraining-recommendations", async (req, res) => {
  await proxy(res, () => researchLab.listRetrainingRecommendations({ limit: req.query.limit ? Number(req.query.limit) : undefined }));
});

// ─── 7. QDE Genealogy ──────────────────────────────────────────────────────────

router.get("/genealogy/tree", async (req, res) => {
  await proxy(res, () => researchLab.getGenealogyTree(req.query.root as string | undefined));
});
router.get("/genealogy/:modelVersion", async (req, res) => {
  await proxy(res, () => researchLab.getModelGenealogy(req.params.modelVersion));
});
router.get("/genealogy/:modelVersion/artifacts", async (req, res) => {
  await proxy(res, () => researchLab.listArtifactHistory(req.params.modelVersion));
});

export default router;
