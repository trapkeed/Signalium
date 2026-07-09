/**
 * S26 — Generic circuit breaker.
 *
 * Wraps a call to an unreliable dependency (trainer decision calls, broker
 * webhooks, research-lab proxy, etc). Distinct from `retryWithBackoff`
 * (retry.ts) — retry handles a single call's transient failure; the breaker
 * tracks failure *rate over time* for a dependency and, once it trips, stops
 * sending traffic to a dependency that is clearly down, so a struggling
 * downstream service doesn't get hammered by every inbound request while it's
 * trying to recover, and so callers fail fast instead of piling up open
 * connections/timeouts.
 *
 * States: closed (normal) -> open (fast-fail) -> half-open (single probe) -> closed|open.
 */
import { logger } from "./logger";

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  /** Consecutive failures before the breaker trips open. */
  failureThreshold?: number;
  /** How long the breaker stays open before allowing a single probe request. */
  resetTimeoutMs?: number;
  /** Per-call timeout — a call that hangs this long counts as a failure. */
  timeoutMs?: number;
  name?: string;
}

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker "${name}" is open — dependency considered unavailable`);
    this.name = "CircuitOpenError";
  }
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private lastError: string | null = null;
  private totalCalls = 0;
  private totalFailures = 0;
  /** True while a half-open probe call is in flight, so concurrent callers don't all get let through at once. */
  private probeInFlight = false;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly timeoutMs: number;
  readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.name = options.name ?? "unnamed";
  }

  getStatus() {
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      lastError: this.lastError,
      openedAt: this.openedAt ? new Date(this.openedAt).toISOString() : null,
    };
  }

  /** Runs `fn`, subject to the breaker's current state. `fallback`, if provided, is used for graceful degradation instead of throwing when the circuit is open or the call fails. */
  async execute<T>(fn: () => Promise<T>, fallback?: () => T | Promise<T>): Promise<T> {
    this.totalCalls++;

    if (this.state === "open") {
      const elapsed = Date.now() - (this.openedAt ?? 0);
      if (elapsed < this.resetTimeoutMs) {
        if (fallback) return fallback();
        throw new CircuitOpenError(this.name);
      }
      // Reset window elapsed — allow exactly one probe through (half-open).
      // Guard against a thundering herd of concurrent callers all seeing
      // `state === "open"` become false at once: only the caller that wins
      // the `probeInFlight` flag actually executes; everyone else is
      // treated as still-open until the probe resolves.
      if (this.probeInFlight) {
        if (fallback) return fallback();
        throw new CircuitOpenError(this.name);
      }
      this.state = "half_open";
      this.probeInFlight = true;
    }

    try {
      const result = await this.withTimeout(fn());
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      if (fallback) return fallback();
      throw err;
    } finally {
      this.probeInFlight = false;
    }
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Circuit breaker "${this.name}": call timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private onSuccess() {
    this.consecutiveFailures = 0;
    if (this.state !== "closed") {
      logger.info({ breaker: this.name }, "Circuit breaker recovered — closing");
    }
    this.state = "closed";
    this.openedAt = null;
  }

  private onFailure(err: unknown) {
    this.consecutiveFailures++;
    this.totalFailures++;
    this.lastError = err instanceof Error ? err.message : String(err);

    if (this.state === "half_open" || this.consecutiveFailures >= this.failureThreshold) {
      if (this.state !== "open") {
        logger.warn({ breaker: this.name, consecutiveFailures: this.consecutiveFailures }, "Circuit breaker tripped — opening");
      }
      this.state = "open";
      this.openedAt = Date.now();
    }
  }
}

// ─── Named registry — each external dependency gets one shared breaker ─────
const registry = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(name: string, options?: CircuitBreakerOptions): CircuitBreaker {
  let breaker = registry.get(name);
  if (!breaker) {
    breaker = new CircuitBreaker({ ...options, name });
    registry.set(name, breaker);
  }
  return breaker;
}

export function getAllCircuitBreakerStatuses() {
  return Array.from(registry.values()).map((b) => b.getStatus());
}
