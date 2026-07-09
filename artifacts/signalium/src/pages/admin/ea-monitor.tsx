import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  useGetOperationalHeartbeatStatus,
  useGetOperationalHeartbeatOffline,
  useGetOperationalTelemetry,
  useGetOperationalExecutionQuality,
  getGetOperationalTelemetryQueryKey,
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
        <div className="grid grid-cols-5 gap-2">
          {(["ONLINE", "DEGRADED", "OFFLINE", "UNAUTHORIZED", "OUTDATED"] as HbState[]).map((s) => {
            const meta = STATE_META[s];
            const Icon = meta.icon;
            return (
              <div key={s} className="rounded-lg border bg-card p-3 text-center">
                <Icon className={`w-4 h-4 mx-auto mb-1 ${meta.color}`} />
                <div className={`text-xl font-bold ${meta.color}`}>{summary[s.toLowerCase()] ?? 0}</div>
                <div className="text-xs text-muted-foreground">{meta.label}</div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Filter by instance ID, user, or broker…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <Button size="sm" variant="outline" onClick={() => void refetch()}>
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground text-sm">
              {instances.length === 0 ? "No EA instances registered yet." : "No instances match the filter."}
            </CardContent>
          </Card>
        )}
        {filtered.map((inst) => {
          const state = (inst.derivedState ?? inst.state) as HbState;
          const meta = STATE_META[state] ?? STATE_META.OFFLINE;
          const Icon = meta.icon;
          return (
            <Card key={inst.eaInstanceId as string} className={state === "ONLINE" ? "border-emerald-500/20" : state === "OFFLINE" ? "border-red-500/20" : ""}>
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon className={`w-4 h-4 ${meta.color} shrink-0`} />
                    <div className="min-w-0">
                      <div className="font-mono text-sm truncate">{inst.eaInstanceId as string}</div>
                      <div className="text-xs text-muted-foreground">
                        {inst.brokerName as string ?? "Unknown broker"} · v{inst.eaVersion as string ?? "?"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 text-xs text-muted-foreground">
                    <span>{timeAgo(inst.lastSeenAt as string)}</span>
                    <Badge variant="outline" className={`${meta.color} border-current/30`}>{meta.label}</Badge>
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
      <div className="flex gap-2">
        <Input
          className="h-8 text-sm"
          placeholder="User ID to inspect…"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
        <Button size="sm" onClick={() => setQuery({ userId })}>
          <Search className="w-3.5 h-3.5 mr-1" />
          Load
        </Button>
      </div>

      {isLoading && <div className="text-muted-foreground text-sm">Loading…</div>}

      {snapshots.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left py-2 pr-3">Time</th>
                <th className="text-right pr-3">Equity</th>
                <th className="text-right pr-3">Balance</th>
                <th className="text-right pr-3">Float P&L</th>
                <th className="text-right pr-3">Margin%</th>
                <th className="text-right pr-3">Positions</th>
                <th className="text-right pr-3">DD%</th>
                <th className="text-right pr-3">Latency</th>
                <th className="text-left">Broker</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => {
                const dd = s.currentDrawdownPct as number | null;
                return (
                  <tr key={s.id as number} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{timeAgo(s.createdAt as string)}</td>
                    <td className="text-right pr-3">{s.equity != null ? `$${(s.equity as number).toFixed(2)}` : "—"}</td>
                    <td className="text-right pr-3">{s.balance != null ? `$${(s.balance as number).toFixed(2)}` : "—"}</td>
                    <td className={`text-right pr-3 ${(s.floatingPnL as number) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {s.floatingPnL != null ? `${(s.floatingPnL as number) >= 0 ? "+" : ""}$${(s.floatingPnL as number).toFixed(2)}` : "—"}
                    </td>
                    <td className="text-right pr-3">{s.marginLevel != null ? `${(s.marginLevel as number).toFixed(0)}%` : "—"}</td>
                    <td className="text-right pr-3">{s.openPositionsCount as number ?? "—"}</td>
                    <td className={`text-right pr-3 ${dd !== null && dd! > 5 ? "text-red-400" : ""}`}>
                      {dd != null ? `${dd.toFixed(2)}%` : "—"}
                    </td>
                    <td className="text-right pr-3">{s.vpsLatencyMs != null ? `${s.vpsLatencyMs}ms` : "—"}</td>
                    <td className="text-left text-muted-foreground">{s.brokerName as string ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && query && snapshots.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground text-sm">No telemetry found for this user.</CardContent>
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
    if (score === null) return "text-muted-foreground";
    if (score >= 80) return "text-emerald-400";
    if (score >= 60) return "text-yellow-400";
    return "text-red-400";
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            Broker Quality Rankings
          </CardTitle>
          <CardDescription>Composite score 0–100 (higher = better execution)</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="text-muted-foreground text-sm">Loading…</div>}
          {!isLoading && rankings.length === 0 && (
            <div className="text-muted-foreground text-sm py-4 text-center">No execution quality data yet.</div>
          )}
          {rankings.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4">#</th>
                    <th className="text-left pr-4">Broker</th>
                    <th className="text-right pr-4">Score</th>
                    <th className="text-right pr-4">Avg Slippage</th>
                    <th className="text-right pr-4">Rejections</th>
                    <th className="text-right pr-4">Requotes</th>
                    <th className="text-right pr-4">Avg Latency</th>
                    <th className="text-right">Periods</th>
                  </tr>
                </thead>
                <tbody>
                  {rankings.map((b, idx) => (
                    <tr key={b.brokerName as string} className="border-b border-border/50">
                      <td className="py-2 pr-4 text-muted-foreground">{idx + 1}</td>
                      <td className="pr-4 font-medium">{b.brokerName as string}</td>
                      <td className={`text-right pr-4 font-bold ${scoreColor(b.avgQualityScore as number | null)}`}>
                        {b.avgQualityScore as number ?? "—"}
                      </td>
                      <td className="text-right pr-4">{b.avgSlippagePoints != null ? `${(b.avgSlippagePoints as number).toFixed(1)}pt` : "—"}</td>
                      <td className="text-right pr-4">{b.totalRejections as number ?? 0}</td>
                      <td className="text-right pr-4">{b.totalRequotes as number ?? 0}</td>
                      <td className="text-right pr-4">{b.avgLatencyMs != null ? `${(b.avgLatencyMs as number).toFixed(0)}ms` : "—"}</td>
                      <td className="text-right">{b.samplePeriods as number}</td>
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
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="w-6 h-6 text-primary" />
          EA Monitor
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Real-time heartbeat status, telemetry history, and execution quality per broker.
        </p>
      </div>

      <Tabs defaultValue="heartbeat">
        <TabsList className="mb-6">
          <TabsTrigger value="heartbeat" className="flex items-center gap-1.5">
            <Wifi className="w-3.5 h-3.5" />Heartbeat
          </TabsTrigger>
          <TabsTrigger value="telemetry" className="flex items-center gap-1.5">
            <TrendingDown className="w-3.5 h-3.5" />Telemetry
          </TabsTrigger>
          <TabsTrigger value="quality" className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" />Execution Quality
          </TabsTrigger>
        </TabsList>

        <TabsContent value="heartbeat"><HeartbeatMonitorTab /></TabsContent>
        <TabsContent value="telemetry"><TelemetryTab /></TabsContent>
        <TabsContent value="quality"><ExecutionQualityTab /></TabsContent>
      </Tabs>
    </div>
  );
}
