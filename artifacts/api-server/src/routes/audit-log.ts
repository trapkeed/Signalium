import { Router } from "express";
import { requireAdmin } from "../middlewares/requireAdmin";
import { listAuditLog } from "../lib/auditLog";

const router = Router();

// GET /audit-log — admin: platform-wide audit log, filterable by action,
// actor, target type/id, and date range.
router.get("/", requireAdmin, async (req, res) => {
  try {
    const { action, actorUserId, targetType, targetId, category, from, to } = req.query as Record<string, string | undefined>;
    const entries = await listAuditLog({
      action,
      actorUserId,
      targetType,
      targetId,
      category,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
    return res.json(entries);
  } catch (err) {
    req.log.error(err, "Failed to fetch audit log");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
