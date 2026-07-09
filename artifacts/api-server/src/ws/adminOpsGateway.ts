import type { Server as HttpServer, IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { authenticateRequest, clerkClient } from "@clerk/express";
import { getUserRole } from "../middlewares/requireAdmin";
import { isStaffLevel } from "../lib/roles";
import { logger } from "../lib/logger";

/**
 * ─── Admin Ops WebSocket channel ────────────────────────────────────────
 *
 * Separate from the EA-facing gateway (`/ws/ea`) — this channel pushes
 * ops-relevant events (new alerts, incident changes, fleet state changes,
 * health snapshots, deployment events) to connected admin/staff browser
 * clients so ops pages can update live instead of polling.
 *
 * Connect: wss://<host>/api/ws/admin-ops (same-origin; authenticated via the
 * existing Clerk session cookie — no separate token or query param).
 *
 * Server -> client frames (JSON): { type: <OpsEventType>, data: <payload>, at: <ISO timestamp> }
 * Client -> server frames: { type: "ping" } -> { type: "pong" }
 *
 * This is a one-way event bus for the UI (merge-into-cache pattern on the
 * client); it never carries data required for correctness, so a dropped
 * frame or disconnected socket only means the UI falls back to its existing
 * polling behavior until it reconnects.
 */

export type OpsEventType =
  | "alert.new"
  | "incident.updated"
  | "security_incident.new"
  | "health.snapshot"
  | "deployment.event"
  | "fleet.connection_changed";

interface OpsClient {
  ws: WebSocket;
  isAlive: boolean;
}

const clients = new Set<OpsClient>();

export function attachAdminOpsGateway(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.pathname !== "/api/ws/admin-ops") return; // let other upgrade handlers (e.g. /ws/ea) deal with it

    authenticateAdminRequest(req)
      .then((allowed) => {
        if (!allowed) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
      })
      .catch((err) => {
        logger.error({ err }, "Admin ops WebSocket auth check failed");
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
      });
  });

  wss.on("connection", (ws) => {
    const client: OpsClient = { ws, isAlive: true };
    clients.add(client);

    ws.on("pong", () => {
      client.isAlive = true;
    });

    ws.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as { type?: string };
        if (message.type === "ping") {
          safeSend(ws, { type: "pong", at: new Date().toISOString() });
        }
      } catch {
        // Ignore malformed frames — this channel is server-push only.
      }
    });

    ws.on("close", () => {
      clients.delete(client);
    });

    ws.on("error", (err) => {
      logger.warn({ err }, "Admin ops WebSocket client error");
    });
  });

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.isAlive) {
        client.ws.terminate();
        clients.delete(client);
        continue;
      }
      client.isAlive = false;
      client.ws.ping();
    }
  }, 30_000);

  wss.on("close", () => clearInterval(heartbeat));

  logger.info("Admin ops WebSocket gateway attached at /api/ws/admin-ops");
  return wss;
}

async function authenticateAdminRequest(req: IncomingMessage): Promise<boolean> {
  const requestState = await authenticateRequest({
    clerkClient,
    // authenticateRequest accepts a raw Node IncomingMessage (it converts it
    // to a fetch Request internally) — not an Express Request.
    request: req as unknown as Parameters<typeof authenticateRequest>[0]["request"],
    options: {
      secretKey: process.env.CLERK_SECRET_KEY,
      publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    },
  });

  const auth = requestState.toAuth();
  const userId = auth?.userId;
  if (!userId) return false;

  const role = await getUserRole(userId);
  return !!role && isStaffLevel(role);
}

function safeSend(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

/** Broadcasts an ops event to every connected admin/staff client. Never throws — a broadcast failure must not break the underlying mutation it's attached to. */
export function broadcastOpsEvent(type: OpsEventType, data: unknown): void {
  try {
    const frame = JSON.stringify({ type, data, at: new Date().toISOString() });
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(frame);
        } catch (err) {
          logger.warn({ err, type }, "Failed to send admin ops event to a client");
        }
      }
    }
  } catch (err) {
    logger.warn({ err, type }, "Failed to broadcast admin ops event — payload likely not serializable");
  }
}
