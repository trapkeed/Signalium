/**
 * S25 — Unified Operations Dashboard
 *
 * GET /ops-dashboard/overview — single consolidated read covering User
 * Monitoring, EA Monitoring, Autonomous Trading Monitoring, Infrastructure
 * Monitoring, and an Admin Alerts summary. Gated to admin-level accounts
 * only (admin/super_admin) — one tier stricter than the generic staff-level
 * admin panel, since this surfaces platform-wide financial and risk data.
 */
import { Router, type IRouter } from "express";
import { requireAdmin } from "../middlewares/requireAdmin";
import { getOpsDashboardOverview } from "../lib/opsDashboard";

const router: IRouter = Router();

router.get("/overview", requireAdmin, async (req, res) => {
  try {
    const overview = await getOpsDashboardOverview();
    return res.json(overview);
  } catch (err) {
    req.log.error(err, "Failed to compute ops dashboard overview");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
