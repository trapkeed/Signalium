import { Router } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db, usersTable, subscriptionsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { GetUserParams, UpdateUserParams, UpdateUserBody, UpdateMyUserBody } from "@workspace/api-zod";
import { requireAdmin, requireSuperAdmin, getUserRole } from "../middlewares/requireAdmin";
import { logAudit } from "../lib/auditLog";
import { canAssignRole, ROLE_LEVEL, type UserRole } from "../lib/roles";

const router = Router();

router.get("/", requireAdmin, async (req, res) => {
  try {
    const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));

    const usersWithSubs = await Promise.all(users.map(async (user) => {
      const [sub] = await db.select().from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, user.id))
        .orderBy(desc(subscriptionsTable.createdAt))
        .limit(1);
      return { ...user, subscriptionStatus: sub?.status ?? null };
    }));

    return res.json(usersWithSubs);
  } catch (err) {
    req.log.error(err, "Failed to list users");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/me", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) return res.status(404).json({ error: "Not found" });

    const [sub] = await db.select().from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, user.id))
      .orderBy(desc(subscriptionsTable.createdAt))
      .limit(1);

    return res.json({ ...user, subscriptionStatus: sub?.status ?? null });
  } catch (err) {
    req.log.error(err, "Failed to get own user profile");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/me", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const body = UpdateMyUserBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error });

  try {
    const [user] = await db.update(usersTable)
      .set({ ...body.data })
      .where(eq(usersTable.id, userId))
      .returning();
    if (!user) return res.status(404).json({ error: "Not found" });

    return res.json({ ...user, subscriptionStatus: null });
  } catch (err) {
    req.log.error(err, "Failed to update own user profile");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", requireAdmin, async (req, res) => {
  const parsed = GetUserParams.safeParse({ id: req.params.id });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, parsed.data.id));
    if (!user) return res.status(404).json({ error: "Not found" });

    const [sub] = await db.select().from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, user.id))
      .orderBy(desc(subscriptionsTable.createdAt))
      .limit(1);

    return res.json({ ...user, subscriptionStatus: sub?.status ?? null });
  } catch (err) {
    req.log.error(err, "Failed to get user");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", requireAdmin, async (req, res) => {
  const params = UpdateUserParams.safeParse({ id: req.params.id });
  const body = UpdateUserBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid request" });

  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });

  // Load actor + target roles upfront — needed for both role and isActive checks
  const actorRole = await getUserRole(actorUserId);
  if (!actorRole) return res.status(401).json({ error: "Unauthorized" });

  // Cannot mutate own account via this endpoint
  if (params.data.id === actorUserId) {
    return res.status(403).json({ error: "You cannot modify your own account through this endpoint" });
  }

  try {
    const [before] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
    if (!before) return res.status(404).json({ error: "Not found" });

    const targetRole = (before.role ?? "user") as UserRole;
    const actorLevel = ROLE_LEVEL[actorRole as UserRole] ?? 0;
    const targetLevel = ROLE_LEVEL[targetRole] ?? 0;

    // Any sensitive mutation (role OR isActive) requires actor to outrank target
    if (body.data.role !== undefined || body.data.isActive !== undefined) {
      if (actorLevel <= targetLevel) {
        return res.status(403).json({
          error: `You cannot modify a user with equal or higher role (${targetRole}). Requires strictly higher privilege.`,
        });
      }
    }

    // Role changes are super_admin only with strict hierarchy enforcement
    if (body.data.role !== undefined) {
      if (!canAssignRole(actorRole, body.data.role)) {
        if (ROLE_LEVEL[actorRole as UserRole] < ROLE_LEVEL.super_admin) {
          return res.status(403).json({ error: "Only super admins can assign roles" });
        }
        return res.status(403).json({
          error: `Cannot assign role '${body.data.role}' — target role must be below your own level`,
        });
      }
    }

    const [user] = await db.update(usersTable)
      .set({ ...body.data })
      .where(eq(usersTable.id, params.data.id))
      .returning();
    if (!user) return res.status(404).json({ error: "Not found" });

    if (body.data.role !== undefined && body.data.role !== before.role) {
      // Sync role to Clerk's publicMetadata. DB is the source of truth — if
      // Clerk sync fails we log a warning but do NOT roll back the DB change,
      // since the backend always re-reads from DB. A stale Clerk metadata
      // value only affects the frontend admin-nav guard (cosmetic, not a
      // security boundary). A future background reconciliation job can
      // re-sync any drift.
      try {
        await clerkClient.users.updateUserMetadata(params.data.id, {
          publicMetadata: { role: user.role },
        });
      } catch (clerkErr) {
        req.log.warn({ err: clerkErr, userId: params.data.id }, "Clerk publicMetadata sync failed — DB role is authoritative, frontend may need hard-refresh");
      }
      await logAudit(actorUserId, "user.role_changed", "user", user.id, { from: before.role, to: user.role });
    }
    if (body.data.isActive !== undefined && body.data.isActive !== before.isActive) {
      await logAudit(actorUserId, body.data.isActive ? "user.activated" : "user.deactivated", "user", user.id, {});
    }

    return res.json({ ...user, subscriptionStatus: null });
  } catch (err) {
    req.log.error(err, "Failed to update user");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
