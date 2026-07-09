import { useGetOperationalPlatformHealth, getGetOperationalPlatformHealthQueryKey, type GetOperationalPlatformHealth200 } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Cpu, MemoryStick, Timer, Database, Radio, Wifi, Server } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { OpsShell } from "@/components/ops/ops-shell";
import { useOpsRealtimeTypes } from "@/hooks/use-ops-realtime";
import { useQueryClient } from "@tanstack/react-query";

function timeAgo(v: string | null | undefined) {
  if (!v) return "never";
  try { return formatDistanceToNow(new Date(v), { addSuffix: true }); } catch { return v; }
}

type HealthData = NonNullable<GetOperationalPlatformHealth200>;
type Snapshot = NonNullable<HealthData["latest"]>;

function fmtPct(v: number | null | undefined) {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}
function fmtMb(v: number | null | undefined) {
  return v == null ? "—" : `${v.toFixed(0)} MB`;
}
function fmtMs(v: number | null | undefined) {
  return v == null ? "—" : `${v.toFixed(0)} ms`;
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  healthy = true,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  healthy?: boolean;
}) {
  return (
    <Card className="border-cyan-900/40 bg-card/50 backdrop-blur relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-cyan-100/60 flex items-center gap-1.5 mb-2 truncate">
              <Icon className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              {label}
            </div>
            <div className="text-xl sm:text-2xl font-mono font-bold text-cyan-50 truncate">{value}</div>
            {sub && <div className="text-[10px] font-mono text-cyan-500/50 mt-1.5 truncate uppercase">{sub}</div>}
          </div>
          {!healthy && <Badge className="bg-red-950/50 text-red-400 border border-red-900/50 text-[10px] uppercase font-mono tracking-wider">Degraded</Badge>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminPlatformHealth() {
  const queryClient = useQueryClient();
  useOpsRealtimeTypes(["health.snapshot"], () => {
    void queryClient.invalidateQueries({ queryKey: getGetOperationalPlatformHealthQueryKey() });
  });

  const { data, isLoading, refetch, isFetching } = useGetOperationalPlatformHealth();
  const health = data as HealthData | undefined;
  const latest = health?.latest as Snapshot | undefined;
  const history = (health?.history ?? []) as Snapshot[];

  const memPct = latest?.memoryUsageMb != null && latest?.memoryTotalMb
    ? (latest.memoryUsageMb / latest.memoryTotalMb) * 100
    : null;

  return (
    <OpsShell
      title="Platform Health"
      description="System-level API server metrics: CPU, memory, event-loop lag, DB latency, and connections."
      actions={
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="border-cyan-900/50 text-cyan-50 hover:bg-cyan-900/20 bg-background/50 backdrop-blur">
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      }
    >
      {isLoading ? (
        <div className="text-cyan-500/50 text-sm py-12 text-center font-mono animate-pulse">[ LOADING TELEMETRY... ]</div>
      ) : !latest ? (
        <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardContent className="py-12 text-center text-cyan-100/60 text-sm font-mono uppercase tracking-wider">
            [ No health snapshots recorded yet. The monitor samples every 60 seconds. ]
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4 sm:space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <StatCard icon={Cpu} label="CPU Usage" value={fmtPct(latest.cpuUsagePct)} />
            <StatCard
              icon={MemoryStick}
              label="Memory"
              value={fmtMb(latest.memoryUsageMb)}
              sub={memPct != null ? `${memPct.toFixed(1)}% of ${fmtMb(latest.memoryTotalMb)}` : undefined}
            />
            <StatCard icon={Timer} label="Event Loop Lag" value={fmtMs(latest.eventLoopLagMs)} />
            <StatCard
              icon={Database}
              label="DB Latency"
              value={fmtMs(latest.dbLatencyMs)}
              healthy={latest.dbHealthy ?? true}
            />
            <StatCard
              icon={Radio}
              label="Redis"
              value={latest.redisConfigured ? fmtMs(latest.redisLatencyMs) : "Not configured"}
              sub={latest.redisConfigured ? undefined : "No Redis/queue infra in this deployment"}
            />
            <StatCard icon={Wifi} label="Active EA WebSockets" value={String(latest.activeWebsocketConnections ?? 0)} />
            <StatCard
              icon={Timer}
              label="Scheduler"
              value={latest.workerHealthy ? "Healthy" : "Stalled"}
              sub={`Last run ${timeAgo(latest.schedulerLastRunAt)}`}
              healthy={latest.workerHealthy ?? true}
            />
            <StatCard icon={Server} label="Last Sample" value={timeAgo(latest.recordedAt)} />
          </div>

          <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
            <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
              <CardTitle className="text-sm text-cyan-50 uppercase tracking-wider">Recent History</CardTitle>
              <CardDescription className="text-[11px] text-cyan-500/60 font-mono uppercase tracking-wider mt-1">Last {history.length} samples (newest first), refreshed every 60s server-side.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {history.length === 0 ? (
                <div className="text-cyan-500/50 text-sm py-6 text-center font-mono uppercase">[ No history yet ]</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-cyan-100/50 border-b border-cyan-900/30 bg-background/50">
                        <th className="py-2.5 px-4 font-semibold">Time</th>
                        <th className="text-right py-2.5 px-4 font-semibold">CPU</th>
                        <th className="text-right py-2.5 px-4 font-semibold">Memory</th>
                        <th className="text-right py-2.5 px-4 font-semibold">Event Loop</th>
                        <th className="text-right py-2.5 px-4 font-semibold">DB Latency</th>
                        <th className="text-right py-2.5 px-4 font-semibold">WS Conns</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-[11px]">
                      {history.map((h) => (
                        <tr key={h.id} className="border-b border-cyan-900/10 hover:bg-cyan-950/20 transition-colors">
                          <td className="py-2 px-4 text-cyan-500/70 whitespace-nowrap">{timeAgo(h.recordedAt)}</td>
                          <td className="text-right py-2 px-4 text-cyan-100">{fmtPct(h.cpuUsagePct)}</td>
                          <td className="text-right py-2 px-4 text-cyan-100">{fmtMb(h.memoryUsageMb)}</td>
                          <td className="text-right py-2 px-4 text-cyan-100">{fmtMs(h.eventLoopLagMs)}</td>
                          <td className="text-right py-2 px-4 text-cyan-100">{fmtMs(h.dbLatencyMs)}</td>
                          <td className="text-right py-2 px-4 text-cyan-100">{h.activeWebsocketConnections ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </OpsShell>
  );
}
