import { useState } from "react";
import {
  useListMyEaBuilds,
  useGenerateEaBuild,
  useRegenerateEaBuild,
  useRevokeEaBuild,
  useGetEaBuildAudit,
  downloadEaBuild,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  Download,
  RefreshCw,
  Trash2,
  ShieldCheck,
  XCircle,
  History,
  ChevronDown,
  ChevronUp,
  Cpu,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
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

function AuditRow({ buildId }: { buildId: string }) {
  const { data: entries = [] } = useGetEaBuildAudit(buildId);

  if (entries.length === 0) {
    return <div className="px-4 py-4 text-xs text-muted-foreground font-mono">No audit history yet.</div>;
  }

  return (
    <div className="px-4 py-3 flex flex-col gap-2">
      {entries.map((entry) => (
        <div key={entry.id} className="flex items-center justify-between border border-border rounded-lg px-3 py-2 bg-background/50 text-xs font-mono">
          <span className="capitalize">{entry.action}</span>
          <span className="text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export default function EaBuilds() {
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const { data: builds = [], isLoading, refetch, error } = useListMyEaBuilds();
  const generate = useGenerateEaBuild();
  const regenerate = useRegenerateEaBuild();
  const revoke = useRevokeEaBuild();

  async function handleGenerate() {
    try {
      await generate.mutateAsync();
      toast({ title: "EA build generated" });
      refetch();
    } catch (err: any) {
      toast({ title: "Failed to generate EA build", description: err?.message, variant: "destructive" });
    }
  }

  async function handleRegenerate(buildId: string) {
    try {
      await regenerate.mutateAsync({ buildId });
      toast({ title: "EA build regenerated" });
      refetch();
    } catch (err: any) {
      toast({ title: "Failed to regenerate EA build", description: err?.message, variant: "destructive" });
    }
  }

  async function handleRevoke(buildId: string) {
    try {
      await revoke.mutateAsync({ buildId });
      toast({ title: "EA build revoked" });
      refetch();
    } catch (err: any) {
      toast({ title: "Failed to revoke EA build", description: err?.message, variant: "destructive" });
    }
  }

  async function handleDownload(buildId: string, fileName: string) {
    setDownloadingId(builds.find((b) => b.buildId === buildId)?.id ?? null);
    try {
      const blob = await downloadEaBuild(buildId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      refetch();
    } catch (err: any) {
      toast({ title: "Failed to download EA build", description: err?.message, variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">EA Builds</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generate your personal, uniquely-signed MT5 Expert Advisor
          </p>
        </div>
        <Button onClick={handleGenerate} disabled={generate.isPending} className="gap-2 text-sm rounded-lg">
          <Cpu className="w-4 h-4" />
          {generate.isPending ? "Generating..." : "Generate EA"}
        </Button>
      </div>

      <div className="p-8 max-w-4xl flex flex-col gap-6">
        <div className="border border-border bg-card rounded-lg p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <div className="text-sm text-muted-foreground leading-relaxed">
              Each build is uniquely named to your account (
              <code className="font-mono text-xs bg-secondary px-1 py-0.5 rounded">Signalium_&lt;username&gt;_MT5.ex5</code>
              ) and signed with your subscription tier and API key hash — never your raw API key. Regenerating
              supersedes the previous build; revoking disables it immediately.
            </div>
          </div>
        </div>

        {error && (
          <Alert variant="destructive" className="rounded-lg">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription className="text-xs">
              {(error as any)?.message ?? "Failed to load EA builds"}
            </AlertDescription>
          </Alert>
        )}

        <div className="border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">File</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tier</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Downloads</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Generated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground text-sm">
                    Loading...
                  </td>
                </tr>
              ) : builds.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground text-sm">
                    No EA builds yet. Generate one to get started.
                  </td>
                </tr>
              ) : (
                builds.map((build) => (
                  <>
                    <tr key={build.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                      <td className="px-4 py-3 font-medium">
                        <button
                          className="flex items-center gap-1.5 text-sm font-medium"
                          onClick={() => setExpandedId(expandedId === build.id ? null : build.id)}
                        >
                          {expandedId === build.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          {build.fileName}
                        </button>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={build.status} /></td>
                      <td className="px-4 py-3 text-xs font-mono text-muted-foreground capitalize">{build.subscriptionTier}</td>
                      <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{build.downloadCount}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                        {new Date(build.generatedAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          {build.status !== "revoked" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 rounded-lg"
                              onClick={() => handleDownload(build.buildId, build.fileName)}
                              disabled={downloadingId === build.id}
                              title="Download"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {build.status === "active" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 rounded-lg"
                              onClick={() => handleRegenerate(build.buildId)}
                              title="Regenerate (rotates build, supersedes this one)"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {build.status === "active" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive h-7 w-7 p-0 rounded-lg"
                              onClick={() => handleRevoke(build.buildId)}
                              title="Revoke"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedId === build.id && (
                      <tr className="bg-secondary/10">
                        <td colSpan={6} className="p-0">
                          <AuditRow buildId={build.buildId} />
                        </td>
                      </tr>
                    )}
                  </>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </div>
  );
}
