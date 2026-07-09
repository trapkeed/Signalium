import { pgTable, text, serial, timestamp, jsonb, uniqueIndex, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Platform-wide audit log for significant admin actions (role changes,
// subscription/payment overrides, content publishing, referral overrides,
// etc). Generalizes the per-feature pattern established by
// ea-build-audit-log.ts to cover the whole admin panel in one place so it can
// be viewed/filtered centrally. targetType + targetId together identify the
// affected entity (e.g. targetType "user", targetId the Clerk user id);
// detail carries action-specific before/after context.
export const auditLogTable = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  actorUserId: text("actor_user_id").notNull(),
  action: text("action", {
    enum: [
      "user.role_changed",
      "user.deactivated",
      "user.activated",
      "subscription.overridden",
      "subscription.suspended",
      "subscription.reactivated",
      "subscription.extended",
      "subscription.credit_granted",
      "payment.overridden",
      "payment.refunded",
      "announcement.published",
      "announcement.unpublished",
      "knowledge_base.published",
      "knowledge_base.unpublished",
      "maintenance_banner.updated",
      "referral.removed",
      "broker.created",
      "broker.updated",
      "broker.deleted",
      "data_provider.created",
      "data_provider.updated",
      "data_provider.deleted",
      "data_provider.priority_updated",
      "provider_credential.created",
      "provider_credential.updated",
      "provider_credential.deleted",
      "provider_capability.upserted",
      "provider_capability.deleted",
      "provider_symbol_mapping.upserted",
      "provider_symbol_mapping.deleted",
      "inference_controls.updated",
      "opportunity.state_override",
      "market_memory.created",
      "feature_flag.created",
      "feature_flag.updated",
      "feature_flag.deleted",
      "api_key.created",
      "api_key.revoked",
      "api_key.rotated",
      "api_key.suspended",
      "api_key.reactivated",
      "ea_registration.created",
      "ea_registration.deactivated",
      "model_request.action_issued",
      "security_incident.acknowledged",
      "security_incident.resolved",
      "research_lab.candidate_approved",
      "research_lab.candidate_rolled_back",
      "research_lab.sensitive_view_accessed",
      "admin_role.granted",
      "admin_role.revoked",
      "admin_role.assumed",
      "admin_role.assumption_ended",
      "sso.token_issued",
      "sso.token_refreshed",
      "sso.token_revoked",
      "sso.all_tokens_revoked",
      "sso.signing_key_rotated",
      // S26 — Scalability, HA & Disaster Recovery
      "backup.triggered",
      "backup.validated",
      "backup.restore_plan_generated",
      "config.exported",
      "config.imported",
      "secret_rotation.marked_rotated",
      "job_queue.requeued",
      // S27 — Deployment Governance Visibility
      "governance.overview_viewed",
      // S28 — Compliance and Audit Infrastructure
      "user.account_created",
      "user.login_succeeded",
      "trading_mode.autonomous_activated",
      "trading_mode.autonomous_deactivated",
      "trading.emergency_stop_activated",
      "trading.emergency_stop_deactivated",
      "consent.recorded",
      "data_export.requested",
      "data_export.completed",
      "account_deletion.requested",
      "account_deletion.confirmed",
      "account_deletion.cancelled",
      "account_deletion.completed",
      "compliance.audit_log_exported",
      // S29 — Security Hardening and Production Lockdown
      "user.session_evicted",
      "ip_blocklist.added",
      "ip_blocklist.removed",
      "role_escalation.requested",
      "role_escalation.approved",
      "role_escalation.rejected",
      "role_escalation.cancelled",
      "ea_build.signed",
      "admin_session.idle_expired",
      // S30 — Launch Readiness and Go Live
      "support_ticket.assigned",
      "support_ticket.escalated",
      "support_ticket.categorized",
      "onboarding.step_completed",
      "release.smoke_test_run",
      // Homepage/landing-page content CMS
      "site_content.updated",
      "site_content.reset",
      // Admin user CRUD + secrets vault
      "user.created",
      "user.deleted",
      "admin_secret.created",
      "admin_secret.updated",
      "admin_secret.deleted",
      "admin_secret.revealed",
      // RunPod GPU orchestration
      "runpod_pod.launched",
      "runpod_pod.stopped",
      "runpod_pod.restarted",
      "runpod_pod.terminated",
      "runpod_pod.launch_denied_budget",
      "runpod_budget.updated",
      "runpod_credential.issued",
      "runpod_credential.rotated",
      "runpod_credential.revoked",
      // Trainer Admin Control Plane
      "trainer_control.training_started",
      "trainer_control.training_stopped",
      "trainer_control.experiment_created",
      "trainer_control.shadow_test_launched",
      "trainer_control.sensitive_view_accessed",
    ],
  }).notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // ─── S28 tamper-resistance ──────────────────────────────────────────────
  // Immutable, externally-referenceable identifier — distinct from the
  // internal serial `id` so a compliance export can cite a stable id even if
  // the table were ever reindexed/rebuilt.
  eventUuid: text("event_uuid").notNull(),
  // Hash chain: every row's `hash` commits to its own fields *and* the
  // previous row's hash (sha256, see auditLog.ts computeEntryHash), so any
  // retroactive edit or deletion of a row breaks the chain from that point
  // forward — detectable via verifyAuditChain() without needing a separate
  // WORM store. `sequenceNum` is the chain position (1-based, monotonic),
  // independent of the serial `id` so gaps are unambiguous.
  sequenceNum: integer("sequence_num").notNull(),
  prevHash: text("prev_hash"),
  hash: text("hash").notNull(),
}, (table) => [
  uniqueIndex("audit_log_event_uuid_idx").on(table.eventUuid),
  uniqueIndex("audit_log_sequence_num_idx").on(table.sequenceNum),
]);

export const insertAuditLogSchema = createInsertSchema(auditLogTable).omit({ id: true, createdAt: true, eventUuid: true, sequenceNum: true, prevHash: true, hash: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogTable.$inferSelect;
