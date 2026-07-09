import type { NextFunction, Request, Response } from "express";
import { getAuth } from "../lib/auth";
import { db, accountSecurityTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Blocks API access for accounts that have been security-locked (see
 * routes/account-security.ts). Mounted after the `/account` router so the
 * lock-status, unlock, and panic-button endpoints stay reachable while
 * locked. EA terminal endpoints authenticate via a raw API key rather than a
 * Clerk session, so requests with no Clerk userId pass through untouched.
 *
 * Fails closed: if the lock-status lookup itself fails, we do not let the
 * request through, since that would silently defeat the lock control for an
 * authenticated user during a DB hiccup.
 */
export async function blockWhenLocked(req: Request, res: Response, next: NextFunction) {
  const { userId } = getAuth(req);
  if (!userId) return next();

  try {
    const [security] = await db.select().from(accountSecurityTable).where(eq(accountSecurityTable.userId, userId));
    if (security?.isLocked) {
      return res.status(423).json({ error: "Account locked", lockReason: security.lockReason });
    }
    return next();
  } catch (err) {
    req.log.error(err, "Failed to check account lock status");
    return res.status(503).json({ error: "Unable to verify account security status, please retry" });
  }
}
