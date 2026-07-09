import { useEffect, useRef, useState, useCallback, createContext, useContext, type ReactNode, createElement } from "react";

/**
 * S23d — Admin ops realtime channel.
 *
 * A single shared WebSocket connection (one per browser tab) to the admin
 * ops gateway at `/api/ws/admin-ops`, authenticated via the existing Clerk
 * session cookie (same-origin, no token handling needed). Ops pages
 * subscribe via `useOpsRealtime` to merge live events into their own
 * react-query caches (usually by calling `invalidateQueries`). If the
 * socket is unavailable or drops, `connected` becomes false and pages
 * should keep relying on their existing polling/refetch behavior — this
 * channel is purely an optimization, never a correctness dependency.
 */

export type OpsEventType =
  | "alert.new"
  | "incident.updated"
  | "security_incident.new"
  | "health.snapshot"
  | "deployment.event"
  | "fleet.connection_changed";

export interface OpsEvent {
  type: OpsEventType;
  data: unknown;
  at: string;
}

type Listener = (event: OpsEvent) => void;

const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let refCount = 0;

const connectionListeners = new Set<(connected: boolean) => void>();
let lastConnected = false;

function setConnected(value: boolean) {
  if (lastConnected === value) return;
  lastConnected = value;
  for (const l of connectionListeners) l(value);
}

function wsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/ws/admin-ops`;
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  try {
    socket = new WebSocket(wsUrl());
  } catch {
    scheduleReconnect();
    return;
  }

  socket.addEventListener("open", () => {
    reconnectAttempt = 0;
    setConnected(true);
  });

  socket.addEventListener("message", (ev) => {
    let parsed: OpsEvent | { type?: string };
    try {
      parsed = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object" || parsed.type === "pong") return;
    for (const l of listeners) l(parsed as OpsEvent);
  });

  socket.addEventListener("close", () => {
    setConnected(false);
    socket = null;
    if (refCount > 0) scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    socket?.close();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(30_000, 1_000 * 2 ** reconnectAttempt);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (refCount > 0) connect();
  }, delay);
}

function acquire() {
  refCount += 1;
  connect();
}

function release() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && socket) {
    socket.close();
    socket = null;
  }
}

/**
 * Subscribes to admin ops events. Pass a stable handler (wrap in
 * `useCallback` if it closes over changing state) — every mounted
 * subscriber shares the same underlying socket connection.
 */
export function useOpsRealtime(onEvent: (event: OpsEvent) => void) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const [connected, setConnectedState] = useState(lastConnected);

  useEffect(() => {
    const listener: Listener = (event) => handlerRef.current(event);
    listeners.add(listener);
    connectionListeners.add(setConnectedState);
    acquire();
    setConnectedState(lastConnected);

    return () => {
      listeners.delete(listener);
      connectionListeners.delete(setConnectedState);
      release();
    };
  }, []);

  return { connected };
}

/** Convenience: subscribe to one or more specific event types only. */
export function useOpsRealtimeTypes(types: OpsEventType[], onEvent: (event: OpsEvent) => void) {
  const typesRef = useRef(types);
  typesRef.current = types;
  const handler = useCallback((event: OpsEvent) => {
    if (typesRef.current.includes(event.type)) onEvent(event);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onEvent]);
  return useOpsRealtime(handler);
}

// ─── Lightweight context for a single "Live" status badge in the ops shell ──

const OpsConnectionContext = createContext<boolean>(false);

export function OpsConnectionProvider({ children }: { children: ReactNode }) {
  const [connected, setConnectedState] = useState(lastConnected);
  useEffect(() => {
    connectionListeners.add(setConnectedState);
    acquire();
    setConnectedState(lastConnected);
    return () => {
      connectionListeners.delete(setConnectedState);
      release();
    };
  }, []);
  return createElement(OpsConnectionContext.Provider, { value: connected }, children);
}

export function useOpsConnectionStatus(): boolean {
  return useContext(OpsConnectionContext);
}
