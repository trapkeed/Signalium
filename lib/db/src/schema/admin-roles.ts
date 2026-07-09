import { pgTable, text, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// S24C — fine-grained administrative roles, additive on top of the legacy
// `users.role` tier (user/clerk/staff/admin/super_admin). A user may hold
// zero or more of these simultaneously (e.g. an Admin explicitly also
// granted DeploymentApprover). Legacy `super_admin`/`admin` DB roles are
// treated as implicitly holding the SuperAdmin/Admin admin-role respectively
// at read time (see lib/roles.ts getEffectiveAdminRoles) rather than being
// backfilled into rows here, so no migration/backfill script is needed.
export const ADMIN_ROLE_VALUES = [
  "super_admin",
  "admin",
  "founder",
  "quant_researcher",
  "ml_researcher",
  "deployment_approver",
  "auditor",
] as const;

export const adminRoleAssignmentsTable = pgTable("admin_role_assignments", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  role: text("role", { enum: ADMIN_ROLE_VALUES }).notNull(),
  grantedBy: text("granted_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("admin_role_assignments_user_role_idx").on(table.userId, table.role),
]);

export const insertAdminRoleAssignmentSchema = createInsertSchema(adminRoleAssignmentsTable).omit({ id: true, createdAt: true });
export type InsertAdminRoleAssignment = z.infer<typeof insertAdminRoleAssignmentSchema>;
export type AdminRoleAssignment = typeof adminRoleAssignmentsTable.$inferSelect;

// A SuperAdmin may temporarily "assume" another role for a bounded window,
// e.g. to see the platform exactly as an Auditor or DeploymentApprover would.
// Only one active (non-ended, non-expired) assumption per user at a time is
// meaningful — enforced at the application layer, not via a DB constraint,
// since ending/expiring is a state transition rather than a uniqueness rule.
export const roleAssumptionsTable = pgTable("role_assumptions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  assumedRole: text("assumed_role", { enum: ADMIN_ROLE_VALUES }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const insertRoleAssumptionSchema = createInsertSchema(roleAssumptionsTable).omit({ id: true, startedAt: true });
export type InsertRoleAssumption = z.infer<typeof insertRoleAssumptionSchema>;
export type RoleAssumption = typeof roleAssumptionsTable.$inferSelect;
