/**
 * Role hierarchy for Signalium's RBAC system.
 *
 * Levels (ascending — higher number = more authority):
 *   user(0) < clerk(1) < staff(2) < admin(3) < super_admin(4)
 *
 * Rules enforced here:
 *  - Only super_admin can assign roles.
 *  - An actor can only assign roles STRICTLY BELOW their own level.
 *  - An actor cannot change their own role.
 *  - All non-user roles receive a blanket entitlement bypass (free paid access).
 */

export type UserRole = "user" | "clerk" | "staff" | "admin" | "super_admin";

export const ROLE_LEVEL: Record<UserRole, number> = {
  user:        0,
  clerk:       1,
  staff:       2,
  admin:       3,
  super_admin: 4,
};

/** Returns true for every role that gets free access to all paid features. */
export function isPrivilegedRole(role: UserRole | string): boolean {
  return role !== "user";
}

/** Returns true for roles that may access the admin panel. */
export function hasAdminPanelAccess(role: UserRole | string): boolean {
  return isPrivilegedRole(role);
}

/** Returns true for roles that may perform admin CRUD operations. */
export function isAdminLevel(role: UserRole | string): boolean {
  return (ROLE_LEVEL[role as UserRole] ?? 0) >= ROLE_LEVEL.admin;
}

/** Returns true for roles that may perform staff-level operations (support, content). */
export function isStaffLevel(role: UserRole | string): boolean {
  return (ROLE_LEVEL[role as UserRole] ?? 0) >= ROLE_LEVEL.staff;
}

/** Returns true only for super_admin. */
export function isSuperAdmin(role: UserRole | string): boolean {
  return role === "super_admin";
}

/**
 * Returns true if `actorRole` is permitted to assign `targetRole` to another user.
 *
 * Rules:
 *  - Actor must be super_admin.
 *  - Target role must be strictly below the actor's level (cannot promote to same tier).
 */
export function canAssignRole(actorRole: UserRole | string, targetRole: UserRole | string): boolean {
  if (!isSuperAdmin(actorRole)) return false;
  const actorLevel = ROLE_LEVEL[actorRole as UserRole] ?? 0;
  const targetLevel = ROLE_LEVEL[targetRole as UserRole] ?? 0;
  return targetLevel < actorLevel;
}

/** Human-readable label for each role. */
export const ROLE_LABELS: Record<UserRole, string> = {
  user:        "User",
  clerk:       "Clerk",
  staff:       "Staff",
  admin:       "Admin",
  super_admin: "Super Admin",
};

/** All assignable roles in descending privilege order (excludes super_admin — no one can create peers). */
export const ASSIGNABLE_ROLES: UserRole[] = ["admin", "staff", "clerk", "user"];
