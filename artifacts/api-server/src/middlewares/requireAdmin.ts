import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isAdminLevel, isStaffLevel, isSuperAdmin, type UserRole } from "../lib/roles";

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
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const role = await getUserRole(userId);
    if (!role || !isAdminLevel(role)) {
      return res.status(403).json({ error: "Admin access required" });
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
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const role = await getUserRole(userId);
    if (!role || !isStaffLevel(role)) {
      return res.status(403).json({ error: "Staff access required" });
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
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const role = await getUserRole(userId);
    if (!role || !isSuperAdmin(role)) {
      return res.status(403).json({ error: "Super-admin access required" });
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
