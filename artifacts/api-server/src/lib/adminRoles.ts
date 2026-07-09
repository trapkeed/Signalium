/**
 * S24C — Admin role resolution & management.
 *
 * A user's *effective* admin roles are computed from three layers:
 *  1. Legacy `users.role` implication — a legacy `super_admin` implicitly
 *     holds the `super_admin` admin-role, and legacy `admin` implicitly
 *     holds the `admin` admin-role. This is computed at read time (not
 *     backfilled into `admin_role_assignments`), so no migration/backfill
 *     script is required and staying consistent with `users.role` changes
 *     (e.g. via the existing role-change endpoint) needs no extra wiring.
 *  2. Explicit grants in `admin_role_assignments` — e.g. an Admin explicitly
 *     also granted `deployment_approver`, or a non-admin-tier staff member
 *     granted `auditor` for compliance visibility.
 *  3. An active role assumption — a SuperAdmin may temporarily assume a
 *     single other role; while active, their effective set is scoped down
 *     to exactly that one role (so they see the platform as that role would)
 *     rather than the union of everything.
 */
import { db, usersTable, adminRoleAssignmentsTable, roleAssumptionsTable } from "@workspace/db";
import { and, eq, isNull, gt } from "drizzle-orm";
import type { AdminRoleName } from "./roles";
import { logAudit } from "./auditLog";

async function getLegacyRole(userId: string): Promise<string | null> {
  const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  return user?.role ?? null;
}

async function getActiveAssumption(userId: string) {
  const [assumption] = await db
    .select()
    .from(roleAssumptionsTable)
    .where(and(eq(roleAssumptionsTable.userId, userId), isNull(roleAssumptionsTable.endedAt), gt(roleAssumptionsTable.expiresAt, new Date())));
  return assumption ?? null;
}

/**
 * Returns the roles a user is actually acting under right now, accounting
 * for an in-progress role assumption. Use this (not `getGrantedAdminRoles`)
 * for permission checks.
 */
export async function getEffectiveAdminRoles(userId: string): Promise<AdminRoleName[]> {
  const assumption = await getActiveAssumption(userId);
  if (assumption) return [assumption.assumedRole as AdminRoleName];
  return getGrantedAdminRoles(userId);
}

/** Returns the roles actually granted to a user, ignoring any active assumption. */
export async function getGrantedAdminRoles(userId: string): Promise<AdminRoleName[]> {
  const [legacyRole, grants] = await Promise.all([
    getLegacyRole(userId),
    db.select({ role: adminRoleAssignmentsTable.role }).from(adminRoleAssignmentsTable).where(eq(adminRoleAssignmentsTable.userId, userId)),
  ]);
  const roles = new Set<AdminRoleName>(grants.map((g) => g.role as AdminRoleName));
  if (legacyRole === "super_admin") roles.add("super_admin");
  if (legacyRole === "admin") roles.add("admin");
  return Array.from(roles);
}

/** Grants `role` to `userId`. Idempotent — re-granting an already-held role is a no-op. Audit-logged. */
export async function grantAdminRole(actorUserId: string, targetUserId: string, role: AdminRoleName): Promise<void> {
  await db.insert(adminRoleAssignmentsTable).values({ userId: targetUserId, role, grantedBy: actorUserId }).onConflictDoNothing();
  await logAudit(actorUserId, "admin_role.granted", "user", targetUserId, { role });
}

/** Revokes an explicitly-granted `role` from `userId`. Cannot revoke a legacy-implied role — see `roles.ts`. Audit-logged. */
export async function revokeAdminRole(actorUserId: string, targetUserId: string, role: AdminRoleName): Promise<void> {
  await db.delete(adminRoleAssignmentsTable).where(and(eq(adminRoleAssignmentsTable.userId, targetUserId), eq(adminRoleAssignmentsTable.role, role)));
  await logAudit(actorUserId, "admin_role.revoked", "user", targetUserId, { role });
}

const ASSUMPTION_DURATION_MS = 60 * 60 * 1000; // 1 hour

/** Starts a bounded role assumption for a SuperAdmin. Ends any prior active assumption first. Audit-logged. */
export async function assumeRole(userId: string, role: AdminRoleName): Promise<{ expiresAt: Date }> {
  await endActiveAssumption(userId, userId);
  const expiresAt = new Date(Date.now() + ASSUMPTION_DURATION_MS);
  await db.insert(roleAssumptionsTable).values({ userId, assumedRole: role, expiresAt });
  await logAudit(userId, "admin_role.assumed", "user", userId, { role, expiresAt: expiresAt.toISOString() });
  return { expiresAt };
}

/** Ends a user's active role assumption early, if any. Audit-logged only when an assumption actually existed. */
export async function endActiveAssumption(actorUserId: string, targetUserId: string): Promise<void> {
  const assumption = await getActiveAssumption(targetUserId);
  if (!assumption) return;
  await db.update(roleAssumptionsTable).set({ endedAt: new Date() }).where(eq(roleAssumptionsTable.id, assumption.id));
  await logAudit(actorUserId, "admin_role.assumption_ended", "user", targetUserId, { role: assumption.assumedRole });
}

export async function getActiveAssumptionSummary(userId: string) {
  const assumption = await getActiveAssumption(userId);
  if (!assumption) return null;
  return { role: assumption.assumedRole as AdminRoleName, expiresAt: assumption.expiresAt };
}
