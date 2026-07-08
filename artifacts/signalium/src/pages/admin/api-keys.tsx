import { useState } from "react";
import {
  useListAllApiKeys,
  useGetApiKeySecurityReport,
  useRevokeApiKey,
  useSuspendApiKey,
  useReactivateApiKey,
  useListApiKeyRegistrations,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle, Clock, XCircle, ShieldAlert, Ban, RotateCcw, Trash2, Monitor, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type ApiKeyStatus = "active" | "revoked" | "expired" | "suspended";

const STATUS_STYLES: Record<ApiKeyStatus, string> = {
  active: "text-primary",
  revoked: "text-muted-foreground",
  expired: "text-yellow-500",
  suspended: "text-destructive",
};

const STATUS_ICONS: Record<ApiKeyStatus, typeof CheckCircle> = {
  active: CheckCircle,
  revoked: XCircle,
  expired: Clock,
  suspended: AlertTriangle,
};

function StatusBadge({ status }: { status: string }) {
  const s = (status as ApiKeyStatus) in STATUS_STYLES ? (status as ApiKeyStatus) : "revoked";
  const Icon = STATUS_ICONS[s];
  return (
    <span className={cn("flex items-center gap-1 text-xs font-mono", STATUS_STYLES[s])}>
      <Icon className="w-3 h-3" /> {status}
    </span>
  );
}

function TerminalsRow({ apiKeyId }: { apiKeyId: number }) {
  const { data: registrations = [] } = useListApiKeyRegistrations(apiKeyId);

  if (registrations.length === 0) {
    return <div className="px-4 py-4 text-xs text-muted-foreground font-mono">No EA terminals registered.</div>;
  }

  return (
    <div className="px-4 py-3 flex flex-col gap-2">
      {registrations.map((reg) => (
        <div key={reg.id} className="flex items-center gap-3 border border-border rounded-sm px-3 py-2 bg-background/50">
          <Monitor className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-mono truncate">
              {reg.mt5Account ?? "unknown account"} · {reg.brokerName ?? "unknown broker"} · {reg.brokerServer ?? "?"}
            </div>
            <div className="text-[11px] text-muted-foreground font-mono truncate">
              hw:{reg.hardwareId.slice(0, 16)} · build {reg.terminalBuild ?? "?"} · platform {reg.platformVersion ?? "?"} · seen {new Date(reg.lastSeenAt).toLocaleString()}
            </div>
          </div>
          <span className={cn("text-xs font-mono shrink-0", reg.isActive ? "text-primary" : "text-muted-foreground")}>
            {reg.isActive ? "active" : "inactive"}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function AdminApiKeys() {
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: keys = [], refetch } = useListAllApiKeys();
  const { data: report } = useGetApiKeySecurityReport();
  const revokeKey = useRevokeApiKey();
  const suspendKey = useSuspendApiKey();
  const reactivateKey = useReactivateApiKey();

  async function handleRevoke(id: number) {
    try {
      await revokeKey.mutateAsync({ id });
      toast({ title: "API key revoked" });
      refetch();
    } catch {
      toast({ title: "Failed to revoke API key", variant: "destructive" });
    }
  }

  async function handleSuspend(id: number) {
    try {
      await suspendKey.mutateAsync({ id });
      toast({ title: "API key suspended" });
      refetch();
    } catch {
      toast({ title: "Failed to suspend API key", variant: "destructive" });
    }
  }

  async function handleReactivate(id: number) {
    try {
      await reactivateKey.mutateAsync({ id });
      toast({ title: "API key reactivated" });
      refetch();
    } catch {
      toast({ title: "Failed to reactivate API key", variant: "destructive" });
    }
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-xl font-bold font-mono tracking-tight">API Key Management</h1>
        <p className="text-sm text-muted-foreground mt-1">Review, revoke, suspend, and audit customer API keys and EA terminals</p>
      </div>

      <div className="flex-1 p-8 max-w-6xl">
        <Tabs defaultValue="keys">
          <TabsList className="rounded-sm mb-6 bg-secondary/50 border border-border">
            <TabsTrigger value="keys" className="rounded-sm font-mono text-xs">All Keys</TabsTrigger>
            <TabsTrigger value="security" className="rounded-sm font-mono text-xs">
              Security Report
              {report && (report.expiringSoon.length + report.staleActiveKeys.length + report.multiHardwareAnomalies.length) > 0 && (
                <span className="ml-2 bg-destructive text-destructive-foreground text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {report.expiringSoon.length + report.staleActiveKeys.length + report.multiHardwareAnomalies.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="keys">
            <div className="border border-border rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    {["User", "Name", "Key", "Status", "Terminals", "Expires", "Last Used", "Actions"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {keys.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">No API keys yet</td></tr>
                  ) : (
                    keys.map((key) => (
                      <>
                        <tr key={key.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-[120px] truncate">{key.userId}</td>
                          <td className="px-4 py-3 font-medium">
                            <button
                              className="flex items-center gap-1.5"
                              onClick={() => setExpandedId(expandedId === key.id ? null : key.id)}
                            >
                              {expandedId === key.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              {key.name}
                            </button>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{key.keyPrefix}</td>
                          <td className="px-4 py-3"><StatusBadge status={key.status} /></td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{key.registrationCount ?? 0}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                            {key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : "never"}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                            {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "never"}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 justify-end">
                              {key.status === "suspended" ? (
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-sm text-primary" onClick={() => handleReactivate(key.id)} title="Reactivate">
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </Button>
                              ) : key.status === "active" ? (
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-sm text-yellow-500 hover:text-yellow-500" onClick={() => handleSuspend(key.id)} title="Suspend (disable compromised key)">
                                  <Ban className="w-3.5 h-3.5" />
                                </Button>
                              ) : null}
                              {key.status !== "revoked" && (
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-sm text-destructive hover:text-destructive" onClick={() => handleRevoke(key.id)} title="Revoke">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expandedId === key.id && (
                          <tr className="bg-secondary/10">
                            <td colSpan={8} className="p-0">
                              <TerminalsRow apiKeyId={key.id} />
                            </td>
                          </tr>
                        )}
                      </>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="security">
            {!report ? (
              <div className="text-muted-foreground text-sm font-mono">Loading...</div>
            ) : (
              <div className="flex flex-col gap-6">
                <div className="grid grid-cols-4 gap-4">
                  {Object.entries(report.statusBreakdown).map(([status, cnt]) => (
                    <div key={status} className="border border-border rounded-sm bg-card p-4">
                      <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-1">{status}</div>
                      <div className="text-2xl font-bold font-mono">{cnt}</div>
                    </div>
                  ))}
                </div>

                <div className="border border-border rounded-sm bg-card p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Clock className="w-4 h-4 text-yellow-500" />
                    <h3 className="font-mono text-sm font-bold">Expiring within 7 days</h3>
                  </div>
                  {report.expiringSoon.length === 0 ? (
                    <div className="text-xs text-muted-foreground font-mono">None</div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {report.expiringSoon.map((k: any) => (
                        <div key={k.id} className="text-xs font-mono flex justify-between border-b border-border last:border-0 pb-2 last:pb-0">
                          <span>{k.name} ({k.userId})</span>
                          <span className="text-yellow-500">{k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : "—"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border border-border rounded-sm bg-card p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                    <h3 className="font-mono text-sm font-bold">Stale active keys (unused 30+ days)</h3>
                  </div>
                  {report.staleActiveKeys.length === 0 ? (
                    <div className="text-xs text-muted-foreground font-mono">None</div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {report.staleActiveKeys.map((k: any) => (
                        <div key={k.id} className="text-xs font-mono flex justify-between border-b border-border last:border-0 pb-2 last:pb-0">
                          <span>{k.name} ({k.userId})</span>
                          <span className="text-muted-foreground">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : "never"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border border-destructive/30 rounded-sm bg-destructive/5 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <ShieldAlert className="w-4 h-4 text-destructive" />
                    <h3 className="font-mono text-sm font-bold">Multi-hardware anomalies (possible key sharing/leak)</h3>
                  </div>
                  {report.multiHardwareAnomalies.length === 0 ? (
                    <div className="text-xs text-muted-foreground font-mono">None</div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {report.multiHardwareAnomalies.map((a) => (
                        <div key={a.apiKeyId} className="text-xs font-mono flex justify-between border-b border-border last:border-0 pb-2 last:pb-0">
                          <span>API Key #{a.apiKeyId}</span>
                          <span className="text-destructive">{a.distinctHardwareCount} distinct terminals</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
