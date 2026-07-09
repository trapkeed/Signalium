/**
 * S29 — IP reputation gate. Blocks requests from IPs on `ip_blocklist`
 * before they reach any route/auth logic. The blocklist is populated
 * automatically (see `maybeAutoBlockIp`) from repeated open security
 * incidents against the same IP, plus whatever an admin adds manually via
 * the security routes.
 *
 * Checked in-process with a short TTL cache so a blocked IP doesn't cost a
 * DB round-trip on every single request under active abuse (the same
 * scenario where this matters most).
 */
import type { NextFunction, Request, Response } from "express";
import { db, ipBlocklistTable, securityIncidentsTable } from "@workspace/db";
import { eq, and, gte, or, isNull } from "drizzle-orm";
import { logger } from "../lib/logger";

const cache = new Map<string, { blocked: boolean; checkedAt: number }>();
const CACHE_TTL_MS = 30_000;

export async function isIpBlocked(ipAddress: string): Promise<boolean> {
  const cached = cache.get(ipAddress);
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) return cached.blocked;

  const now = new Date();
  const [entry] = await db.select().from(ipBlocklistTable).where(
    and(eq(ipBlocklistTable.ipAddress, ipAddress), or(isNull(ipBlocklistTable.expiresAt), gte(ipBlocklistTable.expiresAt, now))),
  );
  const blocked = !!entry;
  cache.set(ipAddress, { blocked, checkedAt: Date.now() });
  return blocked;
}

export async function ipReputationGate(req: Request, res: Response, next: NextFunction) {
  try {
    const ip = req.ip;
    if (ip && await isIpBlocked(ip)) {
      return res.status(403).json({ error: "Access denied" });
    }
    return next();
  } catch (err) {
    // Fail open — a lookup error must never take down the whole API.
    logger.warn({ err }, "IP reputation check failed");
    return next();
  }
}

const AUTO_BLOCK_THRESHOLD = 5; // open incidents against the same IP within the window
const AUTO_BLOCK_WINDOW_MS = 60 * 60_000;
const AUTO_BLOCK_DURATION_MS = 24 * 60 * 60_000;

/**
 * Called by detectors after emitting a new security incident for an IP —
 * escalates to a temporary auto-block once the same IP has accumulated
 * enough open incidents in the window. Best-effort; never throws.
 */
export async function maybeAutoBlockIp(ipAddress: string): Promise<void> {
  try {
    const since = new Date(Date.now() - AUTO_BLOCK_WINDOW_MS);
    const recent = await db.select({ id: securityIncidentsTable.id }).from(securityIncidentsTable)
      .where(and(eq(securityIncidentsTable.ipAddress, ipAddress), gte(securityIncidentsTable.createdAt, since)));
    if (recent.length < AUTO_BLOCK_THRESHOLD) return;

    const [existing] = await db.select().from(ipBlocklistTable).where(eq(ipBlocklistTable.ipAddress, ipAddress));
    if (existing) return;

    await db.insert(ipBlocklistTable).values({
      ipAddress,
      reason: `Automated: ${recent.length} open security incidents within the last hour`,
      expiresAt: new Date(Date.now() + AUTO_BLOCK_DURATION_MS),
      addedBy: null,
    }).onConflictDoNothing();
    cache.delete(ipAddress);
    logger.warn({ ipAddress, incidentCount: recent.length }, "IpReputation: auto-blocked IP");
  } catch (err) {
    logger.warn({ err, ipAddress }, "Failed to auto-block IP");
  }
}
