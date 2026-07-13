/**
 * Custom (non-orval) hooks for the OANDA streaming status endpoint.
 * These are hand-written because the endpoint was added after the last
 * orval code-generation run.
 */
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

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
