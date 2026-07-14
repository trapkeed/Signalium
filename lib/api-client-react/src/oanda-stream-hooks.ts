/**
 * Custom (non-orval) hooks for market-data provider endpoints.
 * These are hand-written because the endpoints were added after the last
 * orval code-generation run.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ─── OANDA Stream Status ──────────────────────────────────────────────────────

export type OandaStreamState = "connected" | "reconnecting" | "disconnected" | "off";

export interface OandaStreamPrice {
  bid: number;
  ask: number;
  mid: number;
  timestamp: string;
}

export interface OandaStreamStatus {
  state: OandaStreamState;
  subscribedSymbols: string[];
  tickCount: number;
  lastHeartbeatAt: string | null;
  lastTickAt: string | null;
  prices: Record<string, OandaStreamPrice>;
  errorMessage: string | null;
}

export const getOandaStreamStatusUrl = () => `/api/data-providers/oanda/stream-status`;

export const getOandaStreamStatus = (options?: RequestInit): Promise<OandaStreamStatus> =>
  customFetch<OandaStreamStatus>(getOandaStreamStatusUrl(), { method: "GET", ...options });

export const getOandaStreamStatusQueryKey = () => ["oanda-stream-status"] as const;

export function useGetOandaStreamStatus(options?: {
  refetchInterval?: number;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: getOandaStreamStatusQueryKey(),
    queryFn: ({ signal }) => getOandaStreamStatus({ signal }),
    refetchInterval: options?.refetchInterval ?? 10_000,
    enabled: options?.enabled ?? true,
    staleTime: 5_000,
  });
}

// ─── Generic Provider Config ──────────────────────────────────────────────────

export interface ProviderConfigField {
  key: string;
  label: string;
  description: string;
  optional: boolean;
  sensitive: boolean;
  defaultValue: string | null;
  placeholder: string | null;
  configured: boolean;
  maskedValue: string | null;
}

export type ProviderConfigStatus = ProviderConfigField[];

export const getProviderConfigUrl = (slug: string) =>
  `/api/data-providers/${encodeURIComponent(slug)}/config`;

export const getProviderConfigQueryKey = (slug: string) =>
  ["provider-config", slug] as const;

export const getProviderConfig = (slug: string, options?: RequestInit): Promise<ProviderConfigStatus> =>
  customFetch<ProviderConfigStatus>(getProviderConfigUrl(slug), { method: "GET", ...options });

export function useGetProviderConfig(slug: string) {
  return useQuery({
    queryKey: getProviderConfigQueryKey(slug),
    queryFn: ({ signal }) => getProviderConfig(slug, { signal }),
    staleTime: 30_000,
    enabled: !!slug,
  });
}

export interface ProviderConfigUpdate {
  fields: { key: string; value: string }[];
}

export const setProviderConfig = (
  slug: string,
  data: ProviderConfigUpdate,
  options?: RequestInit,
): Promise<{ saved: string[] }> =>
  customFetch<{ saved: string[] }>(getProviderConfigUrl(slug), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    ...options,
  });

export function useSetProviderConfig(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ProviderConfigUpdate) => setProviderConfig(slug, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getProviderConfigQueryKey(slug) });
      // Also refresh stream status in case OANDA keys were updated
      queryClient.invalidateQueries({ queryKey: getOandaStreamStatusQueryKey() });
    },
  });
}

// ─── Backwards-compat aliases (OANDA-specific hooks now delegate to generic) ──

/** @deprecated Use useGetProviderConfig("oanda") */
export function useGetOandaConfig() {
  return useGetProviderConfig("oanda");
}

/** @deprecated Use useSetProviderConfig("oanda") */
export function useSetOandaConfig() {
  return useSetProviderConfig("oanda");
}
