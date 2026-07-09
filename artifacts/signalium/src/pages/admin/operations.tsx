import { useGetOperationalDashboard, useGetOperationalAlerts, useGetOperationalIncidents, usePostOperationalAlertsIdAcknowledge } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
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
import { getGetOperationalAlertsQueryKey } from "@workspace/api-client-react";

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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          EA Fleet
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
          <div className="text-center p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <Wifi className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
            <div className="text-2xl font-bold text-emerald-400">{instances.online}</div>
            <div className="text-xs text-muted-foreground">Online</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <Minus className="w-4 h-4 text-yellow-400 mx-auto mb-1" />
            <div className="text-2xl font-bold text-yellow-400">{instances.degraded}</div>
            <div className="text-xs text-muted-foreground">Degraded</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <WifiOff className="w-4 h-4 text-red-400 mx-auto mb-1" />
            <div className="text-2xl font-bold text-red-400">{instances.offline}</div>
            <div className="text-xs text-muted-foreground">Offline</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
            <CheckCircle2 className="w-4 h-4 text-orange-400 mx-auto mb-1" />
            <div className="text-2xl font-bold text-orange-400">{instances.unauthorized ?? 0}</div>
            <div className="text-xs text-muted-foreground">Unauth.</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <Zap className="w-4 h-4 text-purple-400 mx-auto mb-1" />
            <div className="text-2xl font-bold text-purple-400">{instances.outdated ?? 0}</div>
            <div className="text-xs text-muted-foreground">Outdated</div>
          </div>
        </div>
        <div className="mt-3 text-center text-xs text-muted-foreground">
          {instances.total} total registered instances
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
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg bg-primary/10`}>
            <Icon className={`w-4 h-4 ${color ?? "text-primary"}`} />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-xl font-bold">{value ?? "—"}</div>
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
    },
  });

  if (isLoading) return null;

  const alerts = ((data as Record<string, unknown>)?.alerts as Array<Record<string, unknown>>) ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Bell className="w-4 h-4 text-yellow-400" />
          Active Alerts
          {alerts.length > 0 && (
            <Badge variant="destructive" className="ml-auto text-xs">{alerts.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-emerald-400 py-2">
            <CheckCircle2 className="w-4 h-4" />
            All clear — no unacknowledged alerts
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((a) => (
              <div key={a.id as number} className={`flex items-start justify-between gap-3 p-3 rounded-lg border ${SEVERITY_COLORS[a.severity as AlertSeverity] ?? ""}`}>
                <div className="min-w-0">
                  <div className="text-xs font-medium capitalize">{(a.type as string).replace(/_/g, " ")}</div>
                  <div className="text-xs mt-0.5 opacity-80 truncate">{a.message as string}</div>
                  <div className="text-xs mt-0.5 opacity-60">{timeAgo(a.createdAt as string)}</div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 h-7 text-xs"
                  onClick={() => ackMutation.mutate({ id: a.id as number })}
                  disabled={ackMutation.isPending}
                >
                  <BellOff className="w-3 h-3" />
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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          Open Incidents
          {all.length > 0 && (
            <Badge variant="destructive" className="ml-auto text-xs">{all.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {all.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-emerald-400 py-2">
            <CheckCircle2 className="w-4 h-4" />
            No open incidents
          </div>
        ) : (
          <div className="space-y-2">
            {all.map((inc) => (
              <div key={inc.id as number} className="p-3 rounded-lg border border-border/50">
                <div className="flex items-start gap-2">
                  <Badge className={`${INCIDENT_STATUS_COLORS[inc.status as IncidentStatus] ?? ""} text-xs border-0 shrink-0`}>
                    {(inc.status as string).replace(/_/g, " ")}
                  </Badge>
                  <Badge className={`${INC_SEV_COLORS[inc.severity as IncidentSeverity] ?? ""} text-xs border-0 shrink-0`}>
                    {inc.severity as string}
                  </Badge>
                </div>
                <div className="text-sm font-medium mt-1.5">{inc.title as string}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {inc.category as string} · {timeAgo(inc.createdAt as string)}
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
  const { data, isLoading } = useGetOperationalDashboard();
  const d = data as Record<string, unknown> | undefined;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Server className="w-6 h-6 text-primary" />
          Operations Dashboard
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Real-time platform health — EA fleet, alerts, incidents, and risk signals.
        </p>
        {d != null && d.timestamp != null && (
          <p className="text-xs text-muted-foreground mt-0.5">
            <Clock className="w-3 h-3 inline mr-1" />
            Last updated {timeAgo(String(d.timestamp))}
          </p>
        )}
      </div>

      {!isLoading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
        </>
      )}
    </div>
  );
}
