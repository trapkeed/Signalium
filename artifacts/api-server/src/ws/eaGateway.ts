import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import crypto from "crypto";
import {
  db,
  eaConnectionsTable,
  positionTelemetryTable,
  trainerActionsTable,
  executionTelemetryTable,
  executionQualityMetricsTable,
  executionConfirmationsTable,
  brokerStateTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { resolveApiKeyAuth } from "../middlewares/requireApiKeyAuth";
import { decideAction, type TelemetrySnapshot, type TrainerActionType } from "../lib/qdeTrainer";
import { logger } from "../lib/logger";
import { checkApiAccess, checkAutonomousAccess, checkSymbolLimit } from "../lib/entitlementEngine";
import { ingestPositionSnapshot, emitTradeEvent } from "../lib/tradeLifecycle";
import { logAudit } from "../lib/auditLog";
import { broadcastOpsEvent } from "./adminOpsGateway";
import { isQdeActiveForUser } from "../lib/qdeSwitch";
import {
  syncPositions,
  parsePositionList,
  parseBrokerStatePayload,
  nextSequenceNum,
} from "../lib/positionSync";

/**
 * ─── EA <-> Platform <-> Trainer WebSocket contract ────────────────────────
 *
 * Connect:  wss://<host>/ws/ea?apiKey=<raw key>&hardwareId=<terminal id>
 *
 * EA -> Platform frames (every ~30s per open position, JSON):
 *   { "type": "telemetry", "requestId": "<uuid>", "data": {
 *       "symbol": "XAUUSD", "balance": 10250.5, "equity": 10190.2,
 *       "margin": 320.0, "freeMargin": 9870.2, "openPositions": 1,
 *       "floatingPnl": -60.3, "entryPrice": 2385.10, "currentPrice": 2381.5,
 *       "spread": 0.35, "swap": -1.2, "commission": -0.8, "drawdown": 2.1,
 *       "tradeAgeSeconds": 1800
 *   } }
 *
 *   { "type": "ping" }
 *
 *   // C8: Full position list sync (sent on connect and after every broker-side
 *   // change). Triggers open/modified/closed audit events for each ticket.
 *   { "type": "position_sync", "data": [
 *       { "brokerTicketId": "12345678", "symbol": "XAUUSD", "side": "buy",
 *         "lots": 0.1, "entryPrice": 2385.10, "currentPrice": 2381.5,
 *         "floatingPnl": -36.0, "swap": -1.2, "commission": -0.4,
 *         "tradeAgeSeconds": 1800, "openedAt": "2026-07-11T06:00:00Z",
 *         "mt5Magic": 20240101, "mt5Comment": "SignaliumEA" }
 *   ] }
 *
 *   // C8: Broker connection and account state (sent on connect, on reconnect,
 *   // and when connection status changes).
 *   { "type": "broker_state", "data": {
 *       "connectionStatus": "connected",
 *       "brokerType": "MT5",
 *       "brokerServer": "MetaQuotes-Demo",
 *       "accountNumber": "12345",
 *       "accountCurrency": "USD",
 *       "accountBalance": 10250.50,
 *       "accountEquity": 10190.20,
 *       "accountLeverage": 100,
 *       "pingMs": 45,
 *       "terminalBuild": "3815",
 *       "tradeAllowed": true,
 *       "expertEnabled": true
 *   } }
 *
 *   // EA acknowledges it received and will apply an action (observability).
 *   { "type": "ack", "actionId": 123 }
 *
 *   // C8: EA reports broker-level execution result (what the broker actually did).
 *   { "type": "confirm", "actionId": 123, "data": {
 *       "success": true,
 *       "brokerTicketId": "12345678",
 *       "executionDelayMs": 312,
 *       "actualPrice": 2381.40,
 *       "actualLots": 0.1,
 *       "slippage": 0.04
 *   } }
 *
 * Platform -> EA frames:
 *   { "type": "action", "actionId": 123, "sequenceNum": 7, "data": {
 *       "action": "TRAIL", "reasoning": "...", "symbol": "XAUUSD",
 *       "telemetryId": 456
 *   } }
 *
 *   { "type": "position_sync_ack", "syncedCount": 3, "newCount": 0,
 *     "modifiedCount": 0, "closedCount": 1 }
 *
 *   { "type": "broker_state_ack" }
 *
 *   { "type": "pong" }
 *   { "type": "error", "message": "..." }
 *
 * Offline handling: if the EA is disconnected when a trainer action is
 * produced, the action row stays in status "queued" in `trainer_actions` and
 * is flushed to the EA the moment it reconnects (or fetched via the HTTP
 * poll fallback at GET /api/qde/actions/pending).
 */

interface ConnectionState {
  ws: WebSocket;
  userId: string;
  apiKeyId: number;
  eaRegistrationId: number;
  connectionId: string;
  isAlive: boolean;
}

// eaRegistrationId -> live connection. Only one active socket per terminal;
// a fresh connection supersedes a stale one.
const activeConnections = new Map<number, ConnectionState>();

export function getActiveConnections() {
  return activeConnections;
}

export function attachEaGateway(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: "/ws/ea" });

  wss.on("connection", async (ws, req) => {
    // Pause the socket immediately so no frames are parsed/emitted while we
    // do async auth + bookkeeping below — otherwise an EA that sends its
    // first telemetry frame right after connecting can have it silently
    // dropped because no "message" listener is attached yet.
    ws.pause();

    const url = new URL(req.url ?? "", "http://localhost");
    const apiKey = url.searchParams.get("apiKey");
    const hardwareId = url.searchParams.get("hardwareId");

    if (!apiKey || !hardwareId) {
      safeSend(ws, { type: "error", code: "INVALID_API_KEY", message: "apiKey and hardwareId query params are required" });
      ws.close(4001, "INVALID_API_KEY");
      return;
    }

    const auth = await resolveApiKeyAuth(apiKey, hardwareId, req.socket.remoteAddress ?? undefined);
    if ("error" in auth) {
      safeSend(ws, { type: "error", code: auth.code, message: auth.error });
      ws.close(4001, auth.code);
      return;
    }

    const apiAccess = await checkApiAccess(auth.userId);
    if (!apiAccess.allowed) {
      safeSend(ws, { type: "error", code: apiAccess.code, message: apiAccess.message });
      ws.close(4003, apiAccess.code);
      return;
    }

    const connectionId = crypto.randomUUID();
    const state: ConnectionState = {
      ws,
      userId: auth.userId,
      apiKeyId: auth.apiKeyId,
      eaRegistrationId: auth.eaRegistrationId,
      connectionId,
      isAlive: true,
    };

    // Supersede any stale connection for this terminal.
    const existing = activeConnections.get(auth.eaRegistrationId);
    if (existing && existing.ws.readyState === WebSocket.OPEN) {
      existing.ws.close(4000, "Superseded by a new connection");
    }
    activeConnections.set(auth.eaRegistrationId, state);

    await db.insert(eaConnectionsTable).values({
      userId: auth.userId,
      apiKeyId: auth.apiKeyId,
      eaRegistrationId: auth.eaRegistrationId,
      connectionId,
      transport: "websocket",
      status: "connected",
    });

    logger.info({ eaRegistrationId: auth.eaRegistrationId, connectionId }, "EA WebSocket connected");
    broadcastOpsEvent("fleet.connection_changed", {
      eaRegistrationId: auth.eaRegistrationId,
      connectionId,
      status: "connected",
    });

    await flushQueuedActions(state);

    ws.on("pong", () => {
      state.isAlive = true;
    });

    ws.on("message", async (raw) => {
      state.isAlive = true;
      let message: { type?: string; requestId?: string; actionId?: number; data?: unknown };
      try {
        message = JSON.parse(raw.toString());
      } catch {
        safeSend(ws, { type: "error", message: "Malformed JSON frame" });
        return;
      }

      try {
        if (message.type === "ping") {
          safeSend(ws, { type: "pong" });
          return;
        }

        if (message.type === "ack" && typeof message.actionId === "number") {
          await acknowledgeAction(message.actionId, state.eaRegistrationId);
          return;
        }

        if (message.type === "telemetry") {
          await handleTelemetry(state, message.data);
          return;
        }

        // C8: Full position list sync.
        if (message.type === "position_sync") {
          await handlePositionSync(state, message.data);
          return;
        }

        // C8: Broker connection and account state.
        if (message.type === "broker_state") {
          await handleBrokerState(state, message.data);
          return;
        }

        // C8: Execution confirmation (EA reports what the broker actually did).
        if (message.type === "confirm" && typeof message.actionId === "number") {
          await handleConfirm(state, message.actionId, message.data);
          return;
        }

        safeSend(ws, { type: "error", message: `Unknown message type: ${String(message.type)}` });
      } catch (err) {
        logger.error({ err, eaRegistrationId: state.eaRegistrationId }, "Failed to process EA WebSocket message");
        safeSend(ws, { type: "error", message: "Internal error processing message" });
      }
    });

    ws.on("close", async () => {
      logger.info({ eaRegistrationId: auth.eaRegistrationId, connectionId }, "EA WebSocket disconnected");
      if (activeConnections.get(auth.eaRegistrationId)?.connectionId === connectionId) {
        activeConnections.delete(auth.eaRegistrationId);
      }
      await db.update(eaConnectionsTable)
        .set({ status: "disconnected", disconnectedAt: new Date() })
        .where(and(eq(eaConnectionsTable.connectionId, connectionId)));
      broadcastOpsEvent("fleet.connection_changed", {
        eaRegistrationId: auth.eaRegistrationId,
        connectionId,
        status: "disconnected",
      });
    });

    ws.on("error", (err) => {
      logger.error({ err, eaRegistrationId: auth.eaRegistrationId }, "EA WebSocket error");
    });

    // All listeners are attached — safe to let buffered/incoming frames flow.
    ws.resume();
  });

  // Heartbeat sweep: terminate sockets that missed the last ping (dead
  // connection detection independent of the app-level ping/pong messages).
  const interval = setInterval(() => {
    for (const [eaRegistrationId, state] of activeConnections.entries()) {
      if (!state.isAlive) {
        state.ws.terminate();
        activeConnections.delete(eaRegistrationId);
        continue;
      }
      state.isAlive = false;
      state.ws.ping();
    }
  }, 30_000);

  wss.on("close", () => clearInterval(interval));

  logger.info("EA WebSocket gateway attached at /ws/ea");
  return wss;
}

