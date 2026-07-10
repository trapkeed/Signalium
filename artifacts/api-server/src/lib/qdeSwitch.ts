/**
 * Per-user QDE start/stop switch.
 *
 * Additive master on/off gate layered on top of `tradingMode`/`riskMode`:
 * it does not change how those work, it only controls whether *this* user
 * currently receives any QDE-driven decisions or analysis. Independent of
 * the shared QDE model/trainer process (which keeps running regardless)
 * and of every other user's switch.
 */
import { db, userTradingSettingsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logAudit } from "./auditLog";

export type QdeSwitchStatus = "stopped" | "initializing" | "running";

/** "initializing" counts as active — a user mid-warm-up should still show as on. */
export function isQdeStatusActive(status: QdeSwitchStatus): boolean {
  return status !== "stopped";
}

/** Fast per-request check used by enforcement points (telemetry loop, manual analysis). */
export async function isQdeActiveForUser(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ qdeStatus: userTradingSettingsTable.qdeStatus })
    .from(userTradingSettingsTable)
    .where(eq(userTradingSettingsTable.userId, userId));
  return isQdeStatusActive((row?.qdeStatus ?? "stopped") as QdeSwitchStatus);
}

async function setQdeStatus(userId: string, status: QdeSwitchStatus, requireCurrentStatus?: QdeSwitchStatus) {
  const [existing] = await db
    .select()
    .from(userTradingSettingsTable)
    .where(eq(userTradingSettingsTable.userId, userId));

  if (existing) {
    if (requireCurrentStatus && existing.qdeStatus !== requireCurrentStatus) {
      // Someone else (e.g. a stop request) changed the status since we
      // scheduled this transition — don't clobber their intent.
      return existing;
    }
    const [updated] = await db
      .update(userTradingSettingsTable)
      .set({ qdeStatus: status, qdeStatusUpdatedAt: new Date(), updatedAt: new Date() })
      .where(
        requireCurrentStatus
          ? and(
              eq(userTradingSettingsTable.userId, userId),
              eq(userTradingSettingsTable.qdeStatus, requireCurrentStatus),
            )
          : eq(userTradingSettingsTable.userId, userId),
      )
      .returning();
    return updated ?? existing;
  }
  if (requireCurrentStatus) {
    // Row didn't exist, so it can't already be in `requireCurrentStatus` —
    // nothing to transition.
    return undefined;
  }
  const [inserted] = await db
    .insert(userTradingSettingsTable)
    .values({ userId, qdeStatus: status, qdeStatusUpdatedAt: new Date() })
    .returning();
  return inserted;
}

/**
 * Starts the user's QDE switch: flips to "initializing" immediately, then
 * runs a lightweight background warm-up (simulating priming the user's
 * trading context/session — there is no separate per-user model process to
 * start, the shared QDE model is untouched) before flipping to "running".
 * Fire-and-forget on the warm-up step so the request returns immediately.
 */
export async function startQdeForUser(userId: string) {
  const result = await setQdeStatus(userId, "initializing");
  await logAudit(userId, "qde.switch_start_requested", "user", userId, {});

  setTimeout(() => {
    setQdeStatus(userId, "running", "initializing")
      .then(async (updated) => {
        // Only audit if we actually made the transition — if the user
        // stopped the switch during warm-up, `updated` reflects "stopped"
        // (or is undefined) and we must not claim it started running.
        if (updated?.qdeStatus === "running") {
          await logAudit(userId, "qde.switch_running", "user", userId, {});
        }
      })
      .catch(() => {
        // Best-effort — a failed warm-up flip shouldn't crash the process;
        // the user can re-check status or click start again.
      });
  }, 1500);

  return result;
}

/** Stops the user's QDE switch immediately — no background step needed. */
export async function stopQdeForUser(userId: string) {
  const result = await setQdeStatus(userId, "stopped");
  await logAudit(userId, "qde.switch_stopped", "user", userId, {});
  return result;
}
