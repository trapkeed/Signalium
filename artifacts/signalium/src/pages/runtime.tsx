import { useGetRuntimeStatus, useListTelemetry } from "@workspace/api-client-react";
import { Activity, Wifi, WifiOff, Clock, AlertCircle, Info } from "lucide-react";

const EVENT_COLORS: Record<string, string> = {
  trade_open: "text-success border-success/30 bg-success/10",
  trade_close: "text-primary border-primary/30 bg-primary/10",
  error: "text-destructive border-destructive/30 bg-destructive/10",
  info: "text-muted-foreground border-border bg-secondary",
  heartbeat: "text-warning border-warning/30 bg-warning/10",
  startup: "text-success border-success/30 bg-success/10",
  shutdown: "text-muted-foreground border-border bg-secondary",
};

export default function Runtime() {
  const { data: status, isLoading: statusLoading } = useGetRuntimeStatus();
  const { data: telemetry, isLoading: telemetryLoading } = useListTelemetry();

  const isConnected = status?.isConnected ?? false;

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-6 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Runtime</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Live QDE runtime monitoring</p>
        </div>
        {!statusLoading && (
          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${isConnected ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-success animate-pulse" : "bg-muted-foreground"}`} />
            {isConnected ? "LIVE" : "OFFLINE"}
          </span>
        )}
      </div>

      <div className="p-8 space-y-8">
        {/* Setup guide */}
        {!isConnected && !statusLoading && (
          <div className="flex items-start gap-3 border border-primary/20 bg-primary/5 rounded-lg p-4 text-sm text-muted-foreground">
            <Info className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <span className="text-foreground font-medium">No runtime connected yet. </span>
              Install an EA from the EA Library, attach it to a chart in your MT4/MT5 terminal with your API key,
              and this page will update automatically once it starts sending heartbeats.
            </div>
          </div>
        )}

        {/* Connection status */}
        <div className="grid md:grid-cols-3 gap-4">
          <div className="border border-border bg-card rounded-lg p-5">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Connection</div>
            <div className="flex items-center gap-3">
              {isConnected ? (
                <Wifi className="w-6 h-6 text-success" />
              ) : (
                <WifiOff className="w-6 h-6 text-muted-foreground" />
              )}
              <div>
                <div className="font-semibold text-sm">{isConnected ? "Runtime connected" : "Not connected"}</div>
                {status?.broker && <div className="text-xs text-muted-foreground">{status.broker}</div>}
              </div>
            </div>
          </div>

          <div className="border border-border bg-card rounded-lg p-5">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Last Heartbeat</div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm tabular-nums">
                {status?.lastHeartbeat
                  ? new Date(status.lastHeartbeat).toLocaleString()
                  : "No heartbeat received"}
              </span>
            </div>
          </div>

          <div className="border border-border bg-card rounded-lg p-5">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Active EAs</div>
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              <span className="text-2xl font-bold tabular-nums">{status?.activeEas ?? 0}</span>
            </div>
          </div>
        </div>

        {/* Account info */}
        {status?.accountId && (
          <div className="border border-border bg-card rounded-lg p-4">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Connected Account</div>
            <div className="text-sm font-mono">{status.accountId}</div>
          </div>
        )}

        {/* Telemetry log */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Telemetry Event Log</div>

          {telemetryLoading ? (
            <div className="border border-border rounded-lg overflow-hidden animate-pulse">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="px-4 py-3 border-b border-border last:border-0 flex gap-4">
                  <div className="h-3 bg-secondary rounded w-24" />
                  <div className="h-3 bg-secondary rounded w-20" />
                  <div className="h-3 bg-secondary rounded w-full" />
                </div>
              ))}
            </div>
          ) : telemetry && telemetry.length > 0 ? (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary">
                    <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Timestamp</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">EA</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Payload</th>
                  </tr>
                </thead>
                <tbody>
                  {telemetry.map((ev) => (
                    <tr key={ev.id} className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(ev.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs font-mono border px-2 py-0.5 rounded-lg ${EVENT_COLORS[ev.eventType] ?? "text-muted-foreground border-border"}`}>
                          {ev.eventType}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {ev.eaId ? `EA #${ev.eaId}` : "—"}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground max-w-xs truncate">
                        {ev.payload ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          ) : (
            <div className="border border-border bg-card rounded-lg p-12 text-center text-muted-foreground">
              <AlertCircle className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <div className="text-sm">No telemetry events yet.</div>
              <div className="text-xs mt-1">Connect your EA to the runtime to start recording events.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