function safeSend(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

async function handleTelemetry(state: ConnectionState, data: unknown) {
  // Re-check API access on every inbound message, not just at connect time.
  const apiAccess = await checkApiAccess(state.userId);
  if (!apiAccess.allowed) {
    safeSend(state.ws, { type: "error", code: apiAccess.code, message: apiAccess.message });
    state.ws.close(4003, apiAccess.code);
    return;
  }

  const telemetry = parseTelemetryPayload(data);
  if (!telemetry) {
    safeSend(state.ws, { type: "error", message: "Invalid telemetry payload" });
    return;
  }

  const symbolCheck = await checkSymbolLimit(state.userId, telemetry.symbol);
  if (!symbolCheck.allowed) {
    safeSend(state.ws, { type: "error", code: symbolCheck.code, message: symbolCheck.message });
    return;
  }

  const [row] = await db.insert(positionTelemetryTable).values({
    userId: state.userId,
    apiKeyId: state.apiKeyId,
    eaRegistrationId: state.eaRegistrationId,
    symbol: telemetry.symbol ?? null,
    balance: telemetry.balance,
    equity: telemetry.equity,
    margin: telemetry.margin,
    freeMargin: telemetry.freeMargin,
    openPositions: telemetry.openPositions,
    floatingPnl: telemetry.floatingPnl,
    entryPrice: telemetry.entryPrice ?? null,
    currentPrice: telemetry.currentPrice ?? null,
    spread: telemetry.spread ?? null,
    swap: telemetry.swap ?? null,
    commission: telemetry.commission ?? null,
    drawdown: telemetry.drawdown ?? null,
    tradeAgeSeconds: telemetry.tradeAgeSeconds ?? null,
  }).returning();

  // S19: position snapshot on every polling cycle for open positions
  if (telemetry.openPositions > 0 && telemetry.symbol) {
    ingestPositionSnapshot({
      userId: state.userId,
      symbol: telemetry.symbol,
      opportunityId: null,
      telemetryId: row.id,
      profit: telemetry.floatingPnl,
      drawdown: telemetry.drawdown ?? null,
      swap: telemetry.swap ?? null,
      commission: telemetry.commission ?? null,
      equity: telemetry.equity,
      balance: telemetry.balance,
      margin: telemetry.margin,
      entryPrice: telemetry.entryPrice ?? null,
      currentPrice: telemetry.currentPrice ?? null,
      tradeAgeSeconds: telemetry.tradeAgeSeconds ?? null,
    }).catch((err: unknown) => logger.warn({ err }, "position snapshot ingest failed (non-fatal)"));
  }

  // S19: capture execution telemetry if the EA included an `execution` block
  const execData = extractExecutionPayload(data);
  if (execData && telemetry.symbol) {
    captureExecutionTelemetry(state.userId, telemetry.symbol, row.id, execData)
      .catch((err: unknown) => logger.warn({ err }, "execution telemetry capture failed (non-fatal)"));
  }

  await db.update(eaConnectionsTable)
    .set({ lastMessageAt: new Date(), messageCount: (await getMessageCount(state.connectionId)) + 1 })
    .where(eq(eaConnectionsTable.connectionId, state.connectionId));

  const autonomousAccess = await checkAutonomousAccess(state.userId);
  if (!autonomousAccess.allowed) {
    safeSend(state.ws, { type: "error", code: autonomousAccess.code, message: autonomousAccess.message });
    return;
  }

  // Per-user QDE start/stop switch: while stopped, this user simply receives
  // no QDE decisions — the shared trainer keeps running for everyone else,
  // and this is not surfaced as an error since it's a deliberate user choice.
  const qdeActive = await isQdeActiveForUser(state.userId);
  if (!qdeActive) {
    return;
  }

  let decision;
  try {
    decision = await decideAction(telemetry);
  } catch (err) {
    logger.error({ err, telemetryId: row.id }, "Trainer decision failed after retries");
    safeSend(state.ws, { type: "error", message: "Trainer unavailable — telemetry recorded, no action produced" });
    return;
  }

  // Insert with an atomically-computed per-EA sequence number (C8 ordering guarantee).
  const actionRow = await db.transaction(async (tx) => {
    const seqNum = await nextSequenceNum(tx, state.eaRegistrationId);
    const [inserted] = await tx.insert(trainerActionsTable).values({
      userId: state.userId,
      apiKeyId: state.apiKeyId,
      eaRegistrationId: state.eaRegistrationId,
      telemetryId: row.id,
      symbol: telemetry.symbol ?? null,
      action: decision.action,
      reasoning: decision.reasoning,
      sequenceNum: seqNum,
      status: "queued",
    }).returning();
    return inserted;
  });

  // Note: trade events require a known opportunityId (FK NOT NULL). The EA gateway
  // doesn't manage opportunities — those are created by inference-gateway. Events
  // for EA autonomous decisions are captured there via captureQdeDecision.

  // Audit only consequential model requests (see qde.ts HTTP fallback for the
  // same reasoning) — HOLD is the overwhelming majority of ticks.
  if (decision.action !== "HOLD") {
    await logAudit(state.userId, "model_request.action_issued", "trainer_action", String(actionRow.id), {
      action: decision.action,
      symbol: telemetry.symbol ?? null,
      eaRegistrationId: state.eaRegistrationId,
      sequenceNum: actionRow.sequenceNum,
    });
  }

  await deliverAction(actionRow.id);
}

// ─── C8: Position sync handler ───────────────────────────────────────────────
async function handlePositionSync(state: ConnectionState, data: unknown) {
  const positions = parsePositionList(Array.isArray(data) ? data : null);
  if (positions === null) {
    safeSend(state.ws, { type: "error", message: "Invalid position_sync payload — expected array of position objects" });
    return;
  }

  try {
    const result = await syncPositions(state.userId, state.eaRegistrationId, positions);
    safeSend(state.ws, { type: "position_sync_ack", ...result });
    logger.info({ eaRegistrationId: state.eaRegistrationId, ...result }, "Position sync processed");
  } catch (err) {
    logger.error({ err, eaRegistrationId: state.eaRegistrationId }, "Failed to process position sync");
    safeSend(state.ws, { type: "error", message: "Failed to process position sync" });
  }
}

// ─── C8: Broker state handler ────────────────────────────────────────────────
async function handleBrokerState(state: ConnectionState, data: unknown) {
  const payload = parseBrokerStatePayload(data);
  if (!payload) {
    safeSend(state.ws, { type: "error", message: "Invalid broker_state payload — connectionStatus is required" });
    return;
  }

  try {
    await db
      .insert(brokerStateTable)
      .values({
        userId: state.userId,
        eaRegistrationId: state.eaRegistrationId,
        brokerType: payload.brokerType,
        connectionStatus: payload.connectionStatus,
        brokerServer: payload.brokerServer ?? null,
        accountNumber: payload.accountNumber ?? null,
        accountCurrency: payload.accountCurrency ?? null,
        accountBalance: payload.accountBalance ?? null,
        accountEquity: payload.accountEquity ?? null,
        accountLeverage: payload.accountLeverage ?? null,
        accountMarginLevel: payload.accountMarginLevel ?? null,
        pingMs: payload.pingMs ?? null,
        terminalBuild: payload.terminalBuild ?? null,
        platformVersion: payload.platformVersion ?? null,
        tradeAllowed: payload.tradeAllowed ?? null,
        expertEnabled: payload.expertEnabled ?? null,
        errorMessage: payload.errorMessage ?? null,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [brokerStateTable.eaRegistrationId],
        set: {
          brokerType: payload.brokerType,
          connectionStatus: payload.connectionStatus,
          brokerServer: payload.brokerServer ?? null,
          accountNumber: payload.accountNumber ?? null,
          accountCurrency: payload.accountCurrency ?? null,
          accountBalance: payload.accountBalance ?? null,
          accountEquity: payload.accountEquity ?? null,
          accountLeverage: payload.accountLeverage ?? null,
          accountMarginLevel: payload.accountMarginLevel ?? null,
          pingMs: payload.pingMs ?? null,
          terminalBuild: payload.terminalBuild ?? null,
          platformVersion: payload.platformVersion ?? null,
          tradeAllowed: payload.tradeAllowed ?? null,
          expertEnabled: payload.expertEnabled ?? null,
          errorMessage: payload.errorMessage ?? null,
          syncedAt: new Date(),
        },
      });

    safeSend(state.ws, { type: "broker_state_ack" });
  } catch (err) {
    logger.error({ err, eaRegistrationId: state.eaRegistrationId }, "Failed to process broker state");
    safeSend(state.ws, { type: "error", message: "Failed to process broker state" });
  }
}

// ─── C8: Execution confirmation handler ─────────────────────────────────────
async function handleConfirm(state: ConnectionState, actionId: number, data: unknown) {
  const d = (data && typeof data === "object") ? data as Record<string, unknown> : {};
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const success = typeof d.success === "boolean" ? d.success : undefined;
  if (success === undefined) {
    safeSend(state.ws, { type: "error", message: "confirm frame: success (boolean) is required" });
    return;
  }

  try {
    const [action] = await db.select().from(trainerActionsTable).where(eq(trainerActionsTable.id, actionId));
    if (!action || action.eaRegistrationId !== state.eaRegistrationId) {
      safeSend(state.ws, { type: "error", message: `confirm: action ${actionId} not found` });
      return;
    }

    // Idempotency — ignore duplicate confirmations silently.
    const [existing] = await db.select().from(executionConfirmationsTable)
      .where(eq(executionConfirmationsTable.trainerActionId, actionId));
    if (existing) return;

    await db.insert(executionConfirmationsTable).values({
      userId: state.userId,
      eaRegistrationId: state.eaRegistrationId,
      trainerActionId: actionId,
      brokerTicketId: typeof d.brokerTicketId === "string" ? d.brokerTicketId : null,
      brokerType: (d.brokerType === "GENERIC" ? "GENERIC" : "MT5") as "MT5" | "GENERIC",
      executedAction: action.action as "HOLD" | "ADD" | "REDUCE" | "TRAIL" | "BREAKEVEN" | "LOCK_PROFIT" | "CLOSE",
      success,
      actualPrice: num(d.actualPrice) ?? null,
      actualLots: num(d.actualLots) ?? null,
      slippage: num(d.slippage) ?? null,
      executionDelayMs: typeof d.executionDelayMs === "number" ? d.executionDelayMs : null,
      errorCode: typeof d.errorCode === "string" ? d.errorCode : null,
      errorMessage: typeof d.errorMessage === "string" ? d.errorMessage : null,
    });

    await db.update(trainerActionsTable)
      .set({ status: "confirmed", confirmedAt: new Date(), acknowledgedAt: action.acknowledgedAt ?? new Date() })
      .where(eq(trainerActionsTable.id, actionId));

    if (action.action !== "HOLD") {
      await logAudit(state.userId, "model_request.action_confirmed", "trainer_action", String(actionId), {
        success,
        executedAction: action.action,
        brokerTicketId: typeof d.brokerTicketId === "string" ? d.brokerTicketId : null,
        eaRegistrationId: state.eaRegistrationId,
      });
    }
  } catch (err) {
    logger.error({ err, actionId, eaRegistrationId: state.eaRegistrationId }, "Failed to process execution confirmation");
    safeSend(state.ws, { type: "error", message: "Failed to record execution confirmation" });
  }
}

async function getMessageCount(connectionId: string): Promise<number> {
  const [conn] = await db.select().from(eaConnectionsTable).where(eq(eaConnectionsTable.connectionId, connectionId));
  return conn?.messageCount ?? 0;
}

/** Attempts immediate delivery of a queued action; leaves it queued if the EA is offline or the send fails. */
export async function deliverAction(actionId: number): Promise<boolean> {
  const [action] = await db.select().from(trainerActionsTable).where(eq(trainerActionsTable.id, actionId));
  if (!action || action.status !== "queued") return false;

  const state = activeConnections.get(action.eaRegistrationId);
  if (!state || state.ws.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {
    safeSend(state.ws, {
      type: "action",
      actionId: action.id,
      // C8: include sequence number so the EA can enforce ordering.
      sequenceNum: action.sequenceNum,
      data: {
        action: action.action as TrainerActionType,
        reasoning: action.reasoning,
        symbol: action.symbol,
        telemetryId: action.telemetryId,
      },
    });
    await db.update(trainerActionsTable)
      .set({ status: "delivered", deliveredAt: new Date() })
      .where(eq(trainerActionsTable.id, action.id));
    return true;
  } catch (err) {
    logger.error({ err, actionId: action.id }, "Failed to deliver trainer action over WebSocket");
    await db.update(trainerActionsTable)
      .set({ retryCount: action.retryCount + 1 })
      .where(eq(trainerActionsTable.id, action.id));
    return false;
  }
}

async function acknowledgeAction(actionId: number, eaRegistrationId: number) {
  const [action] = await db.select().from(trainerActionsTable).where(eq(trainerActionsTable.id, actionId));
  if (!action || action.eaRegistrationId !== eaRegistrationId) return;
  await db.update(trainerActionsTable)
    .set({ status: "acknowledged", acknowledgedAt: new Date() })
    .where(eq(trainerActionsTable.id, actionId));
}

async function flushQueuedActions(state: ConnectionState) {
  // Deliver in sequence_num order to honour ordering guarantees (C8).
  const queued = await db.select().from(trainerActionsTable)
    .where(and(eq(trainerActionsTable.eaRegistrationId, state.eaRegistrationId), eq(trainerActionsTable.status, "queued")))
    .orderBy(trainerActionsTable.sequenceNum, trainerActionsTable.createdAt);
  for (const action of queued) {
    await deliverAction(action.id);
  }
}

interface ExecutionPayload {
  requestedEntry?: number;
  actualEntry?: number;
  slippage?: number;
  spread?: number;
  commission?: number;
  executionDelayMs?: number;
  partialFill?: boolean;
  requotes?: number;
}

function extractExecutionPayload(data: unknown): ExecutionPayload | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!d.execution || typeof d.execution !== "object") return null;
  const e = d.execution as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    requestedEntry: num(e.requestedEntry),
    actualEntry: num(e.actualEntry),
    slippage: num(e.slippage),
    spread: num(e.spread),
    commission: num(e.commission),
    executionDelayMs: num(e.executionDelayMs),
    partialFill: typeof e.partialFill === "boolean" ? e.partialFill : false,
    requotes: typeof e.requotes === "number" ? e.requotes : 0,
  };
}

