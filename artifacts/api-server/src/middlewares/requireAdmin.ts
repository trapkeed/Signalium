import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Requires the authenticated Clerk user to have `role: "admin"` in the
 * `users` table. Mount after `clerkMiddleware()`. Returns 401 if there is
 * no session, 403 if the user is not an admin.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    if (!(await isAdmin(userId))) {
      return res.status(403).json({ error: "Admin access required" });
    }
    return next();
  } catch (err) {
    req.log.error(err, "Failed to verify admin role");
    return res.status(500).json({ error: "Internal server error" });
  }
}

/** Checks whether the given Clerk user id belongs to a user with role "admin". */
export async function isAdmin(userId: string): Promise<boolean> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return !!user && user.role === "admin";
}
