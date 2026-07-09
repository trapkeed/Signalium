import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, RefreshCw, ExternalLink, ShieldAlert } from "lucide-react";

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

interface SettingStatus {
  key: string;
  category: string;
  description: string;
  managePath: string;
  trainerRelevant: boolean;
  configured: boolean;
  configuredVia: "vault" | "env" | null;
  vaultDisabled: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  auth: "Auth & SSO",
  payments: "Payments",
  email: "Email",
  infra: "Infrastructure",
  ai: "AI",
  trainer: "Trainer",
  market_data: "Market Data",
  runpod: "RunPod",
  ea_feed: "EA Feed",
  other: "Other",
};

export default function AdminSystemSettings() {
  const [rows, setRows] = useState<SettingStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function refresh() {
    setLoading(true);
    api<SettingStatus[]>("/settings-status")
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { refresh(); }, []);

  const grouped = useMemo(() => {
    const g: Record<string, SettingStatus[]> = {};
    for (const row of rows ?? []) (g[row.category] ??= []).push(row);
    return g;
  }, [rows]);

  const total = rows?.length ?? 0;
  const configuredCount = rows?.filter((r) => r.configured).length ?? 0;

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight">System Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            A consolidated view of every configuration domain the platform reads — whether it's backed by the
            managed secrets vault or a process environment variable. This page never displays secret values.
          </p>
        </div>
        <Button variant="outline" size="sm" className="font-mono text-xs gap-1.5" onClick={refresh} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="flex-1 p-8 max-w-5xl flex flex-col gap-6">
      {error && <div className="text-sm text-destructive font-mono">{error}</div>}

      {rows && (
        <div className="border border-border rounded-sm bg-card p-4 flex items-center gap-6">
          <div>
            <div className="text-2xl font-mono font-bold">{configuredCount}/{total}</div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">configured</div>
          </div>
        </div>
      )}

      {!rows ? (
        <div className="text-sm text-muted-foreground font-mono">Loading…</div>
      ) : (
        Object.entries(grouped).map(([category, items]) => (
          <div key={category} className="flex flex-col gap-2">
            <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              {CATEGORY_LABELS[category] ?? category}
            </h2>
            <div className="border border-border rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    {["Key", "Description", "Status", "Source", ""].map((h) => (
                      <th key={h} className="text-left px-4 py-2 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.key} className="border-b border-border last:border-0 hover:bg-secondary/20">
                      <td className="px-4 py-2 font-mono text-xs font-medium">
                        {row.key}
                        {row.trainerRelevant && (
                          <span className="ml-2 text-[9px] font-mono uppercase tracking-wider text-cyan-500 border border-cyan-500/30 rounded-sm px-1 py-0.5">trainer-relevant</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{row.description}</td>
                      <td className="px-4 py-2">
                        {row.configured ? (
                          <span className="flex items-center gap-1 text-xs font-mono text-success"><CheckCircle2 className="w-3 h-3" /> configured</span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs font-mono text-destructive"><XCircle className="w-3 h-3" /> not set</span>
                        )}
                        {row.vaultDisabled && (
                          <span className="flex items-center gap-1 text-[10px] font-mono text-amber-500 mt-0.5"><ShieldAlert className="w-3 h-3" /> vault entry disabled</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs font-mono text-muted-foreground">{row.configuredVia ?? "—"}</td>
                      <td className="px-4 py-2">
                        <Link href={row.managePath}>
                          <Button variant="ghost" size="sm" className="h-6 px-2 rounded-sm font-mono text-[10px] gap-1">
                            Manage <ExternalLink className="w-3 h-3" />
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
      </div>
    </div>
  );
}
