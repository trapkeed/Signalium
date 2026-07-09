import { useState } from "react";
import { useListAuditLog, getListAuditLogQueryKey } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { OpsShell } from "@/components/ops/ops-shell";
import { useOpsRealtime } from "@/hooks/use-ops-realtime";
import { useQueryClient } from "@tanstack/react-query";

const ACTIONS = [
  "user.role_changed",
  "user.deactivated",
  "user.activated",
  "subscription.overridden",
  "payment.overridden",
  "announcement.published",
  "announcement.unpublished",
  "knowledge_base.published",
  "knowledge_base.unpublished",
  "maintenance_banner.updated",
  "referral.removed",
  "api_key.created",
  "api_key.revoked",
  "api_key.rotated",
  "api_key.suspended",
  "api_key.reactivated",
  "ea_registration.created",
  "ea_registration.deactivated",
  "model_request.action_issued",
  "security_incident.acknowledged",
  "security_incident.resolved",
  "admin_secret.rotated",
  "admin_secret.disabled",
  "admin_secret.enabled",
] as const;

function actionVariant(action: string): "default" | "secondary" | "destructive" | "outline" {
  if (action.endsWith("deactivated") || action.endsWith("removed")) return "destructive";
  if (action.endsWith("published") || action.endsWith("activated") || action.endsWith("overridden")) return "default";
  return "outline";
}

export default function AdminAuditLog() {
  const queryClient = useQueryClient();
  useOpsRealtime(() => {
    // If any event comes in, the easiest safe approach is to just refetch audit logs
    // since we don't have a specific event for everything yet, but we want the list to be fresh.
    void queryClient.invalidateQueries({ queryKey: getListAuditLogQueryKey() });
  });

  const [action, setAction] = useState<string>("all");
  const [targetType, setTargetType] = useState("");
  const [actorUserId, setActorUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: entries = [] } = useListAuditLog({
    action: action !== "all" ? action : undefined,
    targetType: targetType.trim() || undefined,
    actorUserId: actorUserId.trim() || undefined,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
  });

  return (
    <OpsShell
      title="Audit Log"
      description="Platform-wide record of significant admin actions: role changes, subscription/payment overrides, and content publishing."
    >
      <div className="flex flex-col sm:flex-row flex-wrap gap-3 mb-6">
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-full sm:w-56 bg-background/50 border-cyan-900/30 text-cyan-50 font-mono text-xs"><SelectValue placeholder="All actions" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Filter by target type..."
          value={targetType}
          onChange={(e) => setTargetType(e.target.value)}
          className="w-full sm:w-56 bg-background/50 border-cyan-900/30 text-cyan-50 placeholder:text-cyan-500/50 font-mono text-xs"
        />
        <Input
          placeholder="Filter by actor user ID..."
          value={actorUserId}
          onChange={(e) => setActorUserId(e.target.value)}
          className="w-full sm:w-56 bg-background/50 border-cyan-900/30 text-cyan-50 placeholder:text-cyan-500/50 font-mono text-xs"
        />
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="w-full sm:w-40 bg-background/50 border-cyan-900/30 text-cyan-50 placeholder:text-cyan-500/50 font-mono text-xs"
          aria-label="From date"
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="w-full sm:w-40 bg-background/50 border-cyan-900/30 text-cyan-50 placeholder:text-cyan-500/50 font-mono text-xs"
          aria-label="To date"
        />
      </div>

      {entries.length === 0 ? (
        <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardContent className="py-12 text-center text-cyan-500/50 text-[11px] font-mono uppercase tracking-wider">
            [ No audit log entries match these filters ]
          </CardContent>
        </Card>
      ) : (
        <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-cyan-100/50 border-b border-cyan-900/30 bg-background/50">
                    <th className="px-4 py-2.5 font-semibold">Action</th>
                    <th className="px-4 py-2.5 font-semibold">Actor</th>
                    <th className="px-4 py-2.5 font-semibold">Target</th>
                    <th className="px-4 py-2.5 font-semibold">Detail</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Date</th>
                  </tr>
                </thead>
                <tbody className="text-[11px]">
                  {entries.map((e) => (
                    <tr key={e.id} className="border-b border-cyan-900/10 hover:bg-cyan-950/20 transition-colors align-top text-cyan-100">
                      <td className="px-4 py-3">
                        <Badge variant={actionVariant(e.action)} className={`font-mono text-[10px] uppercase tracking-wider ${actionVariant(e.action) === "outline" ? "border-cyan-900/50 text-cyan-500/70 bg-background/50" : ""}`}>{e.action}</Badge>
                      </td>
                      <td className="px-4 py-3 text-cyan-500/70 truncate max-w-[120px]" title={e.actorUserId}>{e.actorUserId}</td>
                      <td className="px-4 py-3">
                        <div className="text-cyan-50 font-bold uppercase tracking-wider text-[10px]">{e.targetType}</div>
                        <div className="text-[10px] text-cyan-500/50 truncate max-w-[120px] mt-0.5" title={e.targetId}>{e.targetId}</div>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        {e.detail ? (
                          <pre className="text-[10px] text-cyan-100/60 whitespace-pre-wrap break-all bg-cyan-950/20 border border-cyan-900/30 rounded p-1.5">
                            {JSON.stringify(e.detail, null, 2)}
                          </pre>
                        ) : (
                          <span className="text-cyan-500/50">—</span>
                        )}
                      </td>
                      <td className="text-right px-4 py-3 text-cyan-500/70 whitespace-nowrap">
                        {new Date(e.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </OpsShell>
  );
}
