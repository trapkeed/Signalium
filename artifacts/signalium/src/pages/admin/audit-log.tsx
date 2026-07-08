import { useState } from "react";
import { useListAuditLog } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollText } from "lucide-react";

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
] as const;

function actionVariant(action: string): "default" | "secondary" | "destructive" | "outline" {
  if (action.endsWith("deactivated") || action.endsWith("removed")) return "destructive";
  if (action.endsWith("published") || action.endsWith("activated") || action.endsWith("overridden")) return "default";
  return "secondary";
}

export default function AdminAuditLog() {
  const [action, setAction] = useState<string>("all");
  const [targetType, setTargetType] = useState("");
  const [actorUserId, setActorUserId] = useState("");

  const { data: entries = [] } = useListAuditLog({
    action: action !== "all" ? action : undefined,
    targetType: targetType.trim() || undefined,
    actorUserId: actorUserId.trim() || undefined,
  });

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <ScrollText className="w-5 h-5 text-primary" /> Audit Log
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Platform-wide record of significant admin actions: role changes, subscription/payment overrides, and content publishing.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All actions" /></SelectTrigger>
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
          className="w-56"
        />
        <Input
          placeholder="Filter by actor user ID..."
          value={actorUserId}
          onChange={(e) => setActorUserId(e.target.value)}
          className="w-56"
        />
      </div>

      {entries.length === 0 ? (
        <div className="border border-border rounded-lg p-12 text-center text-sm text-muted-foreground">
          No audit log entries match these filters.
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold">Action</th>
                <th className="text-left px-4 py-2.5 font-semibold">Actor</th>
                <th className="text-left px-4 py-2.5 font-semibold">Target</th>
                <th className="text-left px-4 py-2.5 font-semibold">Detail</th>
                <th className="text-left px-4 py-2.5 font-semibold">Date</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-border align-top">
                  <td className="px-4 py-2.5">
                    <Badge variant={actionVariant(e.action)} className="font-mono text-xs">{e.action}</Badge>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{e.actorUserId}</td>
                  <td className="px-4 py-2.5">
                    <div className="text-xs">{e.targetType}</div>
                    <div className="text-xs font-mono text-muted-foreground">{e.targetId}</div>
                  </td>
                  <td className="px-4 py-2.5 max-w-xs">
                    {e.detail ? (
                      <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">
                        {JSON.stringify(e.detail)}
                      </pre>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
