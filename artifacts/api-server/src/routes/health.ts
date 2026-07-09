import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Liveness: process is up and can respond at all. Load balancers/orchestrators
// use this to decide whether to kill+restart the instance — it must never
// depend on downstream services, or a DB blip would cause a restart storm.
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Readiness: process is up AND able to serve real traffic (DB reachable).
// Load balancers/rolling-deploy orchestration use this to decide whether to
// route traffic to this instance — distinct from liveness so a temporarily
// DB-starved instance is taken out of rotation without being killed.
router.get("/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ready" });
  } catch (err) {
    logger.warn({ err }, "Readiness probe failed — DB unreachable");
    res.status(503).json({ status: "not_ready", reason: "database_unreachable" });
  }
});

export default router;
