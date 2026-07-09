import { Router } from "express";
import { getAuth } from "../lib/auth";
import { db, userTradingSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { checkAutonomousAccess } from "../lib/entitlementEngine";
import { logAudit } from "../lib/auditLog";
import { resolveMarketSourceForUser } from "../lib/marketData/marketSource";

const router = Router();

// ─── GET /trading-settings ────────────────────────────────────────────────────
// Returns the user's current trading mode and risk mode preferences.
// Defaults to manual/manual if no row has been saved yet.
router.get("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [settings] = await db
      .select()
      .from(userTradingSettingsTable)
      .where(eq(userTradingSettingsTable.userId, userId));

    return res.json(
      settings ?? { userId, tradingMode: "manual", riskMode: "manual", updatedAt: null },
    );
  } catch (err) {
    req.log.error(err, "Failed to get trading settings");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /trading-settings ────────────────────────────────────────────────────
// Update trading mode (manual/autonomous) and/or risk mode (manual/qde).
// Enabling autonomous mode requires the plan to permit it.
router.put("/", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { tradingMode, riskMode } = req.body as {
    tradingMode?: string;
    riskMode?: string;
  };

  if (tradingMode !== undefined && !["manual", "autonomous"].includes(tradingMode)) {
    return res.status(400).json({ error: "tradingMode must be 'manual' or 'autonomous'" });
  }
  if (riskMode !== undefined && !["manual", "qde"].includes(riskMode)) {
    return res.status(400).json({ error: "riskMode must be 'manual' or 'qde'" });
  }
  if (tradingMode === undefined && riskMode === undefined) {
    return res.status(400).json({ error: "Provide at least one of tradingMode or riskMode" });
  }

  // Enabling autonomous trading requires an entitlement check
  if (tradingMode === "autonomous") {
    const access = await checkAutonomousAccess(userId);
    if (!access.allowed) {
      return res.status(403).json({ error: access.message, code: access.code });
    }
  }

  try {
    const [existing] = await db
      .select()
      .from(userTradingSettingsTable)
      .where(eq(userTradingSettingsTable.userId, userId));

    const updates: Partial<typeof userTradingSettingsTable.$inferInsert> & { updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (tradingMode !== undefined) updates.tradingMode = tradingMode as "manual" | "autonomous";
    if (riskMode !== undefined) updates.riskMode = riskMode as "manual" | "qde";

    let result: typeof userTradingSettingsTable.$inferSelect;
    if (existing) {
      const [updated] = await db
        .update(userTradingSettingsTable)
        .set(updates)
        .where(eq(userTradingSettingsTable.userId, userId))
        .returning();
      result = updated;
    } else {
      const [inserted] = await db
        .insert(userTradingSettingsTable)
        .values({
          userId,
          tradingMode: (tradingMode ?? "manual") as "manual" | "autonomous",
          riskMode: (riskMode ?? "manual") as "manual" | "qde",
        })
        .returning();
      result = inserted;
    }

    if (tradingMode === "autonomous" && existing?.tradingMode !== "autonomous") {
      await logAudit(userId, "trading_mode.autonomous_activated", "user", userId, {});
    } else if (tradingMode === "manual" && existing?.tradingMode === "autonomous") {
      await logAudit(userId, "trading_mode.autonomous_deactivated", "user", userId, {});
    }

    return res.json(result);
  } catch (err) {
    req.log.error(err, "Failed to update trading settings");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /trading-settings/market-source ─────────────────────────────────────
// Resolves the market data source currently serving this user (EA feed vs.
// external provider, with failover already applied for autonomous mode) —
// backs the dashboard feed-status widget.
router.get("/market-source", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const resolved = await resolveMarketSourceForUser(userId);
    return res.json(resolved);
  } catch (err) {
    req.log.error(err, "Failed to resolve market source");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /trading-settings/emergency-stop ───────────────────────────────────
// Self-service kill switch: immediately forces the caller's own trading mode
// to manual (halting autonomous QDE-driven trade requests) regardless of
// plan entitlement checks — this must always be reachable, even for a user
// who no longer has autonomous-plan access, since its entire purpose is to
// stop trading, not gate it.
router.post("/emergency-stop", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [existing] = await db
      .select()
      .from(userTradingSettingsTable)
      .where(eq(userTradingSettingsTable.userId, userId));

    let result: typeof userTradingSettingsTable.$inferSelect;
    if (existing) {
      const [updated] = await db.update(userTradingSettingsTable)
        .set({ tradingMode: "manual", updatedAt: new Date() })
        .where(eq(userTradingSettingsTable.userId, userId))
        .returning();
      result = updated;
    } else {
      const [inserted] = await db.insert(userTradingSettingsTable)
        .values({ userId, tradingMode: "manual", riskMode: "manual" })
        .returning();
      result = inserted;
    }

    // Only log when this call actually changed something — an idle re-click
    // (already manual, including the implicit "no settings row yet" default
    // of manual) shouldn't add noise to the audit trail every time.
    if (existing && existing.tradingMode !== "manual") {
      await logAudit(userId, "trading.emergency_stop_activated", "user", userId, {
        previousMode: existing?.tradingMode ?? "manual",
      });
    }

    return res.json(result);
  } catch (err) {
    req.log.error(err, "Failed to activate emergency stop");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
