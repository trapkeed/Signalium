import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, RefreshCw, ShieldCheck, Radio, AlertTriangle } from "lucide-react";

const BASE = (import.meta as any).env?.BASE_URL ?? "/";

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}api/admin/secrets${path}`, {
    credentials: "include",
    headers: { "x-requested-with": "XMLHttpRequest" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

interface SyncStatus {
  trainer: {
    configured: boolean;
    reachable: boolean;
    latencyMs: number | null;
    error: string | null;
    checkedAt: string;
  };
  failureState: { consecutiveFailures: number; lastFailureAt: string | null };
  configVersionHash: string;
  trainerRelevantKeyCount: number;
  note: string;
}

export default function AdminSyncStatus() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function refresh() {
    setLoading(true);
    api<SyncStatus>("/sync-status")
      .then(setStatus)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight">Trainer Sync Status</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Read-only reachability and configuration-drift view for the signalium-trainer service.
          </p>
        </div>
        <Button variant="outline" size="sm" className="font-mono text-xs gap-1.5" onClick={refresh} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="flex-1 p-8 max-w-3xl flex flex-col gap-6">
      <div className="flex items-start gap-2 rounded-sm bg-cyan-500/10 border border-cyan-500/30 px-4 py-3">
        <ShieldCheck className="h-3.5 w-3.5 text-cyan-500 mt-0.5 shrink-0" />
        <p className="text-xs font-mono text-cyan-600 dark:text-cyan-400">
          Signalium never transmits secret values to the trainer. This page only reports reachability and a hash
          of non-secret, trainer-relevant configuration so drift is visible without exposing credentials.
        </p>
      </div>

      {error && <div className="text-sm text-destructive font-mono">{error}</div>}

      {!status ? (
        <div className="text-sm text-muted-foreground font-mono">Loading…</div>
      ) : (
        <>
          <div className="border border-border rounded-sm bg-card p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5" /> Trainer Connection
              </span>
              {!status.trainer.configured ? (
                <span className="flex items-center gap-1 text-xs font-mono text-muted-foreground"><XCircle className="w-3 h-3" /> not configured</span>
              ) : status.trainer.reachable ? (
                <span className="flex items-center gap-1 text-xs font-mono text-success"><CheckCircle2 className="w-3 h-3" /> reachable</span>
              ) : (
                <span className="flex items-center gap-1 text-xs font-mono text-destructive"><AlertTriangle className="w-3 h-3" /> unreachable</span>
              )}
            </div>
            {status.trainer.configured && (
              <>
                <div className="font-mono text-xs text-muted-foreground">latency: {status.trainer.latencyMs != null ? `${status.trainer.latencyMs}ms` : "—"}</div>
                {status.trainer.error && <div className="font-mono text-xs text-destructive">error: {status.trainer.error}</div>}
                <div className="font-mono text-xs text-muted-foreground">checked: {new Date(status.trainer.checkedAt).toLocaleString()}</div>
              </>
            )}
            {!status.trainer.configured && (
              <div className="font-mono text-xs text-muted-foreground">
                Set trainer.url in the Secrets Vault (or QDE_TRAINER_URL env var) to enable sync.
              </div>
            )}
          </div>

          <div className="border border-border rounded-sm bg-card p-4 flex flex-col gap-2">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Circuit breaker</span>
            <div className="font-mono text-xs">consecutive failures: {status.failureState.consecutiveFailures}</div>
            <div className="font-mono text-xs text-muted-foreground">
              last failure: {status.failureState.lastFailureAt ? new Date(status.failureState.lastFailureAt).toLocaleString() : "none"}
            </div>
          </div>

          <div className="border border-border rounded-sm bg-card p-4 flex flex-col gap-2">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Config version</span>
            <div className="font-mono text-xs">hash: {status.configVersionHash}</div>
            <div className="font-mono text-xs text-muted-foreground">
              computed over {status.trainerRelevantKeyCount} non-secret, trainer-relevant keys
            </div>
          </div>
        </>
      )}
      </div>
    </div>
  );
}
