import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, userTradingSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { checkAutonomousAccess } from "../lib/entitlementEngine";

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
    return res.json(result);
  } catch (err) {
    req.log.error(err, "Failed to update trading settings");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
