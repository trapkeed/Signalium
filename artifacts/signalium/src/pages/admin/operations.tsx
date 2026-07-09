import { useGetOperationalDashboard, useGetOperationalAlerts, useGetOperationalIncidents, usePostOperationalAlertsIdAcknowledge } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { OpsShell } from "@/components/ops/ops-shell";
import { useOpsRealtimeTypes } from "@/hooks/use-ops-realtime";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  WifiOff,
  Wifi,
  Minus,
  Bell,
  BellOff,
  Server,
  Zap,
  Clock,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetOperationalAlertsQueryKey,
  getGetOperationalDashboardQueryKey,
  getGetOperationalIncidentsQueryKey,
} from "@workspace/api-client-react";

function timeAgo(v: string | null | undefined) {
  if (!v) return "—";
  try { return formatDistanceToNow(new Date(v), { addSuffix: true }); } catch { return v; }
}

type AlertSeverity = "info" | "warning" | "critical";
type IncidentStatus = "INCIDENT_OPEN" | "INVESTIGATING" | "RESOLVED";
type IncidentSeverity = "low" | "medium" | "high" | "critical";

const SEVERITY_COLORS: Record<AlertSeverity, string> = {
  info: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  warning: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  critical: "bg-red-500/10 text-red-400 border-red-500/20",
};

const INCIDENT_STATUS_COLORS: Record<IncidentStatus, string> = {
  INCIDENT_OPEN: "bg-red-500/10 text-red-400",
  INVESTIGATING: "bg-yellow-500/10 text-yellow-400",
  RESOLVED: "bg-emerald-500/10 text-emerald-400",
};

const INC_SEV_COLORS: Record<IncidentSeverity, string> = {
  low: "bg-blue-500/10 text-blue-400",
  medium: "bg-yellow-500/10 text-yellow-400",
  high: "bg-orange-500/10 text-orange-400",
  critical: "bg-red-500/10 text-red-400",
};

// ─── EA Fleet Summary ─────────────────────────────────────────────────────────

