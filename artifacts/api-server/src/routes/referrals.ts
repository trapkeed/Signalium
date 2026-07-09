import { Router } from "express";
import { getAuth } from "../lib/auth";
import { db, usersTable, referralsTable } from "@workspace/db";
import { eq, desc, count, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

// GET /referrals/me — current user's referral code + their referral activity.
router.get("/me", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) return res.status(404).json({ error: "Not found" });

    const referred = await db
      .select({
        id: referralsTable.id,
        referredUserId: referralsTable.referredUserId,
        createdAt: referralsTable.createdAt,
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
      })
      .from(referralsTable)
      .innerJoin(usersTable, eq(referralsTable.referredUserId, usersTable.id))
      .where(eq(referralsTable.referrerUserId, userId))
      .orderBy(desc(referralsTable.createdAt));

    return res.json({ referralCode: user.referralCode, referralCount: referred.length, referrals: referred });
  } catch (err) {
    req.log.error(err, "Failed to fetch referral summary");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /referrals/admin — platform-wide referral activity (admin).
router.get("/admin", requireAdmin, async (req, res) => {
  try {
    const referrerUsers = db.select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
    }).from(usersTable).as("referrer_users");
    const referredUsers = db.select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
    }).from(usersTable).as("referred_users");

    const rows = await db
      .select({
        id: referralsTable.id,
        referralCode: referralsTable.referralCode,
        createdAt: referralsTable.createdAt,
        referrerUserId: referralsTable.referrerUserId,
        referredUserId: referralsTable.referredUserId,
        referrerEmail: referrerUsers.email,
        referrerFirstName: referrerUsers.firstName,
        referrerLastName: referrerUsers.lastName,
        referredEmail: referredUsers.email,
        referredFirstName: referredUsers.firstName,
        referredLastName: referredUsers.lastName,
      })
      .from(referralsTable)
      .innerJoin(referrerUsers, eq(referralsTable.referrerUserId, referrerUsers.id))
      .innerJoin(referredUsers, eq(referralsTable.referredUserId, referredUsers.id))
      .orderBy(desc(referralsTable.createdAt));

    return res.json(rows);
  } catch (err) {
    req.log.error(err, "Failed to fetch platform-wide referral activity");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /referrals/admin/leaderboard — top referrers (admin).
router.get("/admin/leaderboard", requireAdmin, async (req, res) => {
  try {
    const rows = await db
      .select({
        userId: referralsTable.referrerUserId,
        referralCount: count(referralsTable.id),
      })
      .from(referralsTable)
      .groupBy(referralsTable.referrerUserId)
      .orderBy(desc(count(referralsTable.id)));

    const userIds = rows.map((r) => r.userId);
    const users = userIds.length > 0
      ? await db.select().from(usersTable).where(inArray(usersTable.id, userIds))
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return res.json(rows.map((r) => ({
      userId: r.userId,
      referralCount: r.referralCount,
      email: userMap.get(r.userId)?.email ?? null,
      firstName: userMap.get(r.userId)?.firstName ?? null,
      lastName: userMap.get(r.userId)?.lastName ?? null,
    })));
  } catch (err) {
    req.log.error(err, "Failed to fetch referral leaderboard");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
