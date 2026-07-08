import { useParams, Link } from "wouter";
import { useGetEa, useGetEaDownloadToken, getGetEaQueryKey } from "@workspace/api-client-react";
import { Download, ArrowLeft, Cpu, Clock } from "lucide-react";

const TIER_COLORS: Record<string, string> = {
  starter: "text-success border-success/30 bg-success/10",
  professional: "text-primary border-primary/30 bg-primary/10",
  enterprise: "text-warning border-warning/30 bg-warning/10",
};
const PLATFORM_LABELS: Record<string, string> = {
  mt4: "MT4 only",
  mt5: "MT5 only",
  both: "MT4 & MT5",
};

export default function EaDetail() {
  const { id } = useParams<{ id: string }>();
  const eaId = Number(id);
  const { data: ea, isLoading } = useGetEa(eaId, { query: { enabled: !!eaId, queryKey: getGetEaQueryKey(eaId) } });
  const downloadToken = useGetEaDownloadToken();

  const handleDownload = () => {
    downloadToken.mutate(
      { id: eaId },
      {
        onSuccess: (data) => {
          alert(`Download token generated!\n\nToken: ${data.token}\nExpires: ${new Date(data.expiresAt).toLocaleString()}\n\nUse this token to authenticate your EA download.`);
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex-1 p-8">
        <div className="max-w-3xl space-y-4 animate-pulse">
          <div className="h-6 bg-secondary rounded w-1/2" />
          <div className="h-4 bg-secondary rounded w-full" />
          <div className="h-4 bg-secondary rounded w-3/4" />
        </div>
      </div>
    );
  }

  if (!ea) {
    return (
      <div className="flex-1 p-8 flex flex-col items-center justify-center text-muted-foreground">
        <Cpu className="w-10 h-10 mb-4 opacity-30" />
        <div>Expert Advisor not found.</div>
        <Link href="/ea" className="mt-4 text-xs text-primary font-mono hover:underline">← Back to library</Link>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-6 border-b border-border flex items-center gap-4">
        <Link href="/ea" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold tracking-tight">{ea.name}</h1>
          <div className="text-xs text-muted-foreground font-mono mt-0.5">v{ea.version}</div>
        </div>
        <button
          onClick={handleDownload}
          disabled={downloadToken.isPending}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-sm text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          Generate download token
        </button>
      </div>

      <div className="p-8 max-w-3xl space-y-8">
        {/* Meta */}
        <div className="border border-border bg-card rounded-sm p-6">
          <div className="grid md:grid-cols-4 gap-6">
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-mono mb-1">Version</div>
              <div className="font-mono font-bold">{ea.version}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-mono mb-1">Platform</div>
              <div className="font-mono">{ea.platform ? (PLATFORM_LABELS[ea.platform] ?? ea.platform) : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-mono mb-1">Required tier</div>
              <span className={`text-xs font-mono border px-2 py-0.5 rounded-sm ${TIER_COLORS[ea.requiredTier] ?? ""}`}>
                {ea.requiredTier.toUpperCase()}
              </span>
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-mono mb-1">Downloads</div>
              <div className="font-mono font-bold">{ea.downloadCount}</div>
            </div>
          </div>
        </div>

        {/* Description */}
        {ea.description && (
          <div>
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">Description</div>
            <div className="text-sm text-foreground leading-relaxed">{ea.description}</div>
          </div>
        )}

        {/* Changelog */}
        {ea.changeLog && (
          <div>
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">Changelog</div>
            <div className="border border-border bg-card rounded-sm p-4 font-mono text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
              {ea.changeLog}
            </div>
          </div>
        )}

        {/* Dates */}
        <div className="flex items-center gap-6 text-xs text-muted-foreground font-mono border-t border-border pt-4">
          {ea.createdAt && (
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              Added {new Date(ea.createdAt).toLocaleDateString()}
            </div>
          )}
          {ea.updatedAt && (
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              Updated {new Date(ea.updatedAt).toLocaleDateString()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
