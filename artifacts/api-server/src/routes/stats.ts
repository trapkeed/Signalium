import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, subscriptionsTable, easTable, telemetryTable, plansTable } from "@workspace/db";
import { eq, count, inArray, sql } from "drizzle-orm";
import { getLatestSnapshot } from "../lib/platformHealth";

const router = Router();

router.get("/overview", async (req, res) => {
  try {
    const [{ totalUsers }] = await db.select({ totalUsers: count() }).from(usersTable);
    const [{ activeSubscriptions }] = await db.select({ activeSubscriptions: count() })
      .from(subscriptionsTable)
      .where(inArray(subscriptionsTable.status, ["active", "grace_period"]));
    const [{ totalEas }] = await db.select({ totalEas: count() }).from(easTable);
    const [{ totalTelemetryEvents }] = await db.select({ totalTelemetryEvents: count() }).from(telemetryTable);

    const activeSubs = await db
      .select({ price: plansTable.priceMonthly, tier: plansTable.tier })
      .from(subscriptionsTable)
      .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
      .where(inArray(subscriptionsTable.status, ["active", "grace_period"]));

    const revenueMonthly = activeSubs.reduce((sum, s) => sum + (s.price ?? 0), 0);
    const tierCounts = activeSubs.reduce((acc: Record<string, number>, s) => {
      const tier = s.tier ?? "unknown";
      acc[tier] = (acc[tier] ?? 0) + 1;
      return acc;
    }, {});

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [{ recentSignups }] = await db.select({ recentSignups: count() })
      .from(usersTable)
      .where(sql`${usersTable.createdAt} > ${thirtyDaysAgo}`);

    return res.json({
      totalUsers,
      activeSubscriptions,
      totalEas,
      totalTelemetryEvents,
      revenueMonthly,
      subscriptionsByTier: tierCounts,
      recentSignups,
    });
  } catch (err) {
    req.log.error(err, "Failed to get stats overview");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/runtime-summary", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const events = await db.select().from(telemetryTable).where(eq(telemetryTable.userId, userId));

    const tradesOpened = events.filter(e => e.eventType === "trade_open").length;
    const tradesClosed = events.filter(e => e.eventType === "trade_close").length;
    const errors = events.filter(e => e.eventType === "error").length;
    const sorted = [...events].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const lastEvent = sorted[0];

    // Real system-health proxy rather than a hardcoded placeholder: the
    // most recent platform-health snapshot's DB-healthy flag. There is no
    // dedicated per-user uptime ledger, so this reflects platform-wide
    // operational status, not this specific user's EA connectivity.
    const latestHealth = await getLatestSnapshot();
    const uptime = latestHealth ? (latestHealth.dbHealthy ? 100 : 0) : null;

    return res.json({
      totalEvents: events.length,
      tradesOpened,
      tradesClosed,
      errors,
      uptime,
      lastActivity: lastEvent?.createdAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error(err, "Failed to get runtime summary");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
