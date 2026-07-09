import { useGetOperationalPlatformHealth, type GetOperationalPlatformHealth200 } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Cpu, MemoryStick, Timer, Database, Radio, Wifi, Server } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
              <Icon className="w-3.5 h-3.5" />
              {label}
            </div>
            <div className="text-2xl font-bold">{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
          </div>
          {!healthy && <Badge className="bg-red-500/10 text-red-400 border-red-500/20">Degraded</Badge>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminPlatformHealth() {
  const { data, isLoading, refetch, isFetching } = useGetOperationalPlatformHealth();
  const health = data as HealthData | undefined;
  const latest = health?.latest as Snapshot | undefined;
  const history = (health?.history ?? []) as Snapshot[];

  const memPct = latest?.memoryUsageMb != null && latest?.memoryTotalMb
    ? (latest.memoryUsageMb / latest.memoryTotalMb) * 100
    : null;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Server className="w-6 h-6 text-primary" />
            Platform Health
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            System-level API server metrics: CPU, memory, event-loop lag, DB latency, and connections.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm py-12 text-center">Loading…</div>
      ) : !latest ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            No health snapshots recorded yet. The monitor samples every 60 seconds.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Recent History</CardTitle>
              <CardDescription>Last {history.length} samples (newest first), refreshed every 60 seconds server-side.</CardDescription>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <div className="text-muted-foreground text-sm py-6 text-center">No history yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground text-xs border-b border-border/50">
                        <th className="pb-2 pr-4">Time</th>
                        <th className="text-right pr-4">CPU</th>
                        <th className="text-right pr-4">Memory</th>
                        <th className="text-right pr-4">Event Loop</th>
                        <th className="text-right pr-4">DB Latency</th>
                        <th className="text-right">WS Conns</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) => (
                        <tr key={h.id} className="border-b border-border/50">
                          <td className="py-2 pr-4 text-muted-foreground">{timeAgo(h.recordedAt)}</td>
                          <td className="text-right pr-4">{fmtPct(h.cpuUsagePct)}</td>
                          <td className="text-right pr-4">{fmtMb(h.memoryUsageMb)}</td>
                          <td className="text-right pr-4">{fmtMs(h.eventLoopLagMs)}</td>
                          <td className="text-right pr-4">{fmtMs(h.dbLatencyMs)}</td>
                          <td className="text-right">{h.activeWebsocketConnections ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
