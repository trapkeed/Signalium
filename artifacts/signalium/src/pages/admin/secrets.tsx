import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  KeyRound,
  Eye,
  EyeOff,
  Trash2,
  Plus,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  Copy,
  Chrome,
} from "lucide-react";

const BASE = (import.meta as any).env?.BASE_URL ?? "/";

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}api/admin/secrets${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", "x-requested-with": "XMLHttpRequest", ...(opts.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

interface SystemSecret {
  key: string;
  category: string;
  description: string;
  configured: boolean;
  source: "environment";
}

interface ManagedSecret {
  id: number;
  key: string;
  category: string;
  description: string | null;
  maskedValue: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES = ["api_key", "db_credential", "signing_key", "webhook_secret", "other"];

function SystemSecretsTab() {
  const [rows, setRows] = useState<SystemSecret[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SystemSecret[]>("/system").then(setRows).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="text-sm text-destructive font-mono">{error}</div>;
  if (!rows) return <div className="text-sm text-muted-foreground font-mono">Loading…</div>;

  return (
    <div className="border border-border rounded-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/30">
            {["Variable", "Category", "Description", "Status"].map((h) => (
              <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border last:border-0 hover:bg-secondary/20">
              <td className="px-4 py-3 font-mono text-xs font-medium">{row.key}</td>
              <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{row.category}</td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{row.description}</td>
              <td className="px-4 py-3">
                {row.configured ? (
                  <span className="flex items-center gap-1 text-xs font-mono text-success"><CheckCircle2 className="w-3 h-3" /> configured</span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-mono text-destructive"><XCircle className="w-3 h-3" /> missing</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddSecretForm({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [category, setCategory] = useState("other");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!key.trim() || !value.trim()) {
      toast({ title: "Key and value are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await api("/", { method: "POST", body: JSON.stringify({ key: key.trim(), value, category, description }) });
      toast({ title: "Secret saved" });
      setKey(""); setValue(""); setDescription(""); setCategory("other");
      setOpen(false);
      onCreated();
    } catch (err: any) {
      toast({ title: "Failed to save secret", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" className="font-mono text-xs gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="w-3.5 h-3.5" /> Add Secret
      </Button>
    );
  }

  return (
    <div className="border border-border rounded-sm bg-card p-4 flex flex-col gap-3 max-w-lg">
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Key</label>
        <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. QDE_TRAINER_API_KEY" className="font-mono text-xs" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Value</label>
        <Textarea value={value} onChange={(e) => setValue(e.target.value)} placeholder="Secret value" className="font-mono text-xs" rows={2} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Category</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 rounded-sm border border-border bg-background px-2 font-mono text-xs">
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Description (optional)</label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} className="font-mono text-xs" />
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" className="font-mono text-xs" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" className="font-mono text-xs" onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </div>
  );
}

function ManagedSecretsTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<ManagedSecret[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<number, string>>({});

  function refresh() {
    api<ManagedSecret[]>("/").then(setRows).catch((e) => setError(e.message));
  }

  useEffect(() => { refresh(); }, []);

  async function toggleReveal(id: number) {
    if (revealed[id] !== undefined) {
      setRevealed((r) => { const next = { ...r }; delete next[id]; return next; });
      return;
    }
    try {
      const { value } = await api<{ key: string; value: string }>(`/${id}/reveal`);
      setRevealed((r) => ({ ...r, [id]: value }));
    } catch (err: any) {
      toast({ title: "Failed to reveal secret", description: err.message, variant: "destructive" });
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this secret? This cannot be undone.")) return;
    try {
      await api(`/${id}`, { method: "DELETE" });
      toast({ title: "Secret deleted" });
      refresh();
    } catch (err: any) {
      toast({ title: "Failed to delete secret", description: err.message, variant: "destructive" });
    }
  }

  function copy(value: string) {
    navigator.clipboard.writeText(value);
    toast({ title: "Copied to clipboard" });
  }

  if (error) return <div className="text-sm text-destructive font-mono">{error}</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2 rounded-sm bg-amber-500/10 border border-amber-500/30 px-4 py-3">
        <ShieldAlert className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
        <p className="text-xs font-mono text-amber-600 dark:text-amber-400">
          Values here are encrypted at rest (AES-256-GCM) and every reveal is written to the audit log.
        </p>
      </div>

      <AddSecretForm onCreated={refresh} />

      {!rows ? (
        <div className="text-sm text-muted-foreground font-mono">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="border border-border bg-card rounded-sm p-12 text-center text-muted-foreground">
          <KeyRound className="w-8 h-8 mx-auto mb-3 opacity-30" />
          No managed secrets yet.
        </div>
      ) : (
        <div className="border border-border rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                {["Key", "Category", "Description", "Value", "Updated", "Actions"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                  <td className="px-4 py-3 font-mono text-xs font-medium">{row.key}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{row.category}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{row.description}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    <div className="flex items-center gap-2">
                      <span className="truncate max-w-[220px]">{revealed[row.id] ?? row.maskedValue}</span>
                      {revealed[row.id] && (
                        <button onClick={() => copy(revealed[row.id])} title="Copy">
                          <Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{new Date(row.updatedAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-sm" onClick={() => toggleReveal(row.id)} title={revealed[row.id] ? "Hide" : "Reveal"}>
                        {revealed[row.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-sm text-destructive hover:text-destructive" onClick={() => remove(row.id)} title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
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

interface GoogleOAuthStatus {
  configured: boolean;
  clientId: string | null;
}

function GoogleOAuthTab() {
  const { toast } = useToast();
  const [status, setStatus] = useState<GoogleOAuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);

  function refresh() {
    api<GoogleOAuthStatus>("/google-oauth").then(setStatus).catch((e) => setError(e.message));
  }

  useEffect(() => { refresh(); }, []);

  async function save() {
    if (!clientId.trim() || !clientSecret.trim()) {
      toast({ title: "Client ID and Client Secret are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await api("/google-oauth", { method: "POST", body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }) });
      toast({ title: "Google OAuth credentials saved" });
      setClientId(""); setClientSecret("");
      refresh();
    } catch (err: any) {
      toast({ title: "Failed to save Google OAuth credentials", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (error) return <div className="text-sm text-destructive font-mono">{error}</div>;

  return (
    <div className="flex flex-col gap-4 max-w-lg">
      <div className="flex items-start gap-2 rounded-sm bg-amber-500/10 border border-amber-500/30 px-4 py-3">
        <ShieldAlert className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
        <p className="text-xs font-mono text-amber-600 dark:text-amber-400">
          The client secret is encrypted at rest (AES-256-GCM). Redirect URI to register in Google Cloud Console: <span className="break-all">{`${window.location.origin}${BASE}api/auth/google/callback`}</span>
        </p>
      </div>

      <div className="border border-border rounded-sm bg-card p-4 flex items-center gap-3">
        <Chrome className="w-4 h-4 text-muted-foreground" />
        {status === null ? (
          <span className="text-xs font-mono text-muted-foreground">Loading…</span>
        ) : status.configured ? (
          <span className="flex items-center gap-1.5 text-xs font-mono text-success">
            <CheckCircle2 className="w-3.5 h-3.5" /> Configured — client ID {status.clientId}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-mono text-destructive">
            <XCircle className="w-3.5 h-3.5" /> Not configured — "Continue with Google" is disabled
          </span>
        )}
      </div>

      <div className="border border-border rounded-sm bg-card p-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Client ID</label>
          <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="xxxxx.apps.googleusercontent.com" className="font-mono text-xs" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Client Secret</label>
          <div className="relative">
            <Input
              type={showSecret ? "text" : "password"}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Client secret"
              className="font-mono text-xs pr-10"
            />
            <button type="button" onClick={() => setShowSecret(!showSecret)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm" className="font-mono text-xs" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Credentials"}</Button>
        </div>
      </div>
    </div>
  );
}

export default function AdminSecrets() {
  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-xl font-bold font-mono tracking-tight">Secrets Vault</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every API key and environment variable the platform depends on, in one encrypted place. Super admin only.
        </p>
      </div>

      <div className="flex-1 p-8 max-w-6xl">
        <Tabs defaultValue="system">
          <TabsList className="rounded-sm mb-6 bg-secondary/50 border border-border">
            <TabsTrigger value="system" className="rounded-sm font-mono text-xs">System Environment</TabsTrigger>
            <TabsTrigger value="managed" className="rounded-sm font-mono text-xs">Managed Secrets</TabsTrigger>
            <TabsTrigger value="google-oauth" className="rounded-sm font-mono text-xs">Google OAuth</TabsTrigger>
          </TabsList>
          <TabsContent value="system"><SystemSecretsTab /></TabsContent>
          <TabsContent value="managed"><ManagedSecretsTab /></TabsContent>
          <TabsContent value="google-oauth"><GoogleOAuthTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
