/**
 * S26 — Cross-instance broadcast via Postgres LISTEN/NOTIFY.
 *
 * Horizontal scaling readiness: `adminOpsGateway`/`eaGateway` hold WebSocket
 * connections in per-process memory, so a browser or EA connected to
 * instance A never sees an event produced on instance B. Introducing Redis
 * pub/sub purely for this would be new infra with nothing else to justify it
 * (see platformHealth.ts — no Redis anywhere in this stack). Postgres
 * LISTEN/NOTIFY gives us the same fan-out using the database we already
 * depend on, at the payload-size limits NOTIFY imposes (~8KB) — fine for
 * event *notifications*, not bulk data, which is exactly how these events
 * are already shaped (small JSON payloads describing "something changed").
 *
 * Every instance both publishes (NOTIFY) and subscribes (LISTEN) on the same
 * channel, then re-broadcasts to its own local WebSocket clients. A single
 * instance publishing to itself is a harmless local echo (broadcast is
 * idempotent for UI event streams).
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pg's PoolClient type isn't resolvable from this package; see note on `ensureListener` below.
type PoolClient = any;

const CHANNEL = "signalium_ops_events";

type Handler = (payload: { type: string; data: unknown; at: string; sourceInstanceId: string }) => void;

const instanceId = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const handlers = new Set<Handler>();

// LISTEN needs a single long-lived, dedicated connection (not the shared
// query pool) — a pooled connection could be handed back and reused for an
// unrelated query mid-listen. We borrow one client out of the existing
// @workspace/db pool for this instance's lifetime rather than opening a
// brand-new `pg` connection, so we don't need `pg` as a direct dependency
// here and stay on the exact same driver/version as the rest of the app.
let listenerClient: PoolClient | null = null;
let connecting = false;

async function ensureListener(): Promise<void> {
  if (listenerClient || connecting) return;
  connecting = true;
  try {
    const client = await pool.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    client.on("notification", (msg: { channel: string; payload?: string }) => {
      if (msg.channel !== CHANNEL || !msg.payload) return;
      try {
        const parsed = JSON.parse(msg.payload) as { type: string; data: unknown; at: string; sourceInstanceId: string };
        for (const handler of handlers) handler(parsed);
      } catch (err) {
        logger.warn({ err }, "pgBroadcast: failed to parse NOTIFY payload");
      }
    });
    client.on("error", (err: Error) => {
      logger.warn({ err }, "pgBroadcast: LISTEN connection error — releasing and reconnecting on next publish/subscribe");
      const stale = listenerClient;
      listenerClient = null;
      // Release the checked-out pool client on error. Pass the error so the
      // pool destroys this (possibly broken) connection rather than
      // returning it to the pool for reuse. Without this, a listener that
      // errors repeatedly slowly starves the shared connection pool.
      try {
        stale?.release(err);
      } catch {
        // already released/destroyed — nothing to do
      }
    });
    listenerClient = client;
    logger.info({ channel: CHANNEL, instanceId }, "pgBroadcast: LISTEN connection established");
  } catch (err) {
    logger.warn({ err }, "pgBroadcast: failed to establish LISTEN connection — cross-instance events degraded to local-only");
    listenerClient = null;
  } finally {
    connecting = false;
  }
}

/** Registers a local callback invoked for every event NOTIFY'd on the shared channel (including this instance's own). */
export function subscribe(handler: Handler): void {
  handlers.add(handler);
  ensureListener().catch(() => {});
}

/** Publishes an event to every instance (including this one, via the round trip through Postgres). Never throws — a broadcast failure must degrade to local-only delivery, not break the caller. */
export async function publish(type: string, data: unknown): Promise<void> {
  await ensureListener();
  const payload = JSON.stringify({ type, data, at: new Date().toISOString(), sourceInstanceId: instanceId });
  if (payload.length > 7800) {
    logger.warn({ type, size: payload.length }, "pgBroadcast: payload too large for NOTIFY (>7.8KB) — dropping cross-instance fan-out for this event");
    return;
  }
  try {
    // NOTIFY needs its own short-lived query — reuse the listener client if up, else best-effort skip.
    if (listenerClient) {
      await listenerClient.query(`NOTIFY ${CHANNEL}, ${literal(payload)}`);
    }
  } catch (err) {
    logger.warn({ err, type }, "pgBroadcast: publish failed — event stays local-only");
  }
}

function literal(value: string): string {
  // pg NOTIFY payload must be a SQL string literal; escape single quotes.
  return `'${value.replace(/'/g, "''")}'`;
}

export function getInstanceId(): string {
  return instanceId;
}
