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

type SecurityIncidentType = "brute_force_auth" | "invalid_webhook_signature" | "api_abuse" | "excessive_ea_requests" | "abnormal_trading_activity";
type SecuritySeverity = "low" | "medium" | "high" | "critical";
type SecurityStatus = "open" | "acknowledged" | "resolved";

const TYPES: SecurityIncidentType[] = ["brute_force_auth", "invalid_webhook_signature", "api_abuse", "excessive_ea_requests", "abnormal_trading_activity"];
const SEVERITIES: SecuritySeverity[] = ["low", "medium", "high", "critical"];
const STATUSES: SecurityStatus[] = ["open", "acknowledged", "resolved"];

const SEV_COLORS: Record<SecuritySeverity, string> = {
  low: "bg-blue-500/10 text-blue-400",
  medium: "bg-yellow-500/10 text-yellow-400",
  high: "bg-orange-500/10 text-orange-400",
  critical: "bg-red-500/10 text-red-400",
};

const STATUS_COLORS: Record<SecurityStatus, string> = {
  open: "bg-red-500/10 text-red-400 border-red-500/20",
  acknowledged: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  resolved: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

function timeAgo(v: string | null | undefined) {
  if (!v) return "—";
  try { return formatDistanceToNow(new Date(v), { addSuffix: true }); } catch { return v; }
}

export default function AdminSecurityOperations() {
  const [type, setType] = useState<string>("all");
  const [severity, setSeverity] = useState<string>("all");
  const [status, setStatus] = useState<string>("open");

  const { data: incidents = [], isLoading } = useListSecurityIncidents({
    type: type !== "all" ? type : undefined,
    severity: severity !== "all" ? severity : undefined,
    status: status !== "all" ? status : undefined,
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateMutation = useUpdateSecurityIncidentStatus({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListSecurityIncidentsQueryKey() });
      },
      onError: () => toast({ title: "Failed to update incident", variant: "destructive" }),
    },
  });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldAlert className="w-6 h-6 text-red-400" />
          Security Operations
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Automated security findings — brute-force auth attempts, invalid webhook signatures, API/EA request abuse, and abnormal trading activity.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All severities" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading && <div className="text-muted-foreground text-sm">Loading…</div>}

      {!isLoading && incidents.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No security incidents match these filters.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {incidents.map((inc) => (
          <Card key={inc.id} className={inc.status === "open" ? "border-red-500/20" : ""}>
            <CardContent className="py-4 px-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <Badge className={`${STATUS_COLORS[inc.status]} border text-xs`}>{inc.status}</Badge>
                    <Badge className={`${SEV_COLORS[inc.severity]} border-0 text-xs`}>{inc.severity}</Badge>
                    <Badge variant="outline" className="text-xs">{inc.type.replace(/_/g, " ")}</Badge>
                  </div>
                  <div className="font-semibold">{inc.message}</div>
                  <div className="text-xs text-muted-foreground mt-2 flex flex-wrap gap-3">
                    {inc.userId && <span>User: <span className="font-mono">{inc.userId}</span></span>}
                    {inc.ipAddress && <span>IP: <span className="font-mono">{inc.ipAddress}</span></span>}
                    {inc.apiKeyId != null && <span>API Key #{inc.apiKeyId}</span>}
                    <span>{timeAgo(inc.createdAt)}</span>
                  </div>
                  {inc.detail && (
                    <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all mt-2 bg-secondary/30 rounded p-2">
                      {JSON.stringify(inc.detail)}
                    </pre>
                  )}
                </div>
                {inc.status !== "resolved" && (
                  <div className="flex gap-1.5 shrink-0">
                    {inc.status === "open" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updateMutation.isPending}
                        onClick={() => updateMutation.mutate({ id: inc.id, data: { status: "acknowledged" } })}
                      >
                        <Eye className="w-3.5 h-3.5 mr-1.5" /> Acknowledge
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={updateMutation.isPending}
                      onClick={() => updateMutation.mutate({ id: inc.id, data: { status: "resolved" } })}
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
    </div>
  );
}
