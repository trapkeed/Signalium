import { useState } from "react";
import {
  useListSecurityIncidents,
  useUpdateSecurityIncidentStatus,
  getListSecurityIncidentsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldAlert, CheckCircle2, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { OpsShell } from "@/components/ops/ops-shell";
import { useOpsRealtimeTypes } from "@/hooks/use-ops-realtime";

type SecurityIncidentType = "brute_force_auth" | "invalid_webhook_signature" | "api_abuse" | "excessive_ea_requests" | "abnormal_trading_activity";
type SecuritySeverity = "low" | "medium" | "high" | "critical";
type SecurityStatus = "open" | "acknowledged" | "resolved";

const TYPES: SecurityIncidentType[] = ["brute_force_auth", "invalid_webhook_signature", "api_abuse", "excessive_ea_requests", "abnormal_trading_activity"];
const SEVERITIES: SecuritySeverity[] = ["low", "medium", "high", "critical"];
const STATUSES: SecurityStatus[] = ["open", "acknowledged", "resolved"];

const SEV_COLORS: Record<SecuritySeverity, string> = {
  low: "bg-cyan-950/50 text-cyan-400",
  medium: "bg-yellow-950/50 text-yellow-400",
  high: "bg-orange-950/50 text-orange-400",
  critical: "bg-red-950/50 text-red-400",
};

const STATUS_COLORS: Record<SecurityStatus, string> = {
  open: "bg-red-950/30 text-red-400 border-red-900/50",
  acknowledged: "bg-yellow-950/30 text-yellow-400 border-yellow-900/50",
  resolved: "bg-emerald-950/30 text-emerald-400 border-emerald-900/50",
};

function timeAgo(v: string | null | undefined) {
  if (!v) return "—";
  try { return formatDistanceToNow(new Date(v), { addSuffix: true }); } catch { return v; }
}

export default function AdminSecurityOperations() {
  const queryClient = useQueryClient();
  useOpsRealtimeTypes(["security_incident.new"], () => {
    void queryClient.invalidateQueries({ queryKey: getListSecurityIncidentsQueryKey() });
  });

  const [type, setType] = useState<string>("all");
  const [severity, setSeverity] = useState<string>("all");
  const [status, setStatus] = useState<string>("open");

  const { data: incidents = [], isLoading } = useListSecurityIncidents({
    type: type !== "all" ? type : undefined,
    severity: severity !== "all" ? severity : undefined,
    status: status !== "all" ? status : undefined,
  });

  const { toast } = useToast();
  const updateMutation = useUpdateSecurityIncidentStatus({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListSecurityIncidentsQueryKey() });
      },
      onError: () => toast({ title: "Failed to update incident", variant: "destructive" }),
    },
  });

  return (
    <OpsShell
      title="Security Operations"
      description="Automated security findings — brute-force auth attempts, invalid webhook signatures, API/EA request abuse, and abnormal trading activity."
    >
      <div className="flex flex-col sm:flex-row flex-wrap gap-3">
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-full sm:w-56 bg-background/50 border-cyan-900/30 text-cyan-50 font-mono text-xs"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="w-full sm:w-44 bg-background/50 border-cyan-900/30 text-cyan-50 font-mono text-xs"><SelectValue placeholder="All severities" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-44 bg-background/50 border-cyan-900/30 text-cyan-50 font-mono text-xs"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading && <div className="text-cyan-500/50 text-sm py-8 text-center font-mono animate-pulse">[ LOADING SECURITY FINDINGS... ]</div>}

      {!isLoading && incidents.length === 0 && (
        <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="w-8 h-8 text-cyan-500/30 mx-auto mb-3" />
            <p className="text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider">[ No security incidents match these filters ]</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {incidents.map((inc) => (
          <Card key={inc.id} className={`border-cyan-900/40 bg-card/50 backdrop-blur ${inc.status === "open" ? "border-red-900/40" : ""}`}>
            <CardContent className="py-4 px-5">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2 font-mono uppercase tracking-wider">
                    <Badge className={`${STATUS_COLORS[inc.status]} border text-[10px]`}>{inc.status}</Badge>
                    <Badge className={`${SEV_COLORS[inc.severity]} border-0 text-[10px]`}>{inc.severity}</Badge>
                    <Badge variant="outline" className="text-[10px] border-cyan-900/50 text-cyan-100/70 bg-background/50">{inc.type.replace(/_/g, " ")}</Badge>
                  </div>
                  <div className="font-semibold text-cyan-50">{inc.message}</div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-500/50 mt-3 flex flex-wrap gap-3">
                    {inc.userId && <span>User: <span className="font-mono text-cyan-500/70">{inc.userId}</span></span>}
                    {inc.ipAddress && <span>IP: <span className="font-mono text-cyan-500/70">{inc.ipAddress}</span></span>}
                    {inc.apiKeyId != null && <span>API Key #{inc.apiKeyId}</span>}
                    <span>{timeAgo(inc.createdAt)}</span>
                  </div>
                  {inc.detail && (
                    <pre className="text-[10px] font-mono text-cyan-100/60 whitespace-pre-wrap break-all mt-3 bg-cyan-950/20 border border-cyan-900/30 rounded p-2">
                      {JSON.stringify(inc.detail, null, 2)}
                    </pre>
                  )}
                </div>
                {inc.status !== "resolved" && (
                  <div className="flex gap-1.5 shrink-0 w-full sm:w-auto justify-end sm:justify-start mt-2 sm:mt-0">
                    {inc.status === "open" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updateMutation.isPending}
                        onClick={() => updateMutation.mutate({ id: inc.id, data: { status: "acknowledged" } })}
                        className="h-8 border-cyan-900/50 text-cyan-50 bg-background/50 hover:bg-cyan-900/20"
                      >
                        <Eye className="w-3.5 h-3.5 mr-1.5" /> Ack
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={updateMutation.isPending}
                      onClick={() => updateMutation.mutate({ id: inc.id, data: { status: "resolved" } })}
                      className="h-8 border-emerald-900/50 text-emerald-400 bg-background/50 hover:bg-emerald-950/40"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Resolve
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </OpsShell>
  );
}
