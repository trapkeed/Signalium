import {
  db,
  subscriptionsTable,
  subscriptionEventsTable,
  plansTable,
  eaRegistrationsTable,
  apiKeysTable,
  positionTelemetryTable,
  userSymbolsTable,
  usersTable,
  type Subscription,
  type Plan,
  type SubscriptionEvent,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { isPrivilegedRole } from "./roles";

type DbOrTx = Pick<typeof db, "insert" | "select" | "update">;

/**
 * ─── EntitlementEngine ──────────────────────────────────────────────────────
 *
 * Single source of truth for "is this user allowed to do X right now?".
 * Every access decision in the platform (manual dashboard use, autonomous
 * trainer actions, EA generation, API key issuance, EA WebSocket/HTTP
 * polling, symbol/EA count limits, research access) MUST go through this
 * module instead of checking `plan.tier` or `subscription.status` directly
 * elsewhere. This keeps access rules config-driven (plan capability fields)
 * rather than hardcoded tier names scattered across routes.
 *
 * Subscription lifecycle:
 *   PENDING_PAYMENT -> ACTIVE -> GRACE_PERIOD -> EXPIRED
 *                         |            |
 *                         v            v
 *                    PAUSED/CANCELLED  (grace lapses without renewal)
 *   SUSPENDED is an out-of-band admin action (independent of the renewal
 *   calendar) that revokes entitlements immediately.
 *
 * Lifecycle transitions driven by calendar time (ACTIVE -> GRACE_PERIOD ->
 * EXPIRED) are applied lazily on read here, mirroring the pattern already
 * used for API key expiry (see requireApiKeyAuth.ts) rather than requiring a
 * background cron — the instant any code asks "what can this user do", the
 * subscription is brought up to date first.
 */

export const GRACE_PERIOD_DAYS = 7;

export type EntitlementDenialCode =
  | "SUBSCRIPTION_REQUIRED"
  | "SUBSCRIPTION_PENDING_PAYMENT"
  | "SUBSCRIPTION_EXPIRED"
  | "SUBSCRIPTION_SUSPENDED"
  | "SUBSCRIPTION_CANCELLED"
  | "SUBSCRIPTION_PAUSED"
  | "GRACE_PERIOD_AUTONOMOUS_DENIED"
  | "GRACE_PERIOD_API_DENIED"
  | "AUTONOMOUS_DISABLED"
  | "API_ACCESS_DISABLED"
  | "SYMBOL_LIMIT_REACHED"
  | "MAX_EAS_REACHED"
  | "INVALID_API_KEY";

export interface EntitlementDenial {
  allowed: false;
  code: EntitlementDenialCode;
  message: string;
}
export interface EntitlementGrant {
  allowed: true;
}
export type EntitlementResult = EntitlementGrant | EntitlementDenial;

export interface SubscriptionSnapshot {
  subscription: Subscription;
  plan: Plan;
}

function allow(): EntitlementGrant {
  return { allowed: true };
}

function deny(code: EntitlementDenialCode, message: string): EntitlementDenial {
  return { allowed: false, code, message };
}

async function logEvent(
  subscriptionId: number | null,
  userId: string,
  eventType: SubscriptionEvent["eventType"],
  fromStatus: string | null,
  toStatus: string | null,
  detail?: Record<string, unknown>,
  client: DbOrTx = db,
): Promise<void> {
  await client.insert(subscriptionEventsTable).values({ subscriptionId, userId, eventType, fromStatus, toStatus, detail });
}

/**
 * Applies any calendar-driven lifecycle transitions that are now due
 * (ACTIVE -> GRACE_PERIOD, GRACE_PERIOD -> EXPIRED) and returns the
 * up-to-date row. Idempotent — safe to call on every read.
 */
async function syncLifecycle(sub: Subscription): Promise<Subscription> {
  const now = Date.now();

  if (sub.status === "active" && sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() < now) {
    const graceEndsAt = new Date(sub.currentPeriodEnd.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    const [updated] = await db.update(subscriptionsTable)
      .set({ status: "grace_period", graceEndsAt })
      .where(eq(subscriptionsTable.id, sub.id))
      .returning();
    await logEvent(sub.id, sub.userId, "GRACE_STARTED", "active", "grace_period", {
      currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
      graceEndsAt: graceEndsAt.toISOString(),
    });
    logger.info({ subscriptionId: sub.id, userId: sub.userId }, "Subscription entered grace period");
    return syncLifecycle(updated);
  }

  if (sub.status === "grace_period" && sub.graceEndsAt && sub.graceEndsAt.getTime() < now) {
    const [updated] = await db.update(subscriptionsTable)
      .set({ status: "expired", endsAt: sub.graceEndsAt })
      .where(eq(subscriptionsTable.id, sub.id))
      .returning();
    await logEvent(sub.id, sub.userId, "SUBSCRIPTION_EXPIRED", "grace_period", "expired", {
      graceEndsAt: sub.graceEndsAt.toISOString(),
    });
    logger.info({ subscriptionId: sub.id, userId: sub.userId }, "Subscription expired after grace period");
    return updated;
  }

  return sub;
}

/** Resolves + lazily syncs the user's current (most recent) subscription and its plan. Null if the user has never subscribed. */
export async function resolveCurrentSubscription(userId: string): Promise<SubscriptionSnapshot | null> {
  const [latest] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId))
    .orderBy(desc(subscriptionsTable.createdAt))
    .limit(1);
  if (!latest) return null;

  const sub = await syncLifecycle(latest);
  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, sub.planId));
  if (!plan) return null;

  return { subscription: sub, plan };
}

