import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { OpsShell } from "@/components/ops/ops-shell";
import { useOpsRealtimeTypes } from "@/hooks/use-ops-realtime";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOperationalHeartbeatStatus,
  useGetOperationalHeartbeatOffline,
  useGetOperationalTelemetry,
  useGetOperationalExecutionQuality,
  getGetOperationalTelemetryQueryKey,
  getGetOperationalHeartbeatStatusQueryKey,
  getGetOperationalExecutionQualityQueryKey,
} from "@workspace/api-client-react";
import {
  Wifi,
  WifiOff,
  Minus,
  Activity,
  Search,
  RefreshCw,
  Zap,
  TrendingDown,
  BarChart3,
  Shield,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

function timeAgo(v: string | null | undefined) {
  if (!v) return "never";
  try { return formatDistanceToNow(new Date(v), { addSuffix: true }); } catch { return v; }
}

type HbState = "ONLINE" | "DEGRADED" | "OFFLINE" | "UNAUTHORIZED" | "OUTDATED";

const STATE_META: Record<HbState, { label: string; color: string; icon: React.ElementType }> = {
  ONLINE:       { label: "Online",       color: "text-emerald-400", icon: Wifi },
  DEGRADED:     { label: "Degraded",     color: "text-yellow-400",  icon: Minus },
  OFFLINE:      { label: "Offline",      color: "text-red-400",     icon: WifiOff },
  UNAUTHORIZED: { label: "Unauthorized", color: "text-orange-400",  icon: Shield },
  OUTDATED:     { label: "Outdated",     color: "text-purple-400",  icon: Activity },
};

// ─── Heartbeat Monitor ────────────────────────────────────────────────────────

function HeartbeatMonitorTab() {
  const [filter, setFilter] = useState("");
  const { data, isLoading, refetch } = useGetOperationalHeartbeatStatus();

  const d = data as Record<string, unknown> | undefined;
  const instances = (d?.instances as Array<Record<string, unknown>>) ?? [];
  const summary = d?.summary as Record<string, number> | undefined;

  const filtered = instances.filter((inst) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      (inst.eaInstanceId as string)?.toLowerCase().includes(q) ||
      (inst.userId as string)?.toLowerCase().includes(q) ||
      (inst.brokerName as string)?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {(["ONLINE", "DEGRADED", "OFFLINE", "UNAUTHORIZED", "OUTDATED"] as HbState[]).map((s) => {
            const meta = STATE_META[s];
            const Icon = meta.icon;
            return (
              <div key={s} className="rounded-md border border-cyan-900/30 bg-background/50 p-3 text-center shadow-inner">
                <Icon className={`w-4 h-4 mx-auto mb-1.5 opacity-80 ${meta.color}`} />
                <div className={`text-xl font-mono font-bold ${meta.color}`}>{summary[s.toLowerCase()] ?? 0}</div>
                <div className="text-[10px] uppercase tracking-wider text-cyan-100/60 mt-0.5">{meta.label}</div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-500/50" />
          <Input
            className="pl-9 bg-background/50 border-cyan-900/30 text-cyan-50 placeholder:text-cyan-500/50 font-mono text-xs"
            placeholder="Filter by instance ID, user, or broker…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <Button size="sm" variant="outline" className="w-full sm:w-auto border-cyan-900/50 text-cyan-50 hover:bg-cyan-900/20" onClick={() => void refetch()}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 && (
          <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
            <CardContent className="py-10 text-center text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider">
              {instances.length === 0 ? "[ No EA instances registered yet ]" : "[ No instances match the filter ]"}
            </CardContent>
          </Card>
        )}
        {filtered.map((inst) => {
          const state = (inst.derivedState ?? inst.state) as HbState;
          const meta = STATE_META[state] ?? STATE_META.OFFLINE;
          const Icon = meta.icon;
          return (
            <Card key={inst.eaInstanceId as string} className={`border-cyan-900/40 bg-card/50 backdrop-blur ${state === "ONLINE" ? "border-emerald-900/30" : state === "OFFLINE" ? "border-red-900/30" : ""}`}>
              <CardContent className="py-3 px-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-1.5 rounded bg-background border border-current/20 ${meta.color} shrink-0`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-mono text-sm text-cyan-50 truncate">{inst.eaInstanceId as string}</div>
                      <div className="text-[11px] font-mono text-cyan-500/70 uppercase tracking-wider mt-0.5">
                        {inst.brokerName as string ?? "Unknown broker"} <span className="opacity-50">/</span> v{inst.eaVersion as string ?? "?"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-[10px] uppercase font-mono tracking-wider text-cyan-100/60 justify-end sm:justify-start">
                    <span>{timeAgo(inst.lastSeenAt as string)}</span>
                    <Badge variant="outline" className={`${meta.color} border-current/30 bg-background/50`}>{meta.label}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── Telemetry Viewer ─────────────────────────────────────────────────────────

function TelemetryTab() {
  const [userId, setUserId] = useState("");
  const [query, setQuery] = useState<{ userId?: string } | null>(null);
  const { data, isLoading } = useGetOperationalTelemetry(
    query ?? {},
    { query: { queryKey: getGetOperationalTelemetryQueryKey(query ?? {}), enabled: !!query } }
  );

  const snapshots = ((data as Record<string, unknown>)?.snapshots as Array<Record<string, unknown>>) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          className="bg-background/50 border-cyan-900/30 text-cyan-50 placeholder:text-cyan-500/50 font-mono text-xs w-full sm:max-w-xs"
          placeholder="User ID to inspect…"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
        <Button size="sm" onClick={() => setQuery({ userId })} className="w-full sm:w-auto bg-cyan-900 hover:bg-cyan-800 text-cyan-50">
          <Search className="w-3.5 h-3.5 mr-1.5" />
          Load Telemetry
        </Button>
      </div>

      {isLoading && <div className="text-cyan-500/50 text-sm py-8 text-center font-mono animate-pulse">[ LOADING TELEMETRY... ]</div>}

      {snapshots.length > 0 && (
        <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-cyan-900/30 text-[10px] uppercase tracking-wider text-cyan-100/50 bg-background/50">
                    <th className="text-left py-2.5 px-4 font-semibold">Time</th>
                    <th className="text-right py-2.5 px-4 font-semibold">Equity</th>
                    <th className="text-right py-2.5 px-4 font-semibold">Balance</th>
                    <th className="text-right py-2.5 px-4 font-semibold">Float P&L</th>
                    <th className="text-right py-2.5 px-4 font-semibold">Margin%</th>
                    <th className="text-right py-2.5 px-4 font-semibold">Pos</th>
                    <th className="text-right py-2.5 px-4 font-semibold">DD%</th>
                    <th className="text-right py-2.5 px-4 font-semibold">Latency</th>
                    <th className="text-left py-2.5 px-4 font-semibold">Broker</th>
                  </tr>
                </thead>
                <tbody className="text-[11px]">
                  {snapshots.map((s) => {
                    const dd = s.currentDrawdownPct as number | null;
                    return (
                      <tr key={s.id as number} className="border-b border-cyan-900/10 hover:bg-cyan-950/20 transition-colors text-cyan-100">
                        <td className="py-2 px-4 text-cyan-500/70 whitespace-nowrap">{timeAgo(s.createdAt as string)}</td>
                        <td className="text-right py-2 px-4">{s.equity != null ? `${(s.equity as number).toFixed(2)}` : "—"}</td>
                        <td className="text-right py-2 px-4">{s.balance != null ? `${(s.balance as number).toFixed(2)}` : "—"}</td>
                        <td className={`text-right py-2 px-4 ${(s.floatingPnL as number) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {s.floatingPnL != null ? `${(s.floatingPnL as number) >= 0 ? "+" : ""}${(s.floatingPnL as number).toFixed(2)}` : "—"}
                        </td>
                        <td className="text-right py-2 px-4">{s.marginLevel != null ? `${(s.marginLevel as number).toFixed(0)}%` : "—"}</td>
                        <td className="text-right py-2 px-4">{s.openPositionsCount as number ?? "—"}</td>
                        <td className={`text-right py-2 px-4 ${dd !== null && dd! > 5 ? "text-red-400" : ""}`}>
                          {dd != null ? `${dd.toFixed(2)}%` : "—"}
                        </td>
                        <td className="text-right py-2 px-4">{s.vpsLatencyMs != null ? `${s.vpsLatencyMs}ms` : "—"}</td>
                        <td className="text-left py-2 px-4 text-cyan-500/70 truncate max-w-[120px]" title={s.brokerName as string ?? ""}>{s.brokerName as string ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && query && snapshots.length === 0 && (
        <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardContent className="py-10 text-center text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider">[ No telemetry found for this user ]</CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Execution Quality ────────────────────────────────────────────────────────

function ExecutionQualityTab() {
  const { data, isLoading } = useGetOperationalExecutionQuality();
  const d = data as Record<string, unknown> | undefined;
  const rankings = (d?.brokerRankings as Array<Record<string, unknown>>) ?? [];

  function scoreColor(score: number | null) {
    if (score === null) return "text-cyan-500/50";
    if (score >= 80) return "text-emerald-400";
    if (score >= 60) return "text-yellow-400";
    return "text-red-400";
  }

  return (
    <div className="space-y-4">
      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
          <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 uppercase tracking-wider">
            <BarChart3 className="w-4 h-4 text-cyan-400" />
            Broker Quality Rankings
          </CardTitle>
          <CardDescription className="text-[11px] text-cyan-500/60 font-mono uppercase tracking-wider mt-1">Composite score 0–100 (higher = better execution)</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && <div className="text-cyan-500/50 text-sm py-8 text-center font-mono animate-pulse">[ LOADING RANKINGS... ]</div>}
          {!isLoading && rankings.length === 0 && (
            <div className="text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider py-8 text-center">[ No execution quality data yet ]</div>
          )}
          {rankings.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-cyan-900/30 text-[10px] uppercase tracking-wider text-cyan-100/50 bg-background/50">
                    <th className="text-left py-2.5 px-4 font-semibold">#</th>
                    <th className="text-left py-2.5 px-4 font-semibold">Broker</th>
                    <th className="text-right py-2.5 px-4 font-semibold">Score</th>
                    <th className="text-right py-2.5 px-4 font-semibold">Avg Slip</th>
                    <th className="text-right py-2.5 px-4 font-semibold">Reject</th>
                    <th className="text-right py-2.5 px-4 font-semibold">Requote</th>
                    <th className="text-right py-2.5 px-4 font-semibold">Latency</th>
                    <th className="text-right py-2.5 px-4 font-semibold">Samples</th>
                  </tr>
                </thead>
                <tbody className="text-[11px]">
                  {rankings.map((b, idx) => (
                    <tr key={b.brokerName as string} className="border-b border-cyan-900/10 hover:bg-cyan-950/20 transition-colors text-cyan-100">
                      <td className="py-2 px-4 text-cyan-500/70">{idx + 1}</td>
                      <td className="py-2 px-4 font-bold text-cyan-50 truncate max-w-[150px]">{b.brokerName as string}</td>
                      <td className={`text-right py-2 px-4 font-bold text-lg ${scoreColor(b.avgQualityScore as number | null)}`}>
                        {b.avgQualityScore as number ?? "—"}
                      </td>
                      <td className="text-right py-2 px-4">{b.avgSlippagePoints != null ? `${(b.avgSlippagePoints as number).toFixed(1)}pt` : "—"}</td>
                      <td className="text-right py-2 px-4">{b.totalRejections as number ?? 0}</td>
                      <td className="text-right py-2 px-4">{b.totalRequotes as number ?? 0}</td>
                      <td className="text-right py-2 px-4">{b.avgLatencyMs != null ? `${(b.avgLatencyMs as number).toFixed(0)}ms` : "—"}</td>
                      <td className="text-right py-2 px-4 text-cyan-500/70">{b.samplePeriods as number}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminEaMonitor() {
  const queryClient = useQueryClient();
  useOpsRealtimeTypes(["fleet.connection_changed"], () => {
    void queryClient.invalidateQueries({ queryKey: getGetOperationalHeartbeatStatusQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetOperationalExecutionQualityQueryKey() });
  });

  return (
    <OpsShell
      title="EA Monitor"
      description="Real-time heartbeat status, telemetry history, and execution quality per broker."
    >
      <Tabs defaultValue="heartbeat" className="mt-4">
        <TabsList className="mb-6 bg-cyan-950/20 border border-cyan-900/30 p-1 flex-wrap h-auto w-full justify-start">
          <TabsTrigger value="heartbeat" className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider data-[state=active]:bg-cyan-900/50 data-[state=active]:text-cyan-50">
            <Wifi className="w-3.5 h-3.5" />Heartbeat
          </TabsTrigger>
          <TabsTrigger value="telemetry" className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider data-[state=active]:bg-cyan-900/50 data-[state=active]:text-cyan-50">
            <TrendingDown className="w-3.5 h-3.5" />Telemetry
          </TabsTrigger>
          <TabsTrigger value="quality" className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider data-[state=active]:bg-cyan-900/50 data-[state=active]:text-cyan-50">
            <Zap className="w-3.5 h-3.5" />Execution Quality
          </TabsTrigger>
        </TabsList>

        <TabsContent value="heartbeat"><HeartbeatMonitorTab /></TabsContent>
        <TabsContent value="telemetry"><TelemetryTab /></TabsContent>
        <TabsContent value="quality"><ExecutionQualityTab /></TabsContent>
      </Tabs>
    </OpsShell>
  );
}
