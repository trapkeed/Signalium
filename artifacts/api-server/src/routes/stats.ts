import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, subscriptionsTable, easTable, telemetryTable, plansTable } from "@workspace/db";
import { eq, count, sql } from "drizzle-orm";

const router = Router();

router.get("/overview", async (req, res) => {
  try {
    const [{ totalUsers }] = await db.select({ totalUsers: count() }).from(usersTable);
    const [{ activeSubscriptions }] = await db.select({ activeSubscriptions: count() })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.status, "active"));
    const [{ totalEas }] = await db.select({ totalEas: count() }).from(easTable);
    const [{ totalTelemetryEvents }] = await db.select({ totalTelemetryEvents: count() }).from(telemetryTable);

    const activeSubs = await db
      .select({ price: plansTable.priceMonthly, tier: plansTable.tier })
      .from(subscriptionsTable)
      .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
      .where(eq(subscriptionsTable.status, "active"));

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

    return res.json({
      totalEvents: events.length,
      tradesOpened,
      tradesClosed,
      errors,
      uptime: 99.9,
      lastActivity: lastEvent?.createdAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error(err, "Failed to get runtime summary");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
