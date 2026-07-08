import { useListEas, useGetEaDownloadToken, useGetMySubscription } from "@workspace/api-client-react";
import { Download, Cpu, Lock } from "lucide-react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getListEasQueryKey } from "@workspace/api-client-react";

const TIER_ORDER = { starter: 0, professional: 1, enterprise: 2 };
const TIER_COLORS: Record<string, string> = {
  starter: "text-success border-success/30 bg-success/10",
  professional: "text-primary border-primary/30 bg-primary/10",
  enterprise: "text-warning border-warning/30 bg-warning/10",
};
const PLATFORM_LABELS: Record<string, string> = {
  mt4: "MT4",
  mt5: "MT5",
  both: "MT4 & MT5",
};

export default function EaList() {
  const { data: eas, isLoading } = useListEas();
  const { data: subscription } = useGetMySubscription();
  const downloadToken = useGetEaDownloadToken();

  const userTier = subscription?.plan?.tier ?? "none";
  const canAccess = (required: string) => {
    if (!subscription || subscription.status !== "active") return false;
    return TIER_ORDER[userTier as keyof typeof TIER_ORDER] >= TIER_ORDER[required as keyof typeof TIER_ORDER];
  };

  const handleDownload = (eaId: number) => {
    downloadToken.mutate(
      { id: eaId },
      {
        onSuccess: (data) => {
          alert(`Download token generated: ${data.token}\nExpires: ${new Date(data.expiresAt).toLocaleString()}`);
        },
      }
    );
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-6 border-b border-border">
        <h1 className="text-xl font-bold tracking-tight">EA Library</h1>
        <p className="text-xs text-muted-foreground mt-0.5 font-mono">Expert Advisors available on your subscription</p>
      </div>

      <div className="p-8">
        {isLoading ? (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="border border-border bg-card rounded-sm p-6 animate-pulse">
                <div className="h-4 bg-secondary rounded w-1/2 mb-3" />
                <div className="h-3 bg-secondary rounded w-full mb-2" />
                <div className="h-3 bg-secondary rounded w-3/4" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {eas?.filter(ea => ea.isActive).map((ea) => {
              const accessible = canAccess(ea.requiredTier);
              return (
                <div
                  key={ea.id}
                  className={`border bg-card rounded-sm p-6 flex flex-col gap-4 transition-colors ${accessible ? "border-border hover:border-primary/30" : "border-border opacity-70"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{ea.name}</div>
                      <div className="text-xs font-mono text-muted-foreground mt-0.5">v{ea.version}</div>
                    </div>
                    {!accessible && <Lock className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />}
                  </div>

                  <div className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                    {ea.description ?? "No description available."}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <span className={`text-xs font-mono border px-2 py-0.5 rounded-sm ${TIER_COLORS[ea.requiredTier]}`}>
                      {ea.requiredTier.toUpperCase()}
                    </span>
                    <span className="text-xs font-mono border border-border bg-secondary px-2 py-0.5 rounded-sm text-muted-foreground">
                      {ea.platform ? (PLATFORM_LABELS[ea.platform] ?? ea.platform) : "—"}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground ml-auto">
                      {ea.downloadCount} downloads
                    </span>
                  </div>

                  <div className="flex items-center gap-3 pt-2 border-t border-border">
                    <Link
                      href={`/ea/${ea.id}`}
                      className="text-xs text-primary hover:underline font-mono"
                    >
                      Details →
                    </Link>
                    <button
                      onClick={() => handleDownload(ea.id)}
                      disabled={!accessible || downloadToken.isPending}
                      className={`ml-auto flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-sm transition-colors ${
                        accessible
                          ? "bg-primary text-primary-foreground hover:bg-primary/90"
                          : "bg-secondary text-muted-foreground cursor-not-allowed"
                      }`}
                    >
                      <Download className="w-3.5 h-3.5" />
                      {accessible ? "Download" : "Upgrade required"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {eas?.length === 0 && (
          <div className="border border-border bg-card rounded-sm p-12 text-center text-muted-foreground">
            <Cpu className="w-8 h-8 mx-auto mb-3 opacity-30" />
            No Expert Advisors available yet.
          </div>
        )}
      </div>
    </div>
  );
}
