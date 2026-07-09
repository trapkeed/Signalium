import { useUser } from "@clerk/react";
import { useGetOpsDashboardOverview } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, Users, Cpu, TrendingUp, Server, Bell, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

function timeAgo(v: string | null | undefined) {
  if (!v) return "—";
  try { return formatDistanceToNow(new Date(v), { addSuffix: true }); } catch { return v; }
}

function fmtNum(v: number | null | undefined, opts?: { pct?: boolean; money?: boolean }) {
  if (v === null || v === undefined) return "—";
  if (opts?.money) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (opts?.pct) return `${v}%`;
  return v.toLocaleString();
}

function SectionCard({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <Card className="bg-card/50 backdrop-blur">
      <CardHeader className="pb-3 border-b border-border/50">
        <CardTitle className="text-sm flex items-center gap-2 uppercase tracking-wider">
          <Icon className="w-4 h-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">{children}</CardContent>
    </Card>
  );
}

function Metric({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="p-3 rounded-md bg-background/60 border border-border/50">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
      <div className="text-xl font-mono font-bold truncate">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function DistributionList({ data }: { data: Record<string, number> | undefined }) {
  const entries = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (entries.length === 0) return <div className="text-sm text-muted-foreground">No data</div>;
  return (
    <div className="space-y-1.5">
      {entries.map(([key, count]) => (
        <div key={key} className="flex items-center justify-between text-sm">
          <span className="truncate text-muted-foreground">{key}</span>
          <Badge variant="secondary" className="font-mono">{count}</Badge>
        </div>
      ))}
    </div>
  );
}

/**
 * Restricted to admin-level accounts (admin / super_admin) only — one tier
 * stricter than the rest of the admin panel, which staff/founder/researcher
 * roles can also reach. The API also enforces this (`requireAdmin`); this
 * client-side check just avoids showing a confusing empty/erroring page to
 * a staff-level user who can see the nav item hidden but might navigate
 * here directly by URL.
 */
function useIsAdminLevel(): boolean {
  const { user } = useUser();
  const role = user?.publicMetadata?.role as string | undefined;
  return role === "admin" || role === "super_admin";
}

export default function AdminOpsDashboard() {
  const isAdminLevel = useIsAdminLevel();
  const { data, isLoading, isError, refetch, isFetching } = useGetOpsDashboardOverview({
    query: { enabled: isAdminLevel, refetchInterval: 30_000, queryKey: ["ops-dashboard-overview"] },
  });

  if (!isAdminLevel) {
    return (
      <div className="p-6 max-w-lg mx-auto text-center">
        <ShieldAlert className="w-10 h-10 text-destructive mx-auto mb-3" />
        <h1 className="text-lg font-semibold mb-1">Access restricted</h1>
        <p className="text-sm text-muted-foreground">
          The Operations Dashboard is only available to Admin and Super Admin accounts.
        </p>
      </div>
    );
  }

  const d = data as Record<string, any> | undefined;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Operations Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {d?.generatedAt ? `Updated ${timeAgo(d.generatedAt)}` : "Loading…"}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border hover:bg-secondary/60 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading dashboard…</div>}
      {isError && <div className="text-sm text-destructive">Failed to load dashboard data.</div>}

      {d && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SectionCard title="User Monitoring" icon={Users}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
              <Metric label="Online now" value={fmtNum(d.userMonitoring?.onlineUsersNow)} />
              <Metric label="Active 24h" value={fmtNum(d.userMonitoring?.activeUsers24h)} />
              <Metric label="Autonomous sessions" value={fmtNum(d.userMonitoring?.activeAutonomousSessions)} />
              <Metric label="Manual sessions" value={fmtNum(d.userMonitoring?.activeManualSessions)} />
              <Metric label="Active subs" value={fmtNum(d.userMonitoring?.subscriptions?.active)} />
              <Metric label="MRR" value={fmtNum(d.userMonitoring?.subscriptions?.revenueMonthly, { money: true })} />
            </div>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <Metric
                label="Churn (30d)"
                value={`${fmtNum(d.userMonitoring?.churn?.churnRatePct, { pct: true })}`}
                sub={`${fmtNum(d.userMonitoring?.churn?.churned30d)} churned`}
              />
              <Metric
                label="Trial conversion"
                value={d.userMonitoring?.trialConversion?.conversionRatePct !== null
                  ? `${fmtNum(d.userMonitoring?.trialConversion?.conversionRatePct, { pct: true })}`
                  : "—"}
                sub={`${fmtNum(d.userMonitoring?.trialConversion?.trialsStarted30d)} started (30d, approx.)`}
              />
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Package distribution</div>
            <DistributionList data={d.userMonitoring?.subscriptions?.packageDistribution} />
          </SectionCard>

          <SectionCard title="EA Monitoring" icon={Cpu}>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <Metric label="Online" value={fmtNum(d.eaMonitoring?.fleet?.online)} />
              <Metric label="Degraded" value={fmtNum(d.eaMonitoring?.fleet?.degraded)} />
              <Metric label="Offline" value={fmtNum(d.eaMonitoring?.fleet?.offline)} />
            </div>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <Metric label="Avg VPS latency" value={d.eaMonitoring?.avgVpsLatencyMs !== null ? `${d.eaMonitoring?.avgVpsLatencyMs}ms` : "—"} />
              <Metric
                label="API response (avg / p95)"
                value={
                  d.eaMonitoring?.apiResponseTime?.avgMs !== null
                    ? `${Math.round(d.eaMonitoring?.apiResponseTime?.avgMs)} / ${Math.round(d.eaMonitoring?.apiResponseTime?.p95Ms)}ms`
                    : "—"
                }
              />
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">EA version distribution</div>
            <DistributionList data={d.eaMonitoring?.eaVersionDistribution} />
          </SectionCard>

          <SectionCard title="Autonomous Trading Monitoring" icon={TrendingUp}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
              <Metric label="Active autonomous users" value={fmtNum(d.autonomousTradingMonitoring?.activeAutonomousUsers)} />
              <Metric label="Active positions" value={fmtNum(d.autonomousTradingMonitoring?.activePositions)} />
              <Metric
                label="Engine uptime (24h, proxy)"
                value={
                  d.autonomousTradingMonitoring?.autonomousEngineUptimePct !== null
                    ? fmtNum(d.autonomousTradingMonitoring?.autonomousEngineUptimePct, { pct: true })
                    : "—"
                }
              />
              <Metric label="Floating PnL" value={fmtNum(d.autonomousTradingMonitoring?.pnl?.currentFloatingPnl, { money: true })} />
              <Metric label="Realized PnL (24h)" value={fmtNum(d.autonomousTradingMonitoring?.pnl?.realizedPnl24h, { money: true })} />
              <Metric label="Avg drawdown" value={fmtNum(d.autonomousTradingMonitoring?.portfolioRisk?.avgDrawdownPct, { pct: true })} />
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Open exposure by asset class (accounts with a position)
            </div>
            <DistributionList data={d.autonomousTradingMonitoring?.exposure?.byAssetClass} />
          </SectionCard>

          <SectionCard title="Infrastructure Monitoring" icon={Server}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
              <Metric label="CPU" value={fmtNum(d.infrastructure?.cpuUsagePct, { pct: true })} />
              <Metric label="Memory" value={d.infrastructure?.memoryUsageMb !== null ? `${Math.round(d.infrastructure?.memoryUsageMb)}MB` : "—"} />
              <Metric label="Event loop lag" value={d.infrastructure?.eventLoopLagMs !== null ? `${Math.round(d.infrastructure?.eventLoopLagMs)}ms` : "—"} />
              <Metric label="DB latency" value={d.infrastructure?.dbLatencyMs !== null ? `${Math.round(d.infrastructure?.dbLatencyMs)}ms` : "—"} />
              <Metric label="WS connections" value={fmtNum(d.infrastructure?.activeWebsocketConnections)} />
              <Metric label="DB healthy" value={d.infrastructure?.dbHealthy ? "Yes" : "No"} />
            </div>
            <div className="text-[10px] text-muted-foreground space-y-1">
              {!d.infrastructure?.queue?.configured && <div>Queue metrics: {d.infrastructure?.queue?.note}</div>}
              {!d.infrastructure?.cache?.configured && <div>Cache metrics: {d.infrastructure?.cache?.note}</div>}
              {!d.infrastructure?.storage?.configured && <div>Storage metrics: {d.infrastructure?.storage?.note}</div>}
            </div>
          </SectionCard>

          <SectionCard title="Admin Alerts" icon={Bell}>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <Metric label="Unacknowledged" value={fmtNum(d.alerts?.unacknowledged)} />
              <Metric label="Alert types (24h)" value={fmtNum(d.alerts?.last24hByType?.length)} />
            </div>
            <div className="space-y-1.5">
              {(d.alerts?.last24hByType ?? []).length === 0 ? (
                <div className="text-sm text-muted-foreground">No alerts in the last 24h</div>
              ) : (
                (d.alerts?.last24hByType ?? []).map((a: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between text-sm">
                    <span className="truncate text-muted-foreground">{String(a.type).replace(/_/g, " ")}</span>
                    <Badge
                      variant={a.severity === "critical" ? "destructive" : "secondary"}
                      className="font-mono"
                    >
                      {a.count}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