async function captureExecutionTelemetry(
  userId: string,
  symbol: string,
  telemetryId: number,
  exec: ExecutionPayload,
) {
  await db.insert(executionTelemetryTable).values({
    userId,
    symbol,
    telemetryId,
    requestedEntry: exec.requestedEntry ?? null,
    actualEntry: exec.actualEntry ?? null,
    slippage: exec.slippage ?? null,
    spread: exec.spread ?? null,
    commission: exec.commission ?? null,
    executionDelayMs: exec.executionDelayMs ?? null,
    partialFill: exec.partialFill ?? false,
    requotes: exec.requotes ?? 0,
  });

  // Upsert aggregated execution quality metrics for this symbol/session/volatility segment
  const session = detectSessionFromHour(new Date().getUTCHours());
  await db.insert(executionQualityMetricsTable).values({
    symbol,
    session,
    volatilityState: "UNKNOWN",
    // Initial insert: only use non-null values; null fields start at 0 to indicate no data yet
    avgSlippage: exec.slippage ?? 0,
    avgSpread: exec.spread ?? 0,
    avgCommission: exec.commission ?? 0,
    avgExecutionDelayMs: exec.executionDelayMs ?? 0,
    partialFillRate: exec.partialFill ? 1 : 0,
    requoteRate: exec.requotes ?? 0,
    sampleCount: 1,
  }).onConflictDoUpdate({
    target: [executionQualityMetricsTable.symbol, executionQualityMetricsTable.session, executionQualityMetricsTable.volatilityState],
    set: {
      // Null-aware running average: only fold in the new sample when the value is present.
      // CASE WHEN new_val IS NULL THEN keep existing ELSE running_avg formula END
      avgSlippage: exec.slippage != null
        ? sql`(${executionQualityMetricsTable.avgSlippage} * ${executionQualityMetricsTable.sampleCount} + ${exec.slippage}) / (${executionQualityMetricsTable.sampleCount} + 1)`
        : sql`${executionQualityMetricsTable.avgSlippage}`,
      avgSpread: exec.spread != null
        ? sql`(${executionQualityMetricsTable.avgSpread} * ${executionQualityMetricsTable.sampleCount} + ${exec.spread}) / (${executionQualityMetricsTable.sampleCount} + 1)`
        : sql`${executionQualityMetricsTable.avgSpread}`,
      avgCommission: exec.commission != null
        ? sql`(${executionQualityMetricsTable.avgCommission} * ${executionQualityMetricsTable.sampleCount} + ${exec.commission}) / (${executionQualityMetricsTable.sampleCount} + 1)`
        : sql`${executionQualityMetricsTable.avgCommission}`,
      avgExecutionDelayMs: exec.executionDelayMs != null
        ? sql`(${executionQualityMetricsTable.avgExecutionDelayMs} * ${executionQualityMetricsTable.sampleCount} + ${exec.executionDelayMs}) / (${executionQualityMetricsTable.sampleCount} + 1)`
        : sql`${executionQualityMetricsTable.avgExecutionDelayMs}`,
      partialFillRate: sql`(${executionQualityMetricsTable.partialFillRate} * ${executionQualityMetricsTable.sampleCount} + ${exec.partialFill ? 1 : 0}) / (${executionQualityMetricsTable.sampleCount} + 1)`,
      requoteRate: exec.requotes != null
        ? sql`(${executionQualityMetricsTable.requoteRate} * ${executionQualityMetricsTable.sampleCount} + ${exec.requotes}) / (${executionQualityMetricsTable.sampleCount} + 1)`
        : sql`${executionQualityMetricsTable.requoteRate}`,
      sampleCount: sql`${executionQualityMetricsTable.sampleCount} + 1`,
      updatedAt: new Date(),
    },
  });
}

