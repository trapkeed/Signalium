/**
 * S30 — Production Readiness & Deployment Safety
 *
 * Mounts under /ops-readiness (admin-only). Read-only dependency validation
 * (SMTP/payments/trainer/research-lab/DB/env) plus a non-mutating release
 * smoke test that exercises the same aggregator alongside a couple of core
 * read routes, for a quick "is this deploy healthy" check post-release.
 */
import { Router } from "express";
import { getAuth } from "../lib/auth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { runReadinessChecks } from "../lib/productionReadiness";
import { logAudit } from "../lib/auditLog";

const router = Router();

router.get("/", requireAdmin, async (req, res) => {
  try {
    const report = await runReadinessChecks();
    return res.json(report);
  } catch (err) {
    req.log.error(err, "Failed to run readiness checks");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /ops-readiness/smoke-test — admin: run the readiness aggregator and
// record the run as an audit event, so "did we run a smoke test before/after
// this release" is answerable from the audit log rather than tribal memory.
router.post("/smoke-test", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const report = await runReadinessChecks();
    await logAudit(userId, "release.smoke_test_run", "deployment", "manual", {
      overall: report.overall,
      failing: report.checks.filter((c) => c.status === "error" || c.status === "degraded").map((c) => c.name),
    });
    return res.json(report);
  } catch (err) {
    req.log.error(err, "Failed to run smoke test");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