/** Maps a non-accessible subscription status to its denial code + message. Returns null if the status itself doesn't block access (caller applies further checks). */
function statusDenial(status: Subscription["status"]): EntitlementDenial | null {
  switch (status) {
    case "pending_payment":
      return deny("SUBSCRIPTION_PENDING_PAYMENT", "Subscription payment has not been confirmed yet.");
    case "expired":
      return deny("SUBSCRIPTION_EXPIRED", "Subscription has expired. Renew to restore access.");
    case "suspended":
      return deny("SUBSCRIPTION_SUSPENDED", "Subscription has been suspended by an administrator.");
    case "cancelled":
      return deny("SUBSCRIPTION_CANCELLED", "Subscription has been cancelled.");
    case "paused":
      return deny("SUBSCRIPTION_PAUSED", "Subscription is paused.");
    case "active":
    case "grace_period":
      return null;
    default:
      return deny("SUBSCRIPTION_REQUIRED", "No valid subscription.");
  }
}

/**
 * Returns true when the user holds a privileged platform role (clerk, staff,
 * admin, super_admin) that grants blanket free access to all paid features.
 */
async function hasPrivilegedRole(userId: string): Promise<boolean> {
  const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  return !!user && isPrivilegedRole(user.role);
}

/** Manual dashboard/platform use — allowed through ACTIVE and GRACE_PERIOD, denied otherwise. */
export async function checkManualAccess(userId: string): Promise<EntitlementResult> {
  if (await hasPrivilegedRole(userId)) return allow();
  const snapshot = await resolveCurrentSubscription(userId);
  if (!snapshot) return deny("SUBSCRIPTION_REQUIRED", "An active subscription is required.");
  const denial = statusDenial(snapshot.subscription.status);
  if (denial) return denial;
  return allow();
}

/** Autonomous trainer actions — requires an ACTIVE subscription (not grace) AND the plan allowing autonomous mode. */
export async function checkAutonomousAccess(userId: string): Promise<EntitlementResult> {
  if (await hasPrivilegedRole(userId)) return allow();
  const snapshot = await resolveCurrentSubscription(userId);
  if (!snapshot) return deny("SUBSCRIPTION_REQUIRED", "An active subscription is required.");
  const { subscription, plan } = snapshot;

  const denial = statusDenial(subscription.status);
  if (denial) return denial;

  if (subscription.status === "grace_period") {
    return deny("GRACE_PERIOD_AUTONOMOUS_DENIED", "Autonomous trading is paused during the grace period. Renew to resume.");
  }
  if (!plan.autonomousAllowed) {
    return deny("AUTONOMOUS_DISABLED", "Autonomous trading is not included in the current plan.");
  }
  return allow();
}

