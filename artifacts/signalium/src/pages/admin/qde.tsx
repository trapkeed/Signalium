import { useState } from "react";
import {
  useListEaConnections,
  useListAllTelemetry,
  useListAllActions,
  useGetQdeStatsOverview,
  useRedeliverAction,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  Radio,
  Wifi,
  WifiOff,
  RotateCw,
  Activity,
  Gauge,
  ListChecks,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const POLL_MS = 5000;

const ACTION_COLORS: Record<string, string> = {
  HOLD: "text-muted-foreground",
  ADD: "text-primary",
  REDUCE: "text-yellow-500",
  TRAIL: "text-blue-400",
  BREAKEVEN: "text-blue-400",
  LOCK_PROFIT: "text-primary",
  CLOSE: "text-destructive",
};

const STATUS_COLORS: Record<string, string> = {
  queued: "text-yellow-500",
  delivered: "text-blue-400",
  acknowledged: "text-primary",
  failed: "text-destructive",
};

function StatCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string | number; tone?: string }) {
  return (
    <div className="border border-border rounded-sm p-4 bg-card flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground uppercase tracking-wider">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className={`text-2xl font-bold font-mono ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

export default function AdminQde() {
  const { toast } = useToast();
  const [scope, setScope] = useState<"connections" | "telemetry" | "actions">("connections");

  const { data: stats } = useGetQdeStatsOverview({ query: { refetchInterval: POLL_MS } as any });
  const { data: connections = [] } = useListEaConnections({ query: { refetchInterval: POLL_MS } as any });
  const { data: telemetry = [] } = useListAllTelemetry({ query: { refetchInterval: POLL_MS } as any });
  const { data: actions = [] } = useListAllActions({ query: { refetchInterval: POLL_MS } as any });
  const redeliver = useRedeliverAction();

  async function handleRedeliver(id: number) {
    try {
      const res = await redeliver.mutateAsync({ id });
      toast({ title: res.delivered ? "Redelivered" : "EA offline, still queued" });
    } catch (err: any) {
      toast({ title: "Redelivery failed", description: err?.message, variant: "destructive" });
    }
  }

  const breakdown = stats?.actionBreakdownLast5Min ?? {};

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-xl font-bold font-mono tracking-tight flex items-center gap-2">
          <Radio className="w-5 h-5 text-primary" /> QDE Loop Observability
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live EA &lt;-&gt; Platform &lt;-&gt; Trainer telemetry, actions, and connection health (auto-refreshing every 5s)
        </p>
      </div>

      <div className="flex-1 p-8 max-w-6xl">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard icon={Wifi} label="Live Connections" value={stats?.liveConnections ?? "—"} tone="text-primary" />
          <StatCard icon={Radio} label="Registered Terminals" value={stats?.registeredTerminals ?? "—"} />
          <StatCard icon={Activity} label="Telemetry (5m)" value={stats?.telemetryLast5Min ?? "—"} />
          <StatCard icon={Gauge} label="Queue Depth" value={stats?.queueDepth ?? "—"} tone={stats && stats.queueDepth > 0 ? "text-yellow-500" : ""} />
        </div>

        {stats && stats.actionsWithRetries > 0 && (
          <div className="mb-6 border border-destructive/40 bg-destructive/10 rounded-sm px-4 py-3 flex items-center gap-2 text-xs font-mono text-destructive">
            <AlertTriangle className="w-4 h-4" />
            {stats.actionsWithRetries} action(s) required a delivery retry
          </div>
        )}

        <div className="mb-6 border border-border rounded-sm p-4 bg-card">
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <ListChecks className="w-3.5 h-3.5" /> Action Breakdown (last 5 min)
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.keys(breakdown).length === 0 ? (
              <span className="text-xs font-mono text-muted-foreground">No actions yet</span>
            ) : (
              Object.entries(breakdown).map(([action, count]) => (
                <Badge key={action} variant="outline" className={`rounded-sm font-mono text-xs ${ACTION_COLORS[action] ?? ""}`}>
                  {action}: {count}
                </Badge>
              ))
            )}
          </div>
        </div>

        <Tabs value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
          <TabsList className="rounded-sm mb-6 bg-secondary/50 border border-border">
            <TabsTrigger value="connections" className="rounded-sm font-mono text-xs">Connections</TabsTrigger>
            <TabsTrigger value="telemetry" className="rounded-sm font-mono text-xs">Telemetry</TabsTrigger>
            <TabsTrigger value="actions" className="rounded-sm font-mono text-xs">Actions</TabsTrigger>
          </TabsList>

          <TabsContent value="connections">
            <div className="border border-border rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    {["Connection", "Transport", "Status", "Connected", "Last Message", "Messages"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {connections.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">No EA connections yet</td></tr>
                  ) : (
                    connections.map((c) => (
                      <tr key={c.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                        <td className="px-4 py-3 font-mono text-xs">{c.connectionId}</td>
                        <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{c.transport}</td>
                        <td className="px-4 py-3">
                          {c.status === "connected" ? (
                            <span className="flex items-center gap-1 text-xs font-mono text-primary"><Wifi className="w-3 h-3" /> connected</span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs font-mono text-muted-foreground"><WifiOff className="w-3 h-3" /> disconnected</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{new Date(c.connectedAt).toLocaleString()}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleTimeString() : "—"}</td>
                        <td className="px-4 py-3 text-xs font-mono">{c.messageCount}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="telemetry">
            <div className="border border-border rounded-sm overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    {["Symbol", "Balance", "Equity", "Margin", "Free Margin", "Open Pos.", "Floating P/L", "Drawdown", "Received"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {telemetry.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">No telemetry received yet</td></tr>
                  ) : (
                    telemetry.map((t) => (
                      <tr key={t.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                        <td className="px-4 py-3 font-mono text-xs font-medium">{t.symbol ?? "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs">{t.balance.toFixed(2)}</td>
                        <td className="px-4 py-3 font-mono text-xs">{t.equity.toFixed(2)}</td>
                        <td className="px-4 py-3 font-mono text-xs">{t.margin.toFixed(2)}</td>
                        <td className="px-4 py-3 font-mono text-xs">{t.freeMargin.toFixed(2)}</td>
                        <td className="px-4 py-3 font-mono text-xs">{t.openPositions}</td>
                        <td className={`px-4 py-3 font-mono text-xs ${t.floatingPnl >= 0 ? "text-primary" : "text-destructive"}`}>{t.floatingPnl.toFixed(2)}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{t.drawdown != null ? `${t.drawdown.toFixed(2)}%` : "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{new Date(t.receivedAt).toLocaleTimeString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="actions">
            <div className="border border-border rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    {["Symbol", "Action", "Reasoning", "Status", "Retries", "Created", ""].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {actions.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">No trainer actions yet</td></tr>
                  ) : (
                    actions.map((a) => (
                      <tr key={a.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                        <td className="px-4 py-3 font-mono text-xs font-medium">{a.symbol ?? "—"}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`rounded-sm font-mono text-xs ${ACTION_COLORS[a.action] ?? ""}`}>{a.action}</Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[240px] truncate">{a.reasoning ?? "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-mono ${STATUS_COLORS[a.status] ?? ""}`}>{a.status}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{a.retryCount}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground font-mono whitespace-nowrap">{new Date(a.createdAt).toLocaleTimeString()}</td>
                        <td className="px-4 py-3 text-right">
                          {(a.status === "queued" || a.status === "failed") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 rounded-sm"
                              title="Retry delivery"
                              onClick={() => handleRedeliver(a.id)}
                              disabled={redeliver.isPending}
                            >
                              <RotateCw className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
