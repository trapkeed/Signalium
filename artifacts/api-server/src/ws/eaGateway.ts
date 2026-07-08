import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import crypto from "crypto";
import { db, eaConnectionsTable, positionTelemetryTable, trainerActionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { resolveApiKeyAuth } from "../middlewares/requireApiKeyAuth";
import { decideAction, type TelemetrySnapshot, type TrainerActionType } from "../lib/qdeTrainer";
import { logger } from "../lib/logger";
import { checkApiAccess, checkAutonomousAccess, checkSymbolLimit } from "../lib/entitlementEngine";

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
 * Platform -> EA frames:
 *   { "type": "action", "actionId": 123, "data": {
 *       "action": "TRAIL", "reasoning": "...", "symbol": "XAUUSD",
 *       "telemetryId": 456
 *   } }
 *
 *   { "type": "pong" }
 *   { "type": "error", "message": "..." }
 *
 * EA -> Platform acknowledgement (closes the loop for observability):
 *   { "type": "ack", "actionId": 123 }
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

    const auth = await resolveApiKeyAuth(apiKey, hardwareId);
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
  // Re-check API access on every inbound message, not just at connect time —
  // a subscription can transition into grace/expired/suspended while a
  // socket is already open, and EA polling must stop immediately when that
  // happens rather than waiting for the next reconnect.
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

  await db.update(eaConnectionsTable)
    .set({ lastMessageAt: new Date(), messageCount: (await getMessageCount(state.connectionId)) + 1 })
    .where(eq(eaConnectionsTable.connectionId, state.connectionId));

  const autonomousAccess = await checkAutonomousAccess(state.userId);
  if (!autonomousAccess.allowed) {
    // Telemetry is still recorded above — only the autonomous decision step
    // is gated, since manual/telemetry visibility can remain available (e.g.
    // during grace period) even when autonomous trading is denied.
    safeSend(state.ws, { type: "error", code: autonomousAccess.code, message: autonomousAccess.message });
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

  const [actionRow] = await db.insert(trainerActionsTable).values({
    userId: state.userId,
    apiKeyId: state.apiKeyId,
    eaRegistrationId: state.eaRegistrationId,
    telemetryId: row.id,
    symbol: telemetry.symbol ?? null,
    action: decision.action,
    reasoning: decision.reasoning,
    status: "queued",
  }).returning();

  await deliverAction(actionRow.id);
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
  const queued = await db.select().from(trainerActionsTable)
    .where(and(eq(trainerActionsTable.eaRegistrationId, state.eaRegistrationId), eq(trainerActionsTable.status, "queued")));
  for (const action of queued) {
    await deliverAction(action.id);
  }
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
