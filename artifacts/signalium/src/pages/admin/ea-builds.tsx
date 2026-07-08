import { useState } from "react";
import { useListAllEaBuilds, useGetGlobalEaBuildAuditLog } from "@workspace/api-client-react";
import { ShieldCheck, XCircle, History, ChevronDown, ChevronUp, ScrollText } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type BuildStatus = "active" | "revoked" | "superseded";

const STATUS_STYLES: Record<BuildStatus, string> = {
  active: "text-primary",
  revoked: "text-destructive",
  superseded: "text-muted-foreground",
};

const STATUS_ICONS: Record<BuildStatus, typeof ShieldCheck> = {
  active: ShieldCheck,
  revoked: XCircle,
  superseded: History,
};

function StatusBadge({ status }: { status: string }) {
  const s = (status as BuildStatus) in STATUS_STYLES ? (status as BuildStatus) : "superseded";
  const Icon = STATUS_ICONS[s];
  return (
    <span className={cn("flex items-center gap-1 text-xs font-mono", STATUS_STYLES[s])}>
      <Icon className="w-3 h-3" /> {status}
    </span>
  );
}

export default function AdminEaBuilds() {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { data: builds = [], isLoading } = useListAllEaBuilds();
  const { data: auditLog = [] } = useGetGlobalEaBuildAuditLog();

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-xl font-bold font-mono tracking-tight">EA Build Management</h1>
        <p className="text-sm text-muted-foreground mt-1">Review generated Expert Advisor builds and their audit trail across all users</p>
      </div>

      <div className="flex-1 p-8 max-w-6xl">
        <Tabs defaultValue="builds">
          <TabsList className="rounded-sm mb-6 bg-secondary/50 border border-border">
            <TabsTrigger value="builds" className="rounded-sm font-mono text-xs">All Builds</TabsTrigger>
            <TabsTrigger value="audit" className="rounded-sm font-mono text-xs">
              Audit Log
              {auditLog.length > 0 && (
                <span className="ml-2 bg-secondary text-muted-foreground text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {auditLog.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="builds">
            <div className="border border-border rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    {["User", "File", "Status", "Tier", "Platform", "Downloads", "Generated"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">Loading...</td></tr>
                  ) : builds.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">No EA builds generated yet</td></tr>
                  ) : (
                    builds.map((build) => (
                      <>
                        <tr key={build.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-[120px] truncate">{build.userId}</td>
                          <td className="px-4 py-3 font-medium">
                            <button
                              className="flex items-center gap-1.5 font-mono text-xs"
                              onClick={() => setExpandedId(expandedId === build.id ? null : build.id)}
                            >
                              {expandedId === build.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              {build.fileName}
                            </button>
                          </td>
                          <td className="px-4 py-3"><StatusBadge status={build.status} /></td>
                          <td className="px-4 py-3 text-xs font-mono text-muted-foreground capitalize">{build.subscriptionTier}</td>
                          <td className="px-4 py-3 text-xs font-mono text-muted-foreground uppercase">{build.platform}</td>
                          <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{build.downloadCount}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                            {new Date(build.generatedAt).toLocaleDateString()}
                          </td>
                        </tr>
                        {expandedId === build.id && (
                          <tr className="bg-secondary/10">
                            <td colSpan={7} className="px-4 py-3">
                              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono text-muted-foreground">
                                <div>build id: <span className="text-foreground">{build.buildId}</span></div>
                                <div>checksum: <span className="text-foreground">{build.checksum.slice(0, 24)}…</span></div>
                                <div>api key hash: <span className="text-foreground">{build.metadata.apiKeyHash.slice(0, 24)}…</span></div>
                                <div>platform version: <span className="text-foreground">{build.metadata.platformVersion}</span></div>
                                <div>last downloaded: <span className="text-foreground">{build.lastDownloadedAt ? new Date(build.lastDownloadedAt).toLocaleString() : "never"}</span></div>
                                <div>revoked at: <span className="text-foreground">{build.revokedAt ? new Date(build.revokedAt).toLocaleString() : "—"}</span></div>
                              </div>
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

          <TabsContent value="audit">
            <div className="border border-border rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    {["User", "File", "Action", "When"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {auditLog.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">
                        <div className="flex flex-col items-center gap-2">
                          <ScrollText className="w-5 h-5" />
                          No audit entries yet
                        </div>
                      </td>
                    </tr>
                  ) : (
                    auditLog.map((entry) => (
                      <tr key={entry.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-[120px] truncate">{entry.userId}</td>
                        <td className="px-4 py-3 font-mono text-xs">{entry.fileName ?? entry.buildIdentifier}</td>
                        <td className="px-4 py-3 font-mono text-xs capitalize">{entry.action}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{new Date(entry.createdAt).toLocaleString()}</td>
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
