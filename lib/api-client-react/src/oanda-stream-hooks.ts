/**
 * Custom (non-orval) hooks for OANDA-specific endpoints.
 * These are hand-written because the endpoints were added after the last
 * orval code-generation run.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ─── Stream Status ────────────────────────────────────────────────────────────

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

// ─── OANDA Config ─────────────────────────────────────────────────────────────

export interface OandaConfigField {
  key: string;
  label: string;
  description: string;
  configured: boolean;
  maskedValue: string | null;
  optional: boolean;
  defaultValue?: string;
}

export type OandaConfigStatus = OandaConfigField[];

export const getOandaConfigUrl = () => `/api/data-providers/oanda/config`;
export const getOandaConfigQueryKey = () => ["oanda-config"] as const;

export const getOandaConfig = (options?: RequestInit): Promise<OandaConfigStatus> =>
  customFetch<OandaConfigStatus>(getOandaConfigUrl(), { method: "GET", ...options });

export function useGetOandaConfig() {
  return useQuery({
    queryKey: getOandaConfigQueryKey(),
    queryFn: ({ signal }) => getOandaConfig({ signal }),
    staleTime: 30_000,
  });
}

export interface OandaConfigUpdate {
  fields: { key: string; value: string }[];
}

export const setOandaConfig = (data: OandaConfigUpdate, options?: RequestInit): Promise<{ saved: string[] }> =>
  customFetch<{ saved: string[] }>(getOandaConfigUrl(), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    ...options,
  });

export function useSetOandaConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: OandaConfigUpdate) => setOandaConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getOandaConfigQueryKey() });
      queryClient.invalidateQueries({ queryKey: getOandaStreamStatusQueryKey() });
    },
  });
}
