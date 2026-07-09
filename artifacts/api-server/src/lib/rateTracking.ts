/**
 * S23c — Lightweight in-memory sliding-window request-rate tracking for API
 * abuse / excessive EA request detection. Per-process, in-memory only (same
 * tradeoff as the S23b trainer-failure counters) — acceptable because this
 * is a single-instance deployment and the goal is "spot a spike", not an
 * exact distributed count. Restarting the process resets counters.
 */

const windows = new Map<string, number[]>();

/** Prunes and returns the number of events for `key` within `windowMs`, after recording a new one now. */
function recordAndCount(map: Map<string, number[]>, key: string, windowMs: number): number {
  const now = Date.now();
  const since = now - windowMs;
  const existing = (map.get(key) ?? []).filter((t) => t > since);
  existing.push(now);
  map.set(key, existing);
  return existing.length;
}

// Bound memory growth from unbounded distinct keys (e.g. many attacker IPs)
// by periodically dropping windows that have gone quiet.
function pruneStale(map: Map<string, number[]>, windowMs: number) {
  const since = Date.now() - windowMs;
  for (const [key, timestamps] of map) {
    if (timestamps.length === 0 || timestamps[timestamps.length - 1] < since) map.delete(key);
  }
}

const EA_REQUEST_WINDOW_MS = 60_000;
const EA_REQUEST_LIMIT = 20; // expected cadence is ~2/min (30s telemetry tick); 20/min is a generous abuse threshold

const API_ABUSE_WINDOW_MS = 60_000;
const API_ABUSE_LIMIT = 120; // per-IP across all api-key-protected endpoints

const FAILED_AUTH_WINDOW_MS = 5 * 60_000;
const FAILED_AUTH_LIMIT = 10; // per-IP invalid API key attempts within the window

let lastPrune = 0;
function maybePrune() {
  const now = Date.now();
  if (now - lastPrune < 5 * 60_000) return;
  lastPrune = now;
  pruneStale(windows, Math.max(EA_REQUEST_WINDOW_MS, API_ABUSE_WINDOW_MS, FAILED_AUTH_WINDOW_MS));
}

/** Returns true if this apiKeyId has exceeded the excessive-EA-request threshold for the current window. */
export function recordEaRequestAndCheckExcessive(apiKeyId: number): boolean {
  maybePrune();
  return recordAndCount(windows, `ea:${apiKeyId}`, EA_REQUEST_WINDOW_MS) > EA_REQUEST_LIMIT;
}

/** Returns true if this IP has exceeded the general API-abuse threshold for the current window. */
export function recordApiRequestAndCheckAbuse(ipAddress: string): boolean {
  maybePrune();
  return recordAndCount(windows, `ip:${ipAddress}`, API_ABUSE_WINDOW_MS) > API_ABUSE_LIMIT;
}

/** Returns true if this IP has exceeded the brute-force failed-auth threshold for the current window. */
export function recordFailedAuthAndCheckBruteForce(ipAddress: string): boolean {
  maybePrune();
  return recordAndCount(windows, `authfail:${ipAddress}`, FAILED_AUTH_WINDOW_MS) > FAILED_AUTH_LIMIT;
}