function detectSessionFromHour(utcHour: number): string {
  if (utcHour >= 22 || utcHour < 8) return "ASIAN";
  if (utcHour >= 8 && utcHour < 12) return "LONDON";
  if (utcHour >= 12 && utcHour < 16) return "LONDON_NEW_YORK_OVERLAP";
  if (utcHour >= 16 && utcHour < 21) return "NEW_YORK";
  return "OFF_SESSION";
}

function parseTelemetryPayload(data: unknown): (TelemetrySnapshot & { symbol?: string }) | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

  const balance = num(d.balance);
  const equity = num(d.equity);
  const margin = num(d.margin);
  const freeMargin = num(d.freeMargin);
  const openPositions = num(d.openPositions);
  const floatingPnl = num(d.floatingPnl);

  if (balance === undefined || equity === undefined || margin === undefined || freeMargin === undefined || openPositions === undefined || floatingPnl === undefined) {
    return null;
  }

  return {
    symbol: typeof d.symbol === "string" ? d.symbol : undefined,
    balance,
    equity,
    margin,
    freeMargin,
    openPositions,
    floatingPnl,
    entryPrice: num(d.entryPrice) ?? null,
    currentPrice: num(d.currentPrice) ?? null,
    spread: num(d.spread) ?? null,
    swap: num(d.swap) ?? null,
    commission: num(d.commission) ?? null,
    drawdown: num(d.drawdown) ?? null,
    tradeAgeSeconds: num(d.tradeAgeSeconds) ?? null,
  };
}