/** API key issuance + EA WebSocket/HTTP polling — requires a truly ACTIVE subscription (grace period explicitly denies EA polling per spec) AND the plan allowing API access. */
export async function checkApiAccess(userId: string): Promise<EntitlementResult> {
  if (await hasPrivilegedRole(userId)) return allow();
  const snapshot = await resolveCurrentSubscription(userId);
  if (!snapshot) return deny("SUBSCRIPTION_REQUIRED", "An active subscription is required.");
  const { subscription, plan } = snapshot;

  const denial = statusDenial(subscription.status);
  if (denial) return denial;

  if (subscription.status === "grace_period") {
    return deny("GRACE_PERIOD_API_DENIED", "EA/API access is paused during the grace period. Renew to resume.");
  }
  if (!plan.apiAccessAllowed) {
    return deny("API_ACCESS_DISABLED", "API access is not included in the current plan.");
  }
  return allow();
}

/** EA build generation — same rule as manual access (available through grace, cut off once truly lapsed). */
export async function checkEaGenerationAccess(userId: string): Promise<EntitlementResult> {
  return checkManualAccess(userId);
}

/** Research/analytics surfaces — gated on plan.researchAccess in addition to base manual access. */
export async function checkResearchAccess(userId: string): Promise<EntitlementResult> {
  if (await hasPrivilegedRole(userId)) return allow();
  const snapshot = await resolveCurrentSubscription(userId);
  if (!snapshot) return deny("SUBSCRIPTION_REQUIRED", "An active subscription is required.");
  const denial = statusDenial(snapshot.subscription.status);
  if (denial) return denial;
  if (!snapshot.plan.researchAccess) {
    return deny("API_ACCESS_DISABLED", "Research & analytics access is not included in the current plan.");
  }
  return allow();
}

/** Checks whether the user can register one more active EA terminal under their plan's maxEas limit (null = unlimited). */
export async function checkMaxActiveEas(userId: string): Promise<EntitlementResult> {
  if (await hasPrivilegedRole(userId)) return allow();
  const snapshot = await resolveCurrentSubscription(userId);
  if (!snapshot) return deny("SUBSCRIPTION_REQUIRED", "An active subscription is required.");
  const denial = statusDenial(snapshot.subscription.status);
  if (denial) return denial;

  const { plan } = snapshot;
  if (plan.maxEas == null) return allow();

  const keys = await db.select({ id: apiKeysTable.id }).from(apiKeysTable).where(eq(apiKeysTable.userId, userId));
  if (keys.length === 0) return allow();

  const activeCount = await db
    .select({ id: eaRegistrationsTable.id })
    .from(eaRegistrationsTable)
    .where(and(inArray(eaRegistrationsTable.apiKeyId, keys.map((k) => k.id)), eq(eaRegistrationsTable.isActive, true)));

  if (activeCount.length >= plan.maxEas) {
    return deny("MAX_EAS_REACHED", `Plan allows at most ${plan.maxEas} active EA terminal(s).`);
  }
  return allow();
}

/** Checks whether adding `symbol` would exceed the plan's maxSymbols limit (null = unlimited), based on distinct symbols already seen for this user's recent telemetry. */
export async function checkSymbolLimit(userId: string, symbol: string | null | undefined): Promise<EntitlementResult> {
  if (await hasPrivilegedRole(userId)) return allow();
  const snapshot = await resolveCurrentSubscription(userId);
  if (!snapshot) return deny("SUBSCRIPTION_REQUIRED", "An active subscription is required.");
  const denial = statusDenial(snapshot.subscription.status);
  if (denial) return denial;

  const { plan } = snapshot;
  if (plan.maxSymbols == null || !symbol) return allow();

  const rows = await db
    .select({ symbol: positionTelemetryTable.symbol })
    .from(positionTelemetryTable)
    .where(eq(positionTelemetryTable.userId, userId));
  const distinctSymbols = new Set(rows.map((r) => r.symbol).filter((s): s is string => !!s));

  if (!distinctSymbols.has(symbol) && distinctSymbols.size >= plan.maxSymbols) {
    return deny("SYMBOL_LIMIT_REACHED", `Plan allows at most ${plan.maxSymbols} distinct symbol(s).`);
  }
  return allow();
}

