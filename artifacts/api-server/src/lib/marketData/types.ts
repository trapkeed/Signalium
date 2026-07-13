/**
 * Common interface every market-data adapter implements, regardless of
 * upstream provider. Adding a new provider means writing a new adapter and
 * registering it in `registry.ts` — no admin UI or orchestration changes
 * needed (registry.ts is the only wiring point).
 */
export type MarketDataRole = "live" | "historical";

export interface HealthCheckResult {
  reachable: boolean;
  latencyMs: number | null;
  errorMessage: string | null;
}

/** Live price tick from a streaming or REST price source. */
export interface LivePrice {
  bid: number;
  ask: number;
  mid: number;
  timestamp: string;
}

export interface MarketDataAdapter {
  /** Must match the `slug` of the corresponding `data_providers` row. */
  slug: string;
  /** Human-readable name, used only for logging/diagnostics. */
  name: string;
  /**
   * Whether this adapter has everything it needs to make real calls (e.g. an
   * API key resolved from the vault/env). Placeholder adapters always return
   * false so they surface as "not connected" rather than silently failing.
   */
  isConfigured(): Promise<boolean>;
  /** Lightweight reachability probe used by the periodic health sweep. */
  checkHealth(): Promise<HealthCheckResult>;
  /**
   * Optional: return the latest cached price for the given instrument.
   * Instrument format should match the provider's native format (e.g.
   * "EUR_USD" for OANDA). Returns null if no cached price is available.
   */
  fetchPrice?(instrument: string): Promise<LivePrice | null>;
}
