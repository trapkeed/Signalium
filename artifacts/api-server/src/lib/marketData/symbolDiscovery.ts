/**
 * Broker symbol discovery — trainer canonical mapping round-trip.
 *
 * On EA install (and every 24h thereafter), the EA scans the broker's full
 * symbol list and posts the raw strings to POST /market-data/symbol-discovery.
 * For each raw alias we don't already have a fresh (< 24h) cached mapping
 * for, we ask signalium-trainer to resolve it to a canonical Signalium
 * symbol (trainer sees far more brokers than any single admin can hand-map).
 *
 * Mirrors the fallback pattern from qdeTrainer.ts / researchLab.ts:
 *   - trainer.url / QDE_TRAINER_SYMBOL_MAP_URL unset, unreachable, or non-2xx
 *     -> normalized into TrainerMappingUnavailableError, caller falls back to
 *        the local normalizer (exact/alias/suffix-strip) + admin regex rules.
 *   - No fabricated mappings are ever returned — an unresolved symbol stays
 *     unresolved rather than guessing.
 */
import { logger } from "../logger";
import { getServiceToken } from "../sso";
import { resolveManagedConfig } from "../secretsVault";

export class TrainerMappingUnavailableError extends Error {
  constructor(detail?: string) {
    super(detail ? `Trainer symbol mapping unavailable: ${detail}` : "Trainer symbol mapping unavailable");
    this.name = "TrainerMappingUnavailableError";
  }
}

async function getBaseUrl(): Promise<string | null> {
  return resolveManagedConfig("trainer.url", "QDE_TRAINER_SYMBOL_MAP_URL");
}

export async function isTrainerMappingConfigured(): Promise<boolean> {
  return !!(await getBaseUrl());
}

export interface TrainerAliasMappingRequest {
  brokerName: string | null;
  rawAliases: string[];
}

export interface TrainerAliasMapping {
  rawAlias: string;
  canonicalSymbol: string | null;
  confidence?: number | null;
}

/**
 * Sends a batch of raw broker symbol strings to the trainer and returns its
 * best-effort canonical mapping for each. Throws TrainerMappingUnavailableError
 * if the trainer is not configured or the call fails — callers must catch
 * this and fall back to the local normalizer/regex engine, never fabricate.
 */
export async function resolveAliasesViaTrainer(req: TrainerAliasMappingRequest): Promise<TrainerAliasMapping[]> {
  const baseUrl = await getBaseUrl();
  if (!baseUrl) {
    throw new TrainerMappingUnavailableError("Trainer URL is not configured (set trainer.url in Admin → Managed Secrets or QDE_TRAINER_SYMBOL_MAP_URL)");
  }
  const url = `${baseUrl.replace(/\/$/, "")}/symbol-mapping/resolve`;
  try {
    const serviceToken = await getServiceToken();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceToken}` },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      let bodyText = "";
      try { bodyText = await res.text(); } catch { /* ignore */ }
      logger.warn({ url, status: res.status }, "Trainer symbol mapping request returned non-2xx");
      throw new TrainerMappingUnavailableError(`trainer responded with ${res.status}${bodyText ? ` — ${bodyText.slice(0, 200)}` : ""}`);
    }
    const body = (await res.json()) as { mappings?: TrainerAliasMapping[] };
    return Array.isArray(body.mappings) ? body.mappings : [];
  } catch (err) {
    if (err instanceof TrainerMappingUnavailableError) throw err;
    logger.warn({ err, url }, "Trainer symbol mapping request failed");
    throw new TrainerMappingUnavailableError((err as Error).message);
  }
}
