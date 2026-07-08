import { useGetRuntimeStatus, useGetRuntimeSummary, useListTelemetry, useGetMySubscription } from "@workspace/api-client-react";
import { Activity, Wifi, WifiOff, TrendingUp, TrendingDown, AlertCircle, Clock, Cpu } from "lucide-react";

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${connected ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-success animate-pulse" : "bg-muted-foreground"}`} />
      {connected ? "CONNECTED" : "OFFLINE"}
    </span>
  );
}

const EVENT_COLORS: Record<string, string> = {
  trade_open: "text-success border-success/30 bg-success/10",
  trade_close: "text-primary border-primary/30 bg-primary/10",
  error: "text-destructive border-destructive/30 bg-destructive/10",
  info: "text-muted-foreground border-border bg-secondary",
  heartbeat: "text-warning border-warning/30 bg-warning/10",
  startup: "text-success border-success/30 bg-success/10",
  shutdown: "text-muted-foreground border-border bg-secondary",
};

export default function Dashboard() {
  const { data: status, isLoading: statusLoading } = useGetRuntimeStatus();
  const { data: summary } = useGetRuntimeSummary();
  const { data: telemetry } = useListTelemetry();
  const { data: subscription } = useGetMySubscription();

  const recentEvents = telemetry?.slice(0, 12) ?? [];

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-6 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Signalium runtime overview</p>
        </div>
        {!statusLoading && status && <StatusDot connected={status.isConnected} />}
      </div>

      <div className="p-8 space-y-8">
        {/* Runtime status */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="border border-border bg-card rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">QDE Runtime</div>
              {status && <StatusDot connected={status.isConnected} />}
            </div>
            {statusLoading ? (
              <div className="h-16 flex items-center justify-center text-muted-foreground text-sm">Loading...</div>
            ) : status ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  {status.isConnected ? (
                    <Wifi className="w-5 h-5 text-success" />
                  ) : (
                    <WifiOff className="w-5 h-5 text-muted-foreground" />
                  )}
                  <div>
                    <div className="font-semibold text-sm">{status.isConnected ? "Runtime active" : "No active connection"}</div>
                    {status.broker && <div className="text-xs text-muted-foreground">Broker: {status.broker}</div>}
                    {status.accountId && <div className="text-xs text-muted-foreground">Account: {status.accountId}</div>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                  <div>
                    <div className="text-xs text-muted-foreground">Active EAs</div>
                    <div className="font-bold text-lg tabular-nums">{status.activeEas}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Last heartbeat</div>
                    <div className="text-sm tabular-nums">
                      {status.lastHeartbeat
                        ? new Date(status.lastHeartbeat).toLocaleTimeString()
                        : "—"}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Subscription */}
          <div className="border border-border bg-card rounded-lg p-6">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Active Subscription</div>
            {subscription ? (
              <div className="space-y-3">
                <div>
                  <div className="font-bold text-lg">{subscription.plan?.name ?? "—"}</div>
                  <div className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full mt-1 ${
                    subscription.status === "active" ? "bg-success/15 text-success" :
                    subscription.status === "trialing" ? "bg-warning/15 text-warning" :
                    "bg-destructive/15 text-destructive"
                  }`}>
                    {subscription.status.toUpperCase()}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                  <div>
                    <div className="text-xs text-muted-foreground">Price</div>
                    <div className="font-bold tabular-nums">${subscription.plan?.priceMonthly}/mo</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Tier</div>
                    <div className="capitalize">{subscription.plan?.tier}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-3">
                <div className="text-sm text-muted-foreground">No active subscription.</div>
                <a href="/subscriptions" className="text-xs text-primary hover:underline font-medium">View plans →</a>
              </div>
            )}
          </div>
        </div>

        {/* Runtime summary stats */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="border border-border bg-card rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-success" />
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Trades Opened</div>
              </div>
              <div className="text-2xl font-bold tabular-nums">{summary.tradesOpened}</div>
            </div>
            <div className="border border-border bg-card rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="w-4 h-4 text-primary" />
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Trades Closed</div>
              </div>
              <div className="text-2xl font-bold tabular-nums">{summary.tradesClosed}</div>
            </div>
            <div className="border border-border bg-card rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="w-4 h-4 text-destructive" />
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Errors</div>
              </div>
              <div className="text-2xl font-bold tabular-nums">{summary.errors}</div>
            </div>
            <div className="border border-border bg-card rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-warning" />
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Uptime</div>
              </div>
              <div className="text-2xl font-bold tabular-nums">{summary.uptime}%</div>
            </div>
          </div>
        )}

        {/* Recent telemetry */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recent Telemetry</div>
            <a href="/runtime" className="text-xs text-primary hover:underline font-medium">View all →</a>
          </div>
          {recentEvents.length === 0 ? (
            <div className="border border-border bg-card rounded-lg p-8 text-center text-muted-foreground text-sm">
              <Activity className="w-8 h-8 mx-auto mb-3 opacity-30" />
              No telemetry yet. Connect your EA to start recording events.
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary">
                    <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Time</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">EA</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEvents.map((ev) => (
                    <tr key={ev.id} className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                        {new Date(ev.createdAt).toLocaleTimeString()}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`text-xs font-mono border px-2 py-0.5 rounded-lg ${EVENT_COLORS[ev.eventType] ?? "text-muted-foreground border-border"}`}>
                          {ev.eventType}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                        {ev.eaId ? `EA #${ev.eaId}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
