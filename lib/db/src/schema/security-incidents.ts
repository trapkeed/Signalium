import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Automated security-detection findings — distinct from the manually-curated
// operational_incidents table (BROKER/EA/SERVER/PAYMENT/MODEL/NETWORK ops
// incidents). Rows here are created by detectors (rate-tracking middleware,
// webhook signature checks, the security sweep) rather than admins, and are
// deduped per (type, scope) the same way S23b's platform_alerts are.
export const securityIncidentsTable = pgTable("security_incidents", {
  id: serial("id").primaryKey(),
  type: text("type", {
    enum: [
      "brute_force_auth",
      "invalid_webhook_signature",
      "api_abuse",
      "excessive_ea_requests",
      "abnormal_trading_activity",
    ],
  }).notNull(),
  severity: text("severity", { enum: ["low", "medium", "high", "critical"] }).notNull().default("medium"),
  // Scope columns — at least one is usually set, used both for display and
  // for dedup matching. Never all three for the same incident type/finding.
  userId: text("user_id"),
  ipAddress: text("ip_address"),
  apiKeyId: integer("api_key_id"),
  // Free-form dedup discriminator for incident types whose real-world scope
  // isn't one of userId/ipAddress/apiKeyId (e.g. "stripe" vs "paypal" for
  // invalid_webhook_signature) — without this, dedup would collapse
  // unrelated findings of the same type into one open incident. Callers that
  // omit it fall back to type-wide dedup (acceptable for types that are
  // already scoped by userId/ipAddress/apiKeyId).
  scopeKey: text("scope_key"),
  message: text("message").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
  status: text("status", { enum: ["open", "acknowledged", "resolved"] }).notNull().default("open"),
  acknowledgedBy: text("acknowledged_by"),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSecurityIncidentSchema = createInsertSchema(securityIncidentsTable).omit({
  id: true, createdAt: true, acknowledgedAt: true, resolvedAt: true,
});
export type InsertSecurityIncident = z.infer<typeof insertSecurityIncidentSchema>;
export type SecurityIncident = typeof securityIncidentsTable.$inferSelect;
