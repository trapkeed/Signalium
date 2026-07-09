/**
 * S28 — Compliance and Audit Infrastructure: admin-only surfaces. Distinct
 * from the self-service endpoints in account-security.ts, which are always
 * scoped to the caller's own records.
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, dataExportRequestsTable, accountDeletionRequestsTable, consentRecordsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { listAuditLog, verifyAuditChain, logAudit, type AuditAction } from "../lib/auditLog";
import { AUDIT_LOG_RETENTION_DAYS } from "../lib/auditRetention";
import { DELETION_GRACE_PERIOD_DAYS } from "../lib/dataGovernance";

const router = Router();

// GET /compliance/audit-log/export — full filterable export for compliance
// review/legal hold, distinct from the paginated /audit-log listing used by
// the admin UI's live table (higher row cap, and itself audited since
// exporting the audit log is a sensitive read).
router.get("/audit-log/export", requireAdmin, async (req, res) => {
  const { userId } = getAuth(req);
  const { action, actorUserId, targetType, targetId, from, to } = req.query as Record<string, string | undefined>;

  try {
    const entries = await listAuditLog({
      action: action as AuditAction | undefined,
      actorUserId,
      targetType,
      targetId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    }, 10_000);

    await logAudit(userId!, "compliance.audit_log_exported", "audit_log", "export", {
      rowCount: entries.length, filters: { action, actorUserId, targetType, targetId, from, to },
    });

    return res.json({ entries, rowCount: entries.length, exportedAt: new Date().toISOString() });
  } catch (err) {
    req.log.error(err, "Failed to export audit log");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /compliance/audit-log/verify — recomputes the tamper-evident hash chain
router.get("/audit-log/verify", requireAdmin, async (req, res) => {
  try {
    const result = await verifyAuditChain();
    return res.json(result);
  } catch (err) {
    req.log.error(err, "Failed to verify audit chain");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /compliance/data-requests — export and deletion requests across all users
router.get("/data-requests", requireAdmin, async (req, res) => {
  try {
    const [exports, deletions] = await Promise.all([
      db.select().from(dataExportRequestsTable).orderBy(desc(dataExportRequestsTable.requestedAt)).limit(500),
      db.select().from(accountDeletionRequestsTable).orderBy(desc(accountDeletionRequestsTable.requestedAt)).limit(500),
    ]);
    return res.json({ exports, deletions });
  } catch (err) {
    req.log.error(err, "Failed to fetch data governance requests");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /compliance/consent — consent records across all users (e.g. to answer
// "how many users have opted into marketing communications")
router.get("/consent", requireAdmin, async (req, res) => {
  try {
    const records = await db.select().from(consentRecordsTable).orderBy(desc(consentRecordsTable.updatedAt)).limit(1000);
    return res.json(records);
  } catch (err) {
    req.log.error(err, "Failed to fetch consent records");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /compliance/retention — documents the platform's retention policy so
// it's programmatically verifiable rather than living only in prose.
router.get("/retention", requireAdmin, async (req, res) => {
  return res.json({
    auditLogRetentionDays: AUDIT_LOG_RETENTION_DAYS,
    accountDeletionGracePeriodDays: DELETION_GRACE_PERIOD_DAYS,
    notes: [
      "Consent records are retained indefinitely by design — they are the proof that consent was (or wasn't) given, and their change history lives in audit_log rather than being pruned.",
      "Data export requests retain only a hash of the exported payload, never the payload itself, so they carry no ongoing personal-data retention obligation.",
      "Account deletion anonymizes personally-identifying fields and deactivates the account; payment/subscription and audit-log rows are retained for the platform's own financial and compliance record-keeping obligations.",
    ],
  });
});

export default router;
