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

// ─── S24C: Single Sign-On Identity Provider — administrative roles ─────────
//
// These are additive, fine-grained roles layered on top of the legacy
// `UserRole` tier above. A user's *legacy* role still gates the admin panel
// itself (`isAdminLevel`/`isStaffLevel`); these `AdminRoleName`s gate what an
// admin-level user may specifically do once inside (approve a deployment,
// view research, audit the platform, etc). See adminRoles.ts for how a
// user's effective set is computed (legacy role implication + explicit DB
// grants + any active role assumption).

export type AdminRoleName =
  | "super_admin"
  | "admin"
  | "founder"
  | "quant_researcher"
  | "ml_researcher"
  | "deployment_approver"
  | "auditor";

export const ADMIN_ROLE_NAMES: AdminRoleName[] = [
  "super_admin",
  "admin",
  "founder",
  "quant_researcher",
  "ml_researcher",
  "deployment_approver",
  "auditor",
];

export const ADMIN_ROLE_LABELS: Record<AdminRoleName, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  founder: "Founder",
  quant_researcher: "Quant Researcher",
  ml_researcher: "ML Researcher",
  deployment_approver: "Deployment Approver",
  auditor: "Auditor",
};

/** Fine-grained permission strings enforced by `requirePermission`. */
export type Permission =
  | "platform.administer" // user mgmt, subscriptions, support, system config
  | "permissions.manage" // grant/revoke admin roles, assume roles
  | "research.quant" // experiments, datasets, feature engineering, backtesting, shadow testing
  | "research.ml" // training, validation, architecture/feature research
  | "research.view" // read-only visibility into research areas (Founder, Auditor)
  | "deployment.view" // deployment candidates/history visibility
  | "deployment.approve" // model promotion approval
  | "deployment.rollback" // rollback approval
  | "audit.view" // audit reports, compliance reviews
  | "trainer.inference" // scope granted to Signalium's own machine-to-machine Trainer service token — never held by a human admin role
  ;

/**
 * Base permission set granted by each admin role, on its own — before legacy
 * role implication or explicit per-user grants (e.g. an Admin explicitly
 * granted `deployment_approver`) are layered on top.
 *
 * SuperAdmin is intentionally not listed with an explicit set: it always
 * receives every permission unconditionally (see `hasPermission` below) —
 * "unrestricted system access... may assume any role... may manage
 * permissions".
 */
export const ROLE_PERMISSIONS: Record<Exclude<AdminRoleName, "super_admin">, Permission[]> = {
  admin: ["platform.administer", "deployment.view"],
  founder: ["research.view", "deployment.view", "audit.view"],
  quant_researcher: ["research.quant", "deployment.view"],
  ml_researcher: ["research.ml", "deployment.view"],
  deployment_approver: ["deployment.view", "deployment.approve", "deployment.rollback"],
  auditor: ["research.view", "deployment.view", "audit.view"],
};

/** Returns true if holding `roles` grants `permission` (SuperAdmin always does). */
export function hasPermission(roles: AdminRoleName[], permission: Permission): boolean {
  if (roles.includes("super_admin")) return true;
  return roles.some((role) => ROLE_PERMISSIONS[role as Exclude<AdminRoleName, "super_admin">]?.includes(permission));
}
