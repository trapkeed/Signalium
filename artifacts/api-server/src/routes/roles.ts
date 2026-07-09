/**
 * S24C — Admin role management (SuperAdmin-only).
 *
 * Grants/revokes the seven fine-grained admin roles and lets a SuperAdmin
 * temporarily assume another role. This is deliberately separate from the
 * legacy `/users/:id/role` endpoint (usersRouter), which still governs the
 * coarse `user/clerk/staff/admin/super_admin` tier that gates admin-panel
 * access itself.
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { requireSuperAdmin } from "../middlewares/requireAdmin";
import { ADMIN_ROLE_NAMES, ADMIN_ROLE_LABELS, type AdminRoleName } from "../lib/roles";
import { grantAdminRole, revokeAdminRole, getGrantedAdminRoles, assumeRole, endActiveAssumption, getActiveAssumptionSummary } from "../lib/adminRoles";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.use(requireSuperAdmin);

function isValidAdminRole(role: unknown): role is AdminRoleName {
  return typeof role === "string" && ADMIN_ROLE_NAMES.includes(role as AdminRoleName);
}

router.get("/", async (_req, res) => {
  res.json({ roles: ADMIN_ROLE_NAMES.map((role) => ({ role, label: ADMIN_ROLE_LABELS[role] })) });
});

router.get("/users/:userId", async (req, res) => {
  const [user] = await db.select({ id: usersTable.id, email: usersTable.email, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.params.userId));
  if (!user) return res.status(404).json({ error: "User not found" });
  const [grantedRoles, assumption] = await Promise.all([
    getGrantedAdminRoles(user.id),
    getActiveAssumptionSummary(user.id),
  ]);
  return res.json({ user, grantedRoles, activeAssumption: assumption });
});

router.post("/users/:userId/grant", async (req, res) => {
  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });
  const { role } = req.body ?? {};
  if (!isValidAdminRole(role)) return res.status(400).json({ error: "Invalid role" });
  await grantAdminRole(actorUserId, req.params.userId, role);
  const grantedRoles = await getGrantedAdminRoles(req.params.userId);
  return res.json({ grantedRoles });
});

router.post("/users/:userId/revoke", async (req, res) => {
  const { userId: actorUserId } = getAuth(req);
  if (!actorUserId) return res.status(401).json({ error: "Unauthorized" });
  const { role } = req.body ?? {};
  if (!isValidAdminRole(role)) return res.status(400).json({ error: "Invalid role" });
  await revokeAdminRole(actorUserId, req.params.userId, role);
  const grantedRoles = await getGrantedAdminRoles(req.params.userId);
  return res.json({ grantedRoles });
});

// "may assume any role" — self-service for the acting SuperAdmin only, never targeting another user.
router.post("/assume", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { role } = req.body ?? {};
  if (!isValidAdminRole(role)) return res.status(400).json({ error: "Invalid role" });
  const { expiresAt } = await assumeRole(userId, role);
  return res.json({ role, expiresAt });
});

router.post("/assume/end", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  await endActiveAssumption(userId, userId);
  return res.json({ ok: true });
});

router.get("/assume/status", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const assumption = await getActiveAssumptionSummary(userId);
  return res.json({ activeAssumption: assumption });
});

export default router;
