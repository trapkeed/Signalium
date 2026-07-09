/**
 * S27 — Deployment Governance Visibility (admin gateway)
 *
 * A single read-only endpoint exposing institutional governance visibility
 * into the active QDE deployment: version, status, certification status,
 * health score, validation score, shadow testing status, deployment
 * history, and rollback history. Nothing else — no experiments, datasets,
 * feature engineering, training runs, deployment approvals, or research
 * findings (those remain behind research-lab.ts, gated to research roles).
 *
 * Visibility tiers:
 *   - SuperAdmin / Admin (legacy admin-level role) -> "full"
 *   - Founder (admin-role grant)                   -> "strategic" (bucketed/condensed)
 *   - Everyone else (including plain staff/clerk/user, and unauthenticated
 *     public requests)                             -> 403 / 401, no visibility
 */
import { Router } from "express";
import { getAuth } from "../lib/auth";
import { getUserRole } from "../middlewares/requireAdmin";
import { isStaffLevel, type UserRole } from "../lib/roles";
import { getEffectiveAdminRoles } from "../lib/adminRoles";
import { buildGovernanceSummary, type GovernanceTier } from "../lib/governance";

const router = Router();

async function resolveGovernanceTier(userId: string): Promise<GovernanceTier | null> {
  const legacyRole = await getUserRole(userId);
  if (!legacyRole || !isStaffLevel(legacyRole as UserRole)) return null;
  // Derive tier from *effective* admin roles, not the raw legacy role —
  // getEffectiveAdminRoles already folds in legacy-role implication AND
  // collapses to a single scoped role while a SuperAdmin/Admin has an
  // active role assumption in progress (e.g. assuming "founder" to preview
  // that experience). Checking the legacy role directly would grant "full"
  // even while the actor is deliberately viewing the platform as a Founder.
  const roles = await getEffectiveAdminRoles(userId);
  if (roles.includes("super_admin") || roles.includes("admin")) return "full";
  if (roles.includes("founder")) return "strategic";
  return null;
}

router.get("/overview", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const tier = await resolveGovernanceTier(userId);
    if (!tier) {
      return res.status(403).json({ error: "Deployment governance visibility requires Admin, Super Admin, or Founder access" });
    }

    const summary = await buildGovernanceSummary(tier);
    return res.json({ tier, ...summary });
  } catch (err) {
    req.log.error(err, "Failed to build governance summary");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
