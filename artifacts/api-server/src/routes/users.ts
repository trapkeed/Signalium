import { Router } from "express";
import { getAuth, hashPassword } from "../lib/auth";
import { db, usersTable, subscriptionsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import crypto from "crypto";
import { GetUserParams, UpdateUserParams, UpdateUserBody, UpdateMyUserBody, CreateUserBody } from "@workspace/api-zod";
import { requireAdmin, requireSuperAdmin, getUserRole } from "../middlewares/requireAdmin";
import { logAudit } from "../lib/auditLog";
import { logSubscriptionEvent } from "../lib/entitlementEngine";
import { canAssignRole, ROLE_LEVEL, type UserRole } from "../lib/roles";
import { adminActionApprovalsTable } from "@workspace/db";
import { and, eq as eqOp } from "drizzle-orm";

const SUBSCRIPTION_STATUSES = ["active", "grace_period", "suspended", "expired", "cancelled"] as const;

// S29 — maker-checker: escalating a user TO admin or super_admin requires a
// second, different super_admin to approve before it takes effect. Every
// other role assignment (demotions, staff, etc) applies immediately as
// before — this only gates the single highest-risk action (self-service
// privilege escalation via a compromised or malicious super_admin account).
const ESCALATION_ROLES: readonly UserRole[] = ["admin", "super_admin"];

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

// Create a new user (super_admin only) — provisions the local account
// directly (no Clerk) with an app-generated id and a hashed password.
router.post("/", requireSuperAdmin, async (req, res) => {
  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });

  const body = CreateUserBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error });

  const actorRole = await getUserRole(actorUserId);
  if (!actorRole) return res.status(401).json({ error: "Unauthorized" });

  const desiredRole = (body.data.role ?? "user") as UserRole;
  if (desiredRole !== "user" && !canAssignRole(actorRole, desiredRole)) {
    return res.status(403).json({ error: `Cannot create a user with role '${desiredRole}' — must be below your own level` });
  }

  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, body.data.email));
    if (existing) return res.status(409).json({ error: "A user with this email already exists" });

    const passwordHash = await hashPassword(body.data.password);
    const [user] = await db.insert(usersTable).values({
      email: body.data.email,
      passwordHash,
      emailVerified: true,
      firstName: body.data.firstName ?? null,
      lastName: body.data.lastName ?? null,
      role: desiredRole,
      isActive: true,
      referralCode: crypto.randomBytes(6).toString("hex"),
    }).returning();

    await logAudit(actorUserId, "user.created", "user", user.id, { email: user.email, role: desiredRole });

    return res.status(201).json({ ...user, subscriptionStatus: null });
  } catch (err) {
    req.log.error(err, "Failed to create user");
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

      // S29 — maker-checker gate for escalation to admin/super_admin.
      if (ESCALATION_ROLES.includes(body.data.role)) {
        const [existingApproval] = await db.select().from(adminActionApprovalsTable).where(
          and(eqOp(adminActionApprovalsTable.actionType, "role_escalation"), eqOp(adminActionApprovalsTable.targetId, params.data.id)),
        );

        if (existingApproval?.status === "approved" && (existingApproval.payload as { role?: string }).role === body.data.role) {
          // A different super_admin already approved this exact escalation — consume it and proceed.
          await db.delete(adminActionApprovalsTable).where(eqOp(adminActionApprovalsTable.id, existingApproval.id));
        } else {
          if (existingApproval) {
            await db.delete(adminActionApprovalsTable).where(eqOp(adminActionApprovalsTable.id, existingApproval.id));
          }
          const [approval] = await db.insert(adminActionApprovalsTable).values({
            actionType: "role_escalation",
            requestedBy: actorUserId,
            targetId: params.data.id,
            payload: { role: body.data.role },
          }).returning();
          await logAudit(actorUserId, "role_escalation.requested", "user", params.data.id, { role: body.data.role, approvalId: approval.id });
          return res.status(202).json({
            pendingApproval: true,
            approvalId: approval.id,
            message: `Escalating this user to '${body.data.role}' requires approval from a different super admin before it takes effect.`,
          });
        }
      }
    }

    const [user] = await db.update(usersTable)
      .set({ ...body.data })
      .where(eq(usersTable.id, params.data.id))
      .returning();
    if (!user) return res.status(404).json({ error: "Not found" });

    if (body.data.role !== undefined && body.data.role !== before.role) {
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

// Admin: change a user's current subscription status directly (e.g. force-suspend
// or reinstate) without needing the subscription id in the UI.
router.patch("/:id/subscription-status", requireAdmin, async (req, res) => {
  const params = GetUserParams.safeParse({ id: req.params.id });
  const rawStatus = req.body?.status;
  if (!params.success || typeof rawStatus !== "string" || !SUBSCRIPTION_STATUSES.includes(rawStatus as typeof SUBSCRIPTION_STATUSES[number])) {
    return res.status(400).json({ error: "Invalid request" });
  }
  const status = rawStatus as typeof SUBSCRIPTION_STATUSES[number];

  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [target] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
    if (!target) return res.status(404).json({ error: "Not found" });

    const [before] = await db.select().from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, params.data.id))
      .orderBy(desc(subscriptionsTable.createdAt))
      .limit(1);
    if (!before) return res.status(404).json({ error: "This user has no subscription to update" });

    const [sub] = await db.update(subscriptionsTable)
      .set({ status })
      .where(eq(subscriptionsTable.id, before.id))
      .returning();

    if (status !== before.status) {
      await logSubscriptionEvent(sub.id, sub.userId, "ADMIN_OVERRIDE", before.status, sub.status, { actorUserId, via: "user_admin_panel" });
      await logAudit(actorUserId, "subscription.overridden", "subscription", String(sub.id), {
        userId: sub.userId, before: before.status, after: sub.status,
      });
    }

    return res.json(sub);
  } catch (err) {
    req.log.error(err, "Failed to update user's subscription status");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Permanently delete a user (super_admin only, strict hierarchy enforced —
// same rule as role/isActive mutation above: actor must strictly outrank
// target, and cannot delete self).
router.delete("/:id", requireSuperAdmin, async (req, res) => {
  const params = GetUserParams.safeParse({ id: req.params.id });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });

  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });
  if (params.data.id === actorUserId) {
    return res.status(403).json({ error: "You cannot delete your own account through this endpoint" });
  }

  const actorRole = await getUserRole(actorUserId);
  if (!actorRole) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [target] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
    if (!target) return res.status(404).json({ error: "Not found" });

    const targetLevel = ROLE_LEVEL[(target.role ?? "user") as UserRole] ?? 0;
    const actorLevel = ROLE_LEVEL[actorRole as UserRole] ?? 0;
    if (actorLevel <= targetLevel) {
      return res.status(403).json({ error: `You cannot delete a user with equal or higher role (${target.role}). Requires strictly higher privilege.` });
    }

    await db.delete(usersTable).where(eq(usersTable.id, target.id));
    await logAudit(actorUserId, "user.deleted", "user", target.id, { email: target.email, role: target.role });

    return res.json({ success: true });
  } catch (err) {
    req.log.error(err, "Failed to delete user");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── S29 — role-escalation maker-checker approvals ─────────────────────────

router.get("/role-escalations/pending", requireSuperAdmin, async (req, res) => {
  try {
    const pending = await db.select().from(adminActionApprovalsTable)
      .where(and(eqOp(adminActionApprovalsTable.actionType, "role_escalation"), eqOp(adminActionApprovalsTable.status, "pending")));
    return res.json(pending);
  } catch (err) {
    req.log.error(err, "Failed to list pending role escalations");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/role-escalations/:approvalId/approve", requireSuperAdmin, async (req, res) => {
  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });
  const approvalId = Number(req.params.approvalId);
  if (isNaN(approvalId)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [approval] = await db.select().from(adminActionApprovalsTable).where(eqOp(adminActionApprovalsTable.id, approvalId));
    if (!approval || approval.status !== "pending") return res.status(404).json({ error: "No pending approval found" });
    if (approval.requestedBy === actorUserId) {
      return res.status(403).json({ error: "A different super admin must approve this — you cannot approve your own request" });
    }

    const [updated] = await db.update(adminActionApprovalsTable)
      .set({ status: "approved", approvedBy: actorUserId, resolvedAt: new Date() })
      .where(eqOp(adminActionApprovalsTable.id, approvalId))
      .returning();
    await logAudit(actorUserId, "role_escalation.approved", "user", approval.targetId, { approvalId, role: (approval.payload as { role?: string }).role });
    return res.json({ ...updated, note: "Approved. Re-submit the original role change to apply it now." });
  } catch (err) {
    req.log.error(err, "Failed to approve role escalation");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/role-escalations/:approvalId/reject", requireSuperAdmin, async (req, res) => {
  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });
  const approvalId = Number(req.params.approvalId);
  if (isNaN(approvalId)) return res.status(400).json({ error: "Invalid id" });

  try {
    const [approval] = await db.select().from(adminActionApprovalsTable).where(eqOp(adminActionApprovalsTable.id, approvalId));
    if (!approval || approval.status !== "pending") return res.status(404).json({ error: "No pending approval found" });

    const [updated] = await db.update(adminActionApprovalsTable)
      .set({ status: "rejected", approvedBy: actorUserId, resolvedAt: new Date() })
      .where(eqOp(adminActionApprovalsTable.id, approvalId))
      .returning();
    await logAudit(actorUserId, "role_escalation.rejected", "user", approval.targetId, { approvalId });
    return res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to reject role escalation");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
