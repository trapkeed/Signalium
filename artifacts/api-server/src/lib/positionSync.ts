/**
 * C8 Platform Integration — Position sync helpers
 *
 * Shared logic used by both the HTTP endpoint (POST /qde/positions/sync)
 * and the WebSocket handler (position_sync frame) so the synchronization
 * semantics are identical regardless of transport.
 *
 * Sync protocol:
 *   The EA sends its full current open position list. We:
 *     1. Upsert each position into `open_positions`.
 *     2. Write a `broker_tickets` audit event for each new or modified ticket.
 *     3. Detect tickets that were previously open but are absent from the
 *        incoming list — mark them closed and write a "closed" audit event.
 *
 * Broker-type extensibility:
 *   All tables carry a `brokerType` column ("MT5" | "GENERIC") so future
 *   adapters can store their own ticket-ID formats without schema changes.
 */

import {
  db,
  openPositionsTable,
  brokerTicketsTable,
  type InsertOpenPosition,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";

export interface IncomingPosition {
  brokerTicketId: string;
  brokerType?: "MT5" | "GENERIC";
  symbol: string;
  side: "buy" | "sell";
  lots: number;
  entryPrice: number;
  currentPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  swap?: number | null;
  commission?: number | null;
  floatingPnl?: number | null;
  tradeAgeSeconds?: number | null;
  openedAt?: string | null; // ISO-8601 from EA
  // MT5-specific optional fields
  mt5Magic?: number | null;
  mt5Comment?: string | null;
}

export interface SyncResult {
  syncedCount: number;
  newCount: number;
  modifiedCount: number;
  closedCount: number;
}

/**
 * Synchronise the full position list for a single EA registration.
 * Returns counts of new / modified / closed positions for observability.
 */
export async function syncPositions(
  userId: string,
  eaRegistrationId: number,
  incoming: IncomingPosition[],
): Promise<SyncResult> {
  const now = new Date();

  // Fetch currently "open" (not yet closed) positions for this EA.
  const existing = await db
    .select()
    .from(openPositionsTable)
    .where(
      and(
        eq(openPositionsTable.eaRegistrationId, eaRegistrationId),
        isNull(openPositionsTable.closedAt),
      ),
    );

  const existingMap = new Map(existing.map((p) => [p.brokerTicketId, p]));
  const incomingIds = new Set(incoming.map((p) => p.brokerTicketId));

  let newCount = 0;
  let modifiedCount = 0;

  // ── Upsert each incoming position ────────────────────────────────────────
  for (const pos of incoming) {
    const brokerType = pos.brokerType ?? "MT5";
    const prior = existingMap.get(pos.brokerTicketId);

    const values: InsertOpenPosition = {
      userId,
      eaRegistrationId,
      brokerTicketId: pos.brokerTicketId,
      brokerType,
      symbol: pos.symbol,
      side: pos.side,
      lots: pos.lots,
      entryPrice: pos.entryPrice,
      currentPrice: pos.currentPrice ?? null,
      stopLoss: pos.stopLoss ?? null,
      takeProfit: pos.takeProfit ?? null,
      swap: pos.swap ?? null,
      commission: pos.commission ?? null,
      floatingPnl: pos.floatingPnl ?? null,
      tradeAgeSeconds: pos.tradeAgeSeconds ?? null,
      mt5Magic: pos.mt5Magic ?? null,
      mt5Comment: pos.mt5Comment ?? null,
      openedAt: pos.openedAt ? new Date(pos.openedAt) : null,
    };

    await db
      .insert(openPositionsTable)
      .values({ ...values, syncedAt: now })
      .onConflictDoUpdate({
        target: [openPositionsTable.eaRegistrationId, openPositionsTable.brokerTicketId],
        set: {
          currentPrice: values.currentPrice,
          stopLoss: values.stopLoss,
          takeProfit: values.takeProfit,
          swap: values.swap,
          commission: values.commission,
          floatingPnl: values.floatingPnl,
          tradeAgeSeconds: values.tradeAgeSeconds,
          lots: values.lots,
          mt5Magic: values.mt5Magic,
          mt5Comment: values.mt5Comment,
          syncedAt: now,
        },
      });

    if (!prior) {
      // New ticket — write "opened" audit event.
      await db.insert(brokerTicketsTable).values({
        userId,
        eaRegistrationId,
        brokerTicketId: pos.brokerTicketId,
        brokerType,
        symbol: pos.symbol,
        side: pos.side,
        lots: pos.lots,
        entryPrice: pos.entryPrice,
        event: "opened",
        eventPrice: pos.entryPrice,
        eventLots: pos.lots,
        eventPnl: null,
      });
      newCount++;
    } else {
      // Existing ticket — write "modified" event if size or price changed.
      const lotsChanged = Math.abs(prior.lots - pos.lots) > 1e-8;
      const entryChanged = Math.abs(prior.entryPrice - pos.entryPrice) > 1e-8;
      if (lotsChanged || entryChanged) {
        await db.insert(brokerTicketsTable).values({
          userId,
          eaRegistrationId,
          brokerTicketId: pos.brokerTicketId,
          brokerType,
          symbol: pos.symbol,
          side: pos.side,
          lots: pos.lots,
          entryPrice: pos.entryPrice,
          event: "modified",
          eventPrice: pos.currentPrice ?? null,
          eventLots: pos.lots,
          eventPnl: pos.floatingPnl ?? null,
        });
        modifiedCount++;
      }
    }
  }

  // ── Detect closed positions ───────────────────────────────────────────────
  let closedCount = 0;
  const closedTickets = existing.filter((p) => !incomingIds.has(p.brokerTicketId));

  for (const closed of closedTickets) {
    await db
      .update(openPositionsTable)
      .set({ closedAt: now, syncedAt: now })
      .where(
        and(
          eq(openPositionsTable.eaRegistrationId, eaRegistrationId),
          eq(openPositionsTable.brokerTicketId, closed.brokerTicketId),
        ),
      );

    await db.insert(brokerTicketsTable).values({
      userId,
      eaRegistrationId,
      brokerTicketId: closed.brokerTicketId,
      brokerType: closed.brokerType as "MT5" | "GENERIC",
      symbol: closed.symbol,
      side: closed.side as "buy" | "sell",
      lots: closed.lots,
      entryPrice: closed.entryPrice,
      event: "closed",
      eventPrice: closed.currentPrice ?? null,
      eventLots: closed.lots,
      eventPnl: closed.floatingPnl ?? null,
    });
    closedCount++;
  }

  return {
    syncedCount: incoming.length,
    newCount,
    modifiedCount,
    closedCount,
  };
}

/**
 * Parse and validate an incoming position list from an EA frame.
 * Returns null if the payload is structurally invalid.
 */
export function parsePositionList(body: unknown): IncomingPosition[] | null {
  if (!Array.isArray(body)) return null;
  const positions: IncomingPosition[] = [];
  for (const item of body) {
    if (!item || typeof item !== "object") return null;
    const d = item as Record<string, unknown>;
    const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
    const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

    const brokerTicketId = str(d.brokerTicketId);
    const symbol = str(d.symbol);
    const side = d.side === "buy" || d.side === "sell" ? d.side : undefined;
    const lots = num(d.lots);
    const entryPrice = num(d.entryPrice);
    if (!brokerTicketId || !symbol || !side || lots === undefined || entryPrice === undefined) {
      return null;
    }

    const rawBrokerType = d.brokerType;
    const brokerType: "MT5" | "GENERIC" =
      rawBrokerType === "GENERIC" ? "GENERIC" : "MT5";

    positions.push({
      brokerTicketId,
      brokerType,
      symbol,
      side,
      lots,
      entryPrice,
      currentPrice: num(d.currentPrice) ?? null,
      stopLoss: num(d.stopLoss) ?? null,
      takeProfit: num(d.takeProfit) ?? null,
      swap: num(d.swap) ?? null,
      commission: num(d.commission) ?? null,
      floatingPnl: num(d.floatingPnl) ?? null,
      tradeAgeSeconds: typeof d.tradeAgeSeconds === "number" ? d.tradeAgeSeconds : null,
      openedAt: typeof d.openedAt === "string" ? d.openedAt : null,
      mt5Magic: num(d.mt5Magic) ?? null,
      mt5Comment: str(d.mt5Comment) ?? null,
    });
  }
  return positions;
}

/**
 * Parse and validate a broker-state payload.
 * Returns null if required fields are missing or invalid.
 */
export interface BrokerStatePayload {
  brokerType: "MT5" | "GENERIC";
  connectionStatus: "connected" | "disconnected" | "error";
  brokerServer?: string | null;
  accountNumber?: string | null;
  accountCurrency?: string | null;
  accountBalance?: number | null;
  accountEquity?: number | null;
  accountLeverage?: number | null;
  accountMarginLevel?: number | null;
  pingMs?: number | null;
  terminalBuild?: string | null;
  platformVersion?: string | null;
  tradeAllowed?: boolean | null;
  expertEnabled?: boolean | null;
  errorMessage?: string | null;
}

export function parseBrokerStatePayload(body: unknown): BrokerStatePayload | null {
  if (!body || typeof body !== "object") return null;
  const d = body as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

  const rawStatus = d.connectionStatus;
  const connectionStatus =
    rawStatus === "connected" || rawStatus === "disconnected" || rawStatus === "error"
      ? rawStatus
      : undefined;
  if (!connectionStatus) return null;

  const rawBrokerType = d.brokerType;
  const brokerType: "MT5" | "GENERIC" =
    rawBrokerType === "GENERIC" ? "GENERIC" : "MT5";

  return {
    brokerType,
    connectionStatus,
    brokerServer: str(d.brokerServer) ?? null,
    accountNumber: str(d.accountNumber) ?? null,
    accountCurrency: str(d.accountCurrency) ?? null,
    accountBalance: num(d.accountBalance) ?? null,
    accountEquity: num(d.accountEquity) ?? null,
    accountLeverage: num(d.accountLeverage) ?? null,
    accountMarginLevel: num(d.accountMarginLevel) ?? null,
    pingMs: num(d.pingMs) ?? null,
    terminalBuild: str(d.terminalBuild) ?? null,
    platformVersion: str(d.platformVersion) ?? null,
    tradeAllowed: bool(d.tradeAllowed) ?? null,
    expertEnabled: bool(d.expertEnabled) ?? null,
    errorMessage: str(d.errorMessage) ?? null,
  };
}

/**
 * Atomically compute the next per-EA sequence number for a trainer action.
 * Must be called inside a DB transaction so the select + insert are atomic.
 */
export async function nextSequenceNum(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  eaRegistrationId: number,
): Promise<number> {
  const rows = await tx.execute<{ next: number }>(
    sql`SELECT COALESCE(MAX(sequence_num), 0) + 1 AS next
        FROM trainer_actions
        WHERE ea_registration_id = ${eaRegistrationId}`,
  );
  return Number(rows.rows[0]?.next ?? 1);
}
