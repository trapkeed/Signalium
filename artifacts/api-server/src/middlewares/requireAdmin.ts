import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, adminSessionActivityTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isAdminLevel, isStaffLevel, isSuperAdmin, hasPermission, type UserRole, type Permission } from "../lib/roles";
import { getEffectiveAdminRoles } from "../lib/adminRoles";
import { logAudit } from "../lib/auditLog";

// S29 — admin-panel idle timeout. Clerk's own session lifetime is much
// longer (days) and is appropriate for the regular product, but a
// privileged admin session left open and unattended is a bigger blast
// radius, so admin/staff-gated routes specifically enforce a much shorter
// idle window on top of Clerk's session validity.
const ADMIN_IDLE_TIMEOUT_MS = 30 * 60_000;

/**
 * Touches (or checks + touches) the admin-activity row for this Clerk
 * session. Returns false — and the caller must reject the request — if the
 * session has been idle on admin routes longer than ADMIN_IDLE_TIMEOUT_MS.
 * A session's very first admin-route hit always passes (nothing to compare
 * against yet).
 */
async function checkAndTouchAdminActivity(userId: string, clerkSessionId: string | null | undefined): Promise<boolean> {
  if (!clerkSessionId) return true; // no session id to key on (e.g. non-cookie/service auth) — nothing to enforce
  const [existing] = await db.select().from(adminSessionActivityTable).where(eq(adminSessionActivityTable.clerkSessionId, clerkSessionId));
  const now = new Date();
  if (existing && now.getTime() - existing.lastSeenAt.getTime() > ADMIN_IDLE_TIMEOUT_MS) {
    // IMPORTANT: do NOT delete or touch the row here. Deleting/refreshing it
    // would make a later request look like a brand-new session (no row, or
    // a recent lastSeenAt => passes), letting a stale session back in after
    // a single rejected request. Leave lastSeenAt exactly as it was, so
    // every subsequent request on this same Clerk sessionId keeps failing
    // until Clerk itself issues a new sessionId (i.e. the user re-authenticates).
    void logAudit(userId, "admin_session.idle_expired", "user", userId, { clerkSessionId });
    return false;
  }
  await db.insert(adminSessionActivityTable).values({ clerkSessionId, userId, lastSeenAt: now })
    .onConflictDoUpdate({ target: adminSessionActivityTable.clerkSessionId, set: { lastSeenAt: now } });
  return true;
}

/**
 * Resolves the DB role for a Clerk user id. Returns null if the user doesn't
 * exist yet (not provisioned). Cached at the request level if already attached.
 */
export async function getUserRole(userId: string): Promise<UserRole | null> {
  const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  return (user?.role as UserRole) ?? null;
}

/**
 * Requires admin or super_admin role. Returns 401 for no session, 403 otherwise.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const { userId, sessionId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const role = await getUserRole(userId);
    if (!role || !isAdminLevel(role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    if (!(await checkAndTouchAdminActivity(userId, sessionId))) {
      return res.status(401).json({ error: "Admin session idle timeout — please sign in again", code: "ADMIN_SESSION_IDLE" });
    }
    return next();
  } catch (err) {
    req.log.error(err, "Failed to verify admin role");
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * Requires staff, admin, or super_admin role.
 */
export async function requireStaff(req: Request, res: Response, next: NextFunction) {
  const { userId, sessionId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const role = await getUserRole(userId);
    if (!role || !isStaffLevel(role)) {
      return res.status(403).json({ error: "Staff access required" });
    }
    if (!(await checkAndTouchAdminActivity(userId, sessionId))) {
      return res.status(401).json({ error: "Admin session idle timeout — please sign in again", code: "ADMIN_SESSION_IDLE" });
    }
    return next();
  } catch (err) {
    req.log.error(err, "Failed to verify staff role");
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * Requires super_admin role specifically.
 */
export async function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const { userId, sessionId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const role = await getUserRole(userId);
    if (!role || !isSuperAdmin(role)) {
      return res.status(403).json({ error: "Super-admin access required" });
    }
    if (!(await checkAndTouchAdminActivity(userId, sessionId))) {
      return res.status(401).json({ error: "Admin session idle timeout — please sign in again", code: "ADMIN_SESSION_IDLE" });
    }
    return next();
  } catch (err) {
    req.log.error(err, "Failed to verify super-admin role");
    return res.status(500).json({ error: "Internal server error" });
  }
}

/** @deprecated Use getUserRole + isAdminLevel instead. */
export async function isAdmin(userId: string): Promise<boolean> {
  const role = await getUserRole(userId);
  return !!role && isAdminLevel(role);
}

/**
 * S24C — Requires the caller to hold a fine-grained `Permission` via their
 * effective admin roles (legacy-role implication + explicit grants + any
 * active role assumption; see adminRoles.ts). Use this for routes that need
 * to distinguish between admin-role holders (e.g. gate deployment approval
 * to DeploymentApprover/SuperAdmin only, not every generic Admin).
 *
 * Still requires at least admin-panel access (staff level) first, so a
 * plain `user`/`clerk` account can never reach a permission check at all.
 */
export function requirePermission(permission: Permission): RequestHandler {
  return requireAnyPermission(permission);
}

/** Like `requirePermission`, but passes if the caller holds ANY of the listed permissions. */
export function requireAnyPermission(...permissions: Permission[]): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { userId, sessionId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const legacyRole = await getUserRole(userId);
      if (!legacyRole || !isStaffLevel(legacyRole)) {
        return res.status(403).json({ error: "Admin access required" });
      }
      if (!(await checkAndTouchAdminActivity(userId, sessionId))) {
        return res.status(401).json({ error: "Admin session idle timeout — please sign in again", code: "ADMIN_SESSION_IDLE" });
      }
      const roles = await getEffectiveAdminRoles(userId);
      if (!permissions.some((p) => hasPermission(roles, p))) {
        return res.status(403).json({ error: `Missing required permission (any of): ${permissions.join(", ")}` });
      }
      return next();
    } catch (err) {
      req.log.error(err, "Failed to verify permission");
      return res.status(500).json({ error: "Internal server error" });
    }
  };
}
