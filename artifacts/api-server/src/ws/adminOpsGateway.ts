import type { Server as HttpServer, IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getUserRole } from "../middlewares/requireAdmin";
import { isStaffLevel } from "../lib/roles";
import { logger } from "../lib/logger";
import { publish as publishCrossInstance, subscribe as subscribeCrossInstance } from "../lib/pgBroadcast";

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

  // S26: relay events NOTIFY'd by any instance (including this one) to this
  // instance's own locally-connected clients — see pgBroadcast.ts. This is
  // what makes the admin ops event stream work correctly behind a load
  // balancer with more than one instance, without introducing Redis.
  subscribeCrossInstance(({ type, data }) => {
    deliverLocally(type as OpsEventType, data);
  });

  logger.info("Admin ops WebSocket gateway attached at /api/ws/admin-ops");
  return wss;
}

function extractSessionCookie(req: IncomingMessage): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "sid") return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

async function authenticateAdminRequest(req: IncomingMessage): Promise<boolean> {
  const token = extractSessionCookie(req);
  if (!token) return false;

  const crypto = await import("crypto");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.tokenHash, tokenHash));
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) return false;

  const role = await getUserRole(session.userId);
  return !!role && isStaffLevel(role);
}

function safeSend(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

/** Broadcasts an ops event to every connected admin/staff client — on THIS instance, plus (via Postgres NOTIFY) every other horizontally-scaled instance's clients. Never throws — a broadcast failure must not break the underlying mutation it's attached to. */
export function broadcastOpsEvent(type: OpsEventType, data: unknown): void {
  deliverLocally(type, data);
  publishCrossInstance(type, data).catch((err) => {
    logger.warn({ err, type }, "Failed to fan out admin ops event to other instances");
  });
}

function deliverLocally(type: OpsEventType, data: unknown): void {
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
