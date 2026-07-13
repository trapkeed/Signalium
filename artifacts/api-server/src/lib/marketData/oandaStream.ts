/**
 * OANDA live price streaming worker.
 *
 * Opens a single persistent chunked-HTTP connection to OANDA's pricing stream
 * endpoint (`stream-fxpractice.oanda.com` for demo, `stream-fxtrade.oanda.com`
 * for live). OANDA sends newline-delimited JSON over the response body — each
 * line is either a PRICE tick or a HEARTBEAT.
 *
 * The worker:
 *  - Caches the latest bid/ask/mid per instrument in a Map (no DB writes —
 *    prices are ephemeral in-process state; the health-sweep persists the
 *    connectivity status to provider_status as before).
 *  - Reconnects automatically with exponential back-off (1 s → 30 s max).
 *  - Remains idle (state "off") if API key or account ID are not configured,
 *    so it is safe to start unconditionally at server boot.
 *
 * Access prices via `oandaStream.getPrice(instrument)` or the convenience
 * re-export `getOandaStreamPrice(instrument)`.
 *
 * Vault / env keys consumed:
 *   market_data.oanda_api_key     / OANDA_API_KEY
 *   market_data.oanda_account_id  / OANDA_ACCOUNT_ID
 *   market_data.oanda_stream_url  / OANDA_STREAM_URL  (default: stream-fxpractice)
 *   market_data.oanda_stream_symbols / OANDA_STREAM_SYMBOLS (comma-separated, default: EUR_USD,XAU_USD,GBP_USD)
 */

import { resolveManagedConfig } from "../secretsVault";
import { logger } from "../logger";
import type { LivePrice } from "./types";

export type OandaStreamState = "connected" | "reconnecting" | "disconnected" | "off";

export interface OandaStreamStatus {
  state: OandaStreamState;
  subscribedSymbols: string[];
  tickCount: number;
  lastHeartbeatAt: string | null;
  lastTickAt: string | null;
  /** Latest cached price per instrument. */
  prices: Record<string, LivePrice>;
  errorMessage: string | null;
}

class OandaStreamWorker {
  private _state: OandaStreamState = "off";
  private priceCache = new Map<string, LivePrice>();
  private tickCount = 0;
  private lastHeartbeatAt: string | null = null;
  private lastTickAt: string | null = null;
  private subscribedSymbols: string[] = [];
  private errorMessage: string | null = null;