/**
 * Checks whether the user can add one more symbol to their monitored set,
 * based on the count of rows in user_symbols (not telemetry-derived).
 * Used by POST /symbols/user before inserting.
 */
export async function checkUserSymbolLimit(userId: string): Promise<EntitlementResult> {
  if (await hasPrivilegedRole(userId)) return allow();
  const snapshot = await resolveCurrentSubscription(userId);
  if (!snapshot) return deny("SUBSCRIPTION_REQUIRED", "An active subscription is required.");
  const denial = statusDenial(snapshot.subscription.status);
  if (denial) return denial;

  const { plan } = snapshot;
  if (plan.maxSymbols == null) return allow();

  const rows = await db
    .select({ id: userSymbolsTable.id })
    .from(userSymbolsTable)
    .where(eq(userSymbolsTable.userId, userId));

  if (rows.length >= plan.maxSymbols) {
    return deny(
      "SYMBOL_LIMIT_REACHED",
      `Your plan allows at most ${plan.maxSymbols} monitored symbol(s). Remove one to add another.`,
    );
  }
  return allow();
}

/** Full entitlement summary for a user — resolved capabilities/limits, suitable for surfacing in account/billing UI and admin plan displays. */
export async function getEntitlementSummary(userId: string) {
  if (await hasPrivilegedRole(userId)) {
    return {
      status: "privileged" as const,
      manualAllowed: true,
      autonomousAllowed: true,
      eaGenerationAllowed: true,
      apiAccessAllowed: true,
      researchAccess: true,
      maxSymbols: null,
      maxActiveEas: null,
      graceEndsAt: null,
      planName: "Internal Access",
    };
  }
  const snapshot = await resolveCurrentSubscription(userId);
  if (!snapshot) {
    return {
      status: "none" as const,
      manualAllowed: false,
      autonomousAllowed: false,
      eaGenerationAllowed: false,
      apiAccessAllowed: false,
      researchAccess: false,
      maxSymbols: null,
      maxActiveEas: null,
      graceEndsAt: null,
      planName: null,
    };
  }

  const [manual, autonomous, api, research, eaGeneration] = await Promise.all([
    checkManualAccess(userId),
    checkAutonomousAccess(userId),
    checkApiAccess(userId),
    checkResearchAccess(userId),
    checkEaGenerationAccess(userId),
  ]);

  return {
    status: snapshot.subscription.status,
    manualAllowed: manual.allowed,
    autonomousAllowed: autonomous.allowed,
    eaGenerationAllowed: eaGeneration.allowed,
    apiAccessAllowed: api.allowed,
    researchAccess: research.allowed,
    maxSymbols: snapshot.plan.maxSymbols,
    maxActiveEas: snapshot.plan.maxEas,
    graceEndsAt: snapshot.subscription.graceEndsAt,
    planName: snapshot.plan.name,
  };
}

/** Records a lifecycle event without changing status — used for admin overrides that don't fit a dedicated transition helper. */
export async function recordAdminOverrideEvent(subscriptionId: number, userId: string, detail: Record<string, unknown>): Promise<void> {
  await logEvent(subscriptionId, userId, "ADMIN_OVERRIDE", null, null, detail);
}

export async function listSubscriptionEvents(subscriptionId: number) {
  return db
    .select()
    .from(subscriptionEventsTable)
    .where(eq(subscriptionEventsTable.subscriptionId, subscriptionId))
    .orderBy(desc(subscriptionEventsTable.createdAt));
}

export { logEvent as logSubscriptionEvent };