function EAFleetCard({ data }: { data: Record<string, unknown> | undefined }) {
  const instances = data?.eaInstances as {
    online: number; offline: number; degraded: number;
    unauthorized: number; outdated: number; total: number;
  } | undefined;
  if (!instances) return null;

  return (
    <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
      <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
        <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 uppercase tracking-wider">
          <Activity className="w-4 h-4 text-cyan-400" />
          EA Fleet
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          <div className="text-center p-3 rounded-md bg-emerald-950/20 border border-emerald-900/50 shadow-inner">
            <Wifi className="w-4 h-4 text-emerald-400 mx-auto mb-1 opacity-80" />
            <div className="text-2xl font-mono font-bold text-emerald-400">{instances.online}</div>
            <div className="text-[10px] uppercase tracking-wider text-emerald-400/70 mt-1">Online</div>
          </div>
          <div className="text-center p-3 rounded-md bg-yellow-950/20 border border-yellow-900/50 shadow-inner">
            <Minus className="w-4 h-4 text-yellow-400 mx-auto mb-1 opacity-80" />
            <div className="text-2xl font-mono font-bold text-yellow-400">{instances.degraded}</div>
            <div className="text-[10px] uppercase tracking-wider text-yellow-400/70 mt-1">Degraded</div>
          </div>
          <div className="text-center p-3 rounded-md bg-red-950/20 border border-red-900/50 shadow-inner">
            <WifiOff className="w-4 h-4 text-red-400 mx-auto mb-1 opacity-80" />
            <div className="text-2xl font-mono font-bold text-red-400">{instances.offline}</div>
            <div className="text-[10px] uppercase tracking-wider text-red-400/70 mt-1">Offline</div>
          </div>
          <div className="text-center p-3 rounded-md bg-orange-950/20 border border-orange-900/50 shadow-inner">
            <CheckCircle2 className="w-4 h-4 text-orange-400 mx-auto mb-1 opacity-80" />
            <div className="text-2xl font-mono font-bold text-orange-400">{instances.unauthorized ?? 0}</div>
            <div className="text-[10px] uppercase tracking-wider text-orange-400/70 mt-1">Unauth</div>
          </div>
          <div className="text-center p-3 rounded-md bg-purple-950/20 border border-purple-900/50 shadow-inner">
            <Zap className="w-4 h-4 text-purple-400 mx-auto mb-1 opacity-80" />
            <div className="text-2xl font-mono font-bold text-purple-400">{instances.outdated ?? 0}</div>
            <div className="text-[10px] uppercase tracking-wider text-purple-400/70 mt-1">Outdated</div>
          </div>
        </div>
        <div className="mt-4 text-center text-[11px] uppercase tracking-wider text-cyan-500/50 font-mono">
          [ {instances.total} Total Registered Instances ]
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Stats Row ────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType;
  label: string;
  value: string | number | null | undefined;
  color?: string;
}) {
  return (
    <Card className="border-cyan-900/40 bg-card/50 backdrop-blur relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className={`p-2 sm:p-2.5 rounded-md bg-background border border-cyan-900/50 shadow-inner`}>
            <Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${color ?? "text-cyan-400"}`} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] sm:text-[11px] uppercase tracking-wider text-cyan-100/60 truncate">{label}</div>
            <div className="text-lg sm:text-2xl font-mono font-bold text-cyan-50 truncate">{value ?? "—"}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Recent Alerts ────────────────────────────────────────────────────────────

function RecentAlertsCard() {
  const { data, isLoading } = useGetOperationalAlerts({ unacknowledged: "true", limit: 10 });
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const ackMutation = usePostOperationalAlertsIdAcknowledge({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetOperationalAlertsQueryKey() });
        toast({ title: "Alert acknowledged" });
      },
      onError: () => toast({ title: "Failed to acknowledge alert. Try again.", variant: "destructive" }),
    },
  });

  if (isLoading) return null;

  const alerts = ((data as Record<string, unknown>)?.alerts as Array<Record<string, unknown>>) ?? [];

  return (
    <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
      <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
        <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 uppercase tracking-wider">
          <Bell className="w-4 h-4 text-yellow-400" />
          Active Alerts
          {alerts.length > 0 && (
            <Badge variant="destructive" className="ml-auto text-[10px] font-mono">{alerts.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 p-4 sm:p-5">
        {alerts.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-emerald-400 py-2 font-mono">
            <CheckCircle2 className="w-4 h-4" />
            [ ALL CLEAR ]
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((a) => (
              <div key={a.id as number} className={`flex flex-col sm:flex-row sm:items-start justify-between gap-3 p-3 rounded-md border bg-background/50 ${SEVERITY_COLORS[a.severity as AlertSeverity] ?? ""}`}>
                <div className="min-w-0">
                  <div className="text-[11px] font-bold uppercase tracking-wider">{(a.type as string).replace(/_/g, " ")}</div>
                  <div className="text-sm mt-1 opacity-90">{a.message as string}</div>
                  <div className="text-[10px] font-mono mt-2 opacity-70">{timeAgo(a.createdAt as string)}</div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 h-8 text-xs hover:bg-current/10 w-full sm:w-auto"
                  onClick={() => ackMutation.mutate({ id: a.id as number })}
                  disabled={ackMutation.isPending}
                >
                  <BellOff className="w-3.5 h-3.5 mr-1.5" />
                  Ack
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Open Incidents ───────────────────────────────────────────────────────────

function OpenIncidentsCard() {
  const { data, isLoading } = useGetOperationalIncidents({ status: "INCIDENT_OPEN" });
  const { data: investigating } = useGetOperationalIncidents({ status: "INVESTIGATING" });

  if (isLoading) return null;

  const open = ((data as Record<string, unknown>)?.incidents as Array<Record<string, unknown>>) ?? [];
  const inv = ((investigating as Record<string, unknown>)?.incidents as Array<Record<string, unknown>>) ?? [];
  const all = [...open, ...inv].sort((a, b) =>
    new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime()
  );

  return (
    <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
      <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
        <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 uppercase tracking-wider">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          Open Incidents
          {all.length > 0 && (
            <Badge variant="destructive" className="ml-auto text-[10px] font-mono">{all.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 p-4 sm:p-5">
        {all.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-emerald-400 py-2 font-mono">
            <CheckCircle2 className="w-4 h-4" />
            [ ALL CLEAR ]
          </div>
        ) : (
          <div className="space-y-3">
            {all.map((inc) => (
              <div key={inc.id as number} className="p-3 rounded-md border border-cyan-900/30 bg-background/50">
                <div className="flex flex-wrap items-start gap-2">
                  <Badge className={`${INCIDENT_STATUS_COLORS[inc.status as IncidentStatus] ?? ""} text-[10px] border-0 shrink-0 uppercase tracking-wider font-mono`}>
                    {(inc.status as string).replace(/_/g, " ")}
                  </Badge>
                  <Badge className={`${INC_SEV_COLORS[inc.severity as IncidentSeverity] ?? ""} text-[10px] border-0 shrink-0 uppercase tracking-wider font-mono`}>
                    {inc.severity as string}
                  </Badge>
                </div>
                <div className="text-sm font-medium mt-2 text-cyan-50">{inc.title as string}</div>
                <div className="text-[10px] font-mono text-cyan-100/60 mt-1.5 uppercase tracking-wider">
                  {inc.category as string} <span className="opacity-50">/</span> {timeAgo(inc.createdAt as string)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminOperations() {
  const queryClient = useQueryClient();
  useOpsRealtimeTypes(["alert.new", "incident.updated", "health.snapshot", "fleet.connection_changed"], () => {
    void queryClient.invalidateQueries({ queryKey: getGetOperationalDashboardQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetOperationalAlertsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetOperationalIncidentsQueryKey() });
  });

  const { data, isLoading } = useGetOperationalDashboard();
  const d = data as Record<string, unknown> | undefined;

  return (
    <OpsShell
      title="Operations Dashboard"
      description="Real-time platform health — EA fleet, alerts, incidents, and risk signals."
      actions={
        d != null && d.timestamp != null ? (
          <div className="text-[10px] text-cyan-500/70 font-mono flex items-center bg-cyan-950/30 px-2 py-1 rounded border border-cyan-900/30">
            <Clock className="w-3 h-3 mr-1.5" />
            UPDATED: {timeAgo(String(d.timestamp))}
          </div>
        ) : null
      }
    >
      {!isLoading && (
        <div className="space-y-4 sm:space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <StatCard icon={Bell} label="Unack. Alerts" value={d?.unacknowledgedAlerts as number} color="text-yellow-400" />
            <StatCard icon={AlertTriangle} label="Open Incidents" value={d?.openIncidents as number} color="text-red-400" />
            <StatCard icon={AlertTriangle} label="Critical Risk" value={d?.criticalRiskAlerts as number} color="text-red-400" />
            <StatCard icon={Zap} label="Avg VPS Latency" value={d?.avgVpsLatencyMs != null ? `${d.avgVpsLatencyMs as number}ms` : "—"} color="text-blue-400" />
          </div>

          <EAFleetCard data={d} />

          <div className="grid md:grid-cols-2 gap-4">
            <RecentAlertsCard />
            <OpenIncidentsCard />
          </div>
        </div>
      )}
    </OpsShell>
  );
}
