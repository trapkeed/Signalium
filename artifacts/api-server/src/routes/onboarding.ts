/**
 * S30 — Onboarding & Account-Completion Checklist
 *
 * Rather than a new "onboarding progress" table that can drift from reality,
 * the checklist is computed live from the same tables that already prove
 * each step happened (a subscription row, an API key row, etc). This can
 * never show a step as "done" when the underlying thing doesn't actually
 * exist, and needs no separate write path to keep in sync.
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, subscriptionsTable, apiKeysTable, eaBuildsTable, eaRegistrationsTable, usersTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logAudit } from "../lib/auditLog";

const router = Router();

const STEPS = [
  { key: "account_verified", title: "Verify your account", guide: "/knowledge-base" },
  { key: "subscription_active", title: "Choose a plan and complete payment", guide: "/subscriptions" },
  { key: "api_key_created", title: "Generate an API key", guide: "/api-keys" },
  { key: "ea_generated", title: "Generate your Expert Advisor (EA)", guide: "/ea-builds" },
  { key: "broker_connected", title: "Connect a broker account (register the EA on MT5)", guide: "/account" },
] as const;

router.get("/checklist", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) return res.status(404).json({ error: "Not found" });

    if (user.onboardingDismissedAt) {
      return res.json({ steps: [], completedCount: 0, totalCount: 0, percentComplete: 100, isComplete: true, dismissed: true });
    }

    const [activeSub] = await db.select().from(subscriptionsTable)
      .where(and(eq(subscriptionsTable.userId, userId), inArray(subscriptionsTable.status, ["active", "grace_period"])));

    const apiKeys = await db.select().from(apiKeysTable).where(eq(apiKeysTable.userId, userId));
    const activeApiKeyIds = apiKeys.filter((k) => k.status === "active").map((k) => k.id);

    const [eaBuild] = await db.select().from(eaBuildsTable).where(eq(eaBuildsTable.userId, userId));

    let brokerConnected = false;
    if (activeApiKeyIds.length > 0) {
      const registrations = await db.select().from(eaRegistrationsTable).where(inArray(eaRegistrationsTable.apiKeyId, activeApiKeyIds));
      brokerConnected = registrations.some((r) => r.isActive);
    }

    const completed: Record<string, boolean> = {
      account_verified: true, // presence of a users row implies Clerk-verified sign-up
      subscription_active: !!activeSub,
      api_key_created: activeApiKeyIds.length > 0,
      ea_generated: !!eaBuild,
      broker_connected: brokerConnected,
    };

    const steps = STEPS.map((s) => ({ ...s, completed: completed[s.key] }));
    const completedCount = steps.filter((s) => s.completed).length;

    return res.json({
      steps,
      completedCount,
      totalCount: steps.length,
      percentComplete: Math.round((completedCount / steps.length) * 100),
      isComplete: completedCount === steps.length,
    });
  } catch (err) {
    req.log.error(err, "Failed to compute onboarding checklist");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /onboarding/dismiss — user: hide the checklist widget without
// completing every step (e.g. an experienced user who doesn't need broker
// connectivity yet). Stored on the user row as a simple flag.
router.post("/dismiss", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    await db.update(usersTable).set({ onboardingDismissedAt: new Date() }).where(eq(usersTable.id, userId));
    void logAudit(userId, "onboarding.step_completed", "user", userId, { action: "dismissed" });
    return res.json({ dismissed: true });
  } catch (err) {
    req.log.error(err, "Failed to dismiss onboarding checklist");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
