/**
 * Concrete market-data adapters. OANDA (live, streaming) and Tiingo (historical)
 * are real implementations; everything else is a placeholder satisfying the
 * same interface so it shows up in the registry as "not connected" until a
 * real adapter is written for it.
 *
 * API keys are always resolved vault-first / env-fallback via
 * `resolveManagedConfig` — never hardcoded, never read from the generic
 * `provider_credentials` table (that table remains available for ad-hoc
 * provider config, but the two shipped adapters use the same vault pattern
 * as every other admin-configurable secret in this codebase).
 *
 * OANDA now also implements `fetchPrice()` which reads from the in-process
 * streaming cache (oandaStream.ts). The stream itself is started at server
 * boot in index.ts.
 */
import { resolveManagedConfig } from "../secretsVault";
import { oandaStream } from "./oandaStream";
import type { HealthCheckResult, LivePrice, MarketDataAdapter } from "./types";

const PROBE_TIMEOUT_MS = 5_000;

async function timedFetch(url: string, init: RequestInit): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const latencyMs = Date.now() - start;
    if (!resp.ok) {
      return { reachable: false, latencyMs, errorMessage: `HTTP ${resp.status}` };
    }
    return { reachable: true, latencyMs, errorMessage: null };
  } catch (err) {
    return {
      reachable: false,
      latencyMs: Date.now() - start,
      errorMessage: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

const oandaAdapter: MarketDataAdapter = {
  slug: "oanda",
  name: "OANDA",

  async isConfigured() {
    const [apiKey, accountId] = await Promise.all([
      resolveManagedConfig("market_data.oanda_api_key", "OANDA_API_KEY"),
      resolveManagedConfig("market_data.oanda_account_id", "OANDA_ACCOUNT_ID"),
    ]);
    return apiKey !== null && accountId !== null;
  },

  async checkHealth() {
    const apiKey = await resolveManagedConfig("market_data.oanda_api_key", "OANDA_API_KEY");
    if (!apiKey) {
      return { reachable: false, latencyMs: null, errorMessage: "No API key configured (market_data.oanda_api_key / OANDA_API_KEY)" };
    }
    const baseUrl =
      (await resolveManagedConfig("market_data.oanda_api_base_url", "OANDA_API_BASE_URL")) ??
      "https://api-fxpractice.oanda.com";
    // Lightweight authenticated ping — lists accounts, doesn't touch pricing/orders.
    return timedFetch(`${baseUrl}/v3/accounts`, { headers: { Authorization: `Bearer ${apiKey}` } });
  },

  async fetchPrice(instrument: string): Promise<LivePrice | null> {
    return oandaStream.getPrice(instrument);
  },
};

const tiingoAdapter: MarketDataAdapter = {
  slug: "tiingo",
  name: "Tiingo",
  async isConfigured() {
    return (await resolveManagedConfig("market_data.tiingo_api_key", "TIINGO_API_KEY")) !== null;
  },
  async checkHealth() {
    const apiKey = await resolveManagedConfig("market_data.tiingo_api_key", "TIINGO_API_KEY");
    if (!apiKey) return { reachable: false, latencyMs: null, errorMessage: "No API key configured (market_data.tiingo_api_key / TIINGO_API_KEY)" };
    // Tiingo's own low-cost status/utilities endpoint, authenticated via query token.
    return timedFetch(`https://api.tiingo.com/api/test/?token=${encodeURIComponent(apiKey)}`, {});
  },
};

/** Not-yet-implemented providers — visible in the registry so the admin UI can list them as "not connected" without any code change once a real adapter ships. */
function placeholderAdapter(slug: string, name: string): MarketDataAdapter {
  return {
    slug,
    name,
    async isConfigured() {
      return false;
    },
    async checkHealth() {
      return { reachable: false, latencyMs: null, errorMessage: "Adapter not yet implemented" };
    },
  };
}

export const MARKET_DATA_ADAPTERS: MarketDataAdapter[] = [
  oandaAdapter,
  tiingoAdapter,
  placeholderAdapter("polygon", "Polygon.io"),
  placeholderAdapter("twelvedata", "Twelve Data"),
  placeholderAdapter("finnhub", "Finnhub"),
  placeholderAdapter("alphavantage", "Alpha Vantage"),
  placeholderAdapter("dxfeed", "DXfeed"),
  placeholderAdapter("interactive_brokers", "Interactive Brokers"),
];