  private abortController: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private backoffMs = 1_000;
  private readonly maxBackoffMs = 30_000;

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Start the stream worker. Safe to call multiple times — no-op if already running. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.connect().catch((err) => logger.warn({ err }, "OandaStream: initial connect failed"));
  }

  /** Gracefully stop the stream and cancel any pending reconnect. */
  stop(): void {
    this.running = false;
    this._state = "off";
    this.clearReconnect();
    this.abortController?.abort();
    this.abortController = null;
    logger.info("OandaStream: stopped");
  }

  /** Current stream health snapshot. Safe to call from any request handler. */
  getStatus(): OandaStreamStatus {
    const prices: Record<string, LivePrice> = {};
    for (const [k, v] of this.priceCache) prices[k] = v;
    return {
      state: this._state,
      subscribedSymbols: [...this.subscribedSymbols],
      tickCount: this.tickCount,
      lastHeartbeatAt: this.lastHeartbeatAt,
      lastTickAt: this.lastTickAt,
      prices,
      errorMessage: this.errorMessage,
    };
  }

  /**
   * Retrieve the latest cached price for an instrument.
   * Accepts both OANDA format (EUR_USD) and compact format (EURUSD).
   * Returns null if no price is cached yet.
   */
  getPrice(instrument: string): LivePrice | null {
    // Try exact match first, then normalise compact to underscore format
    return (
      this.priceCache.get(instrument) ??
      this.priceCache.get(instrument.replace("/", "_")) ??
      this.priceCache.get(instrument.replace(/^([A-Z]{3})([A-Z]{3})$/, "$1_$2")) ??
      null
    );
  }

  get state(): OandaStreamState {
    return this._state;
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    this._state = "reconnecting";
    this.clearReconnect();
    const jitter = Math.random() * 500;
    const delay = this.backoffMs + jitter;
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    logger.info({ delayMs: Math.round(delay) }, "OandaStream: scheduling reconnect");
    this.reconnectTimer = setTimeout(() => {
      if (this.running) {
        this.connect().catch((err) => logger.warn({ err }, "OandaStream: reconnect error"));
      }
    }, delay);
  }

  private async connect(): Promise<void> {
    if (!this.running) return;

    // Resolve all config values fresh on every connection attempt so that
    // vault changes (e.g. adding the account ID) take effect on reconnect
    // without a server restart.
    const [apiKey, accountId, rawStreamUrl, rawSymbols] = await Promise.all([
      resolveManagedConfig("market_data.oanda_api_key", "OANDA_API_KEY"),
      resolveManagedConfig("market_data.oanda_account_id", "OANDA_ACCOUNT_ID"),
      resolveManagedConfig("market_data.oanda_stream_url", "OANDA_STREAM_URL"),
      resolveManagedConfig("market_data.oanda_stream_symbols", "OANDA_STREAM_SYMBOLS"),
    ]);

    if (!apiKey || !accountId) {
      this._state = "off";
      this.errorMessage = "API key or account ID not configured — stream idle";
      logger.info("OandaStream: not configured, staying idle");
      this.running = false;
      return;
    }

    const streamUrl = (rawStreamUrl ?? "https://stream-fxpractice.oanda.com").replace(/\/$/, "");
    const symbolsStr = rawSymbols ?? "EUR_USD,XAU_USD,GBP_USD";
    this.subscribedSymbols = symbolsStr
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);

    const instrumentsParam = this.subscribedSymbols.join(",");
    const url = `${streamUrl}/v3/accounts/${accountId}/pricing/stream?instruments=${encodeURIComponent(instrumentsParam)}`;

    this.abortController = new AbortController();

    try {
      logger.info(
        { symbols: this.subscribedSymbols, streamBase: streamUrl },
        "OandaStream: opening connection",
      );

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
      }

      if (!response.body) {
        throw new Error("Response body is null — cannot stream");
      }

      // Successful connection: reset back-off and clear any previous error
      this._state = "connected";
      this.backoffMs = 1_000;
      this.errorMessage = null;
      logger.info({ symbols: this.subscribedSymbols }, "OandaStream: connected");

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (this.running) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // OANDA sends one JSON object per line
        const lines = buffer.split("\n");
        // The last element may be an incomplete line; keep it in the buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            this.handleChunk(JSON.parse(trimmed) as Record<string, unknown>);
          } catch {
            // Ignore malformed lines (shouldn't happen with OANDA's API)
          }
        }
      }

      reader.releaseLock();
    } catch (err: unknown) {
      if (!this.running) return; // intentional stop — don't reconnect
      const msg = err instanceof Error ? err.message : String(err);
      // AbortError is intentional; don't reconnect or log it as an error
      if (msg.toLowerCase().includes("abort")) return;
      this._state = "disconnected";
      this.errorMessage = msg;
      logger.warn({ err }, "OandaStream: connection error");
    }

    if (this.running) {
      this.scheduleReconnect();
    }
  }

  private handleChunk(chunk: Record<string, unknown>): void {
    if (chunk["type"] === "PRICE") {
      const instrument = String(chunk["instrument"] ?? "");
      if (!instrument) return;

      const asks = (chunk["asks"] as Array<{ price: string }> | undefined) ?? [];
      const bids = (chunk["bids"] as Array<{ price: string }> | undefined) ?? [];
      if (asks.length === 0 || bids.length === 0) return;

      const ask = parseFloat(asks[0].price);
      const bid = parseFloat(bids[0].price);
      if (isNaN(ask) || isNaN(bid)) return;

      const mid = (ask + bid) / 2;
      const timestamp = String(chunk["time"] ?? new Date().toISOString());

      this.priceCache.set(instrument, { bid, ask, mid, timestamp });
      this.tickCount++;
      this.lastTickAt = timestamp;
    } else if (chunk["type"] === "HEARTBEAT") {
      this.lastHeartbeatAt = String(chunk["time"] ?? new Date().toISOString());
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const oandaStream = new OandaStreamWorker();

/**
 * Convenience helper for the inference gateway and market source resolver.
 * Returns the latest cached bid/ask/mid for the instrument, or null.
 * Accepts compact (EURUSD), slash (EUR/USD), or underscore (EUR_USD) formats.
 */
export function getOandaStreamPrice(instrument: string): LivePrice | null {
  return oandaStream.getPrice(instrument);
}
