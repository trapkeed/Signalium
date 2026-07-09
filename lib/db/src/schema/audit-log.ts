import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";
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
    ],
  }).notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogTable).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogTable.$inferSelect;
