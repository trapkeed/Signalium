import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, maintenanceBannerTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAudit } from "../lib/auditLog";

const router = Router();

async function getOrCreateBanner() {
  const [existing] = await db.select().from(maintenanceBannerTable).where(eq(maintenanceBannerTable.id, 1));
  if (existing) return existing;
  const [created] = await db
    .insert(maintenanceBannerTable)
    .values({ id: 1 })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [refetched] = await db.select().from(maintenanceBannerTable).where(eq(maintenanceBannerTable.id, 1));
  return refetched;
}

function isActiveNow(banner: { isEnabled: boolean; startsAt: Date | null; endsAt: Date | null }): boolean {
  if (!banner.isEnabled) return false;
  const now = Date.now();
  if (banner.startsAt && now < new Date(banner.startsAt).getTime()) return false;
  if (banner.endsAt && now > new Date(banner.endsAt).getTime()) return false;
  return true;
}

// GET /maintenance-banner — admin: full config
router.get("/", requireAdmin, async (req, res) => {
  try {
    const banner = await getOrCreateBanner();
    return res.json(banner);
  } catch (err) {
    req.log.error(err, "Failed to get maintenance banner");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /maintenance-banner — admin: update config
router.patch("/", requireAdmin, async (req, res) => {
  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });

  try {
    await getOrCreateBanner();
    const [banner] = await db
      .update(maintenanceBannerTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(maintenanceBannerTable.id, 1))
      .returning();

    await logAudit(actorUserId, "maintenance_banner.updated", "maintenance_banner", "1", {
      isEnabled: banner.isEnabled,
      message: banner.message,
    });

    return res.json(banner);
  } catch (err) {
    req.log.error(err, "Failed to update maintenance banner");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /maintenance-banner/active — public: returns the banner only if it is
// currently within its enabled/scheduled window, otherwise null. Public
// (not gated behind auth) since a maintenance notice may need to be shown
// even on the sign-in page.
router.get("/active", async (req, res) => {
  try {
    const banner = await getOrCreateBanner();
    if (!banner || !isActiveNow(banner)) return res.json(null);
    return res.json({ message: banner.message, startsAt: banner.startsAt, endsAt: banner.endsAt });
  } catch (err) {
    req.log.error(err, "Failed to get active maintenance banner");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
