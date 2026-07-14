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
  isActive: boolean;
  rotatedAt: string | null;
  maskedValue: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES = ["auth", "payments", "email", "infra", "ai", "trainer", "market_data", "runpod", "ea_feed", "other"];

// Curated catalog of known managed-secret keys for quick-add, grouped by
// area. Purely a UI convenience (autofills key/category/description) — the
// backend accepts any freeform key, so this list never blocks a custom key.
const KNOWN_KEYS: { group: string; key: string; category: string; description: string }[] = [
  { group: "Trainer", key: "trainer.url", category: "trainer", description: "Base URL of the signalium-trainer service (inference, training, Research Lab). Leave unset to run on local heuristics." },
  { group: "Trainer", key: "trainer.api_key", category: "trainer", description: "Optional trainer-side API key, additive to the signed SSO service token." },
  { group: "Trainer", key: "trainer.timeout_ms", category: "trainer", description: "Request timeout (ms) for outbound trainer calls." },
  { group: "Trainer", key: "trainer.retry_count", category: "trainer", description: "Retry attempts for outbound trainer calls." },
  { group: "Trainer", key: "trainer.circuit_breaker_threshold", category: "trainer", description: "Consecutive failures before the trainer circuit breaker opens." },
  { group: "Trainer", key: "trainer.circuit_breaker_reset_ms", category: "trainer", description: "Cooldown (ms) before the trainer circuit breaker retries after opening." },
  { group: "Payments", key: "payments.nowpayments_api_key", category: "payments", description: "NOWPayments API key." },
  { group: "Payments", key: "payments.nowpayments_ipn_secret", category: "payments", description: "NOWPayments IPN callback signing secret." },
  { group: "Payments", key: "payments.stripe_secret_key", category: "payments", description: "Stripe secret key. Overrides STRIPE_SECRET_KEY env var." },
  { group: "Payments", key: "payments.stripe_webhook_secret", category: "payments", description: "Stripe webhook signing secret. Overrides STRIPE_WEBHOOK_SECRET env var." },
  { group: "Payments", key: "payments.paypal_client_id", category: "payments", description: "PayPal REST client id. Overrides PAYPAL_CLIENT_ID env var." },
  { group: "Payments", key: "payments.paypal_client_secret", category: "payments", description: "PayPal REST client secret. Overrides PAYPAL_CLIENT_SECRET env var." },
  { group: "Payments", key: "payments.paypal_webhook_id", category: "payments", description: "PayPal webhook resource id. Overrides PAYPAL_WEBHOOK_ID env var." },
  { group: "Market Data", key: "market_data.tiingo_api_key", category: "market_data", description: "Tiingo market data API key." },
  { group: "Market Data", key: "market_data.oanda_api_key", category: "market_data", description: "OANDA API key." },
  { group: "Market Data", key: "market_data.twelvedata_api_key", category: "market_data", description: "Twelve Data API key." },
  { group: "Market Data", key: "market_data.polygon_api_key", category: "market_data", description: "Polygon.io API key." },
  { group: "Market Data", key: "market_data.finnhub_api_key", category: "market_data", description: "Finnhub API key." },
  { group: "RunPod", key: "runpod.api_key", category: "runpod", description: "RunPod API key for GPU training infrastructure." },
  { group: "RunPod", key: "runpod.endpoint_id", category: "runpod", description: "RunPod serverless endpoint id." },
  { group: "RunPod", key: "runpod.gpu_template", category: "runpod", description: "RunPod GPU pod template id." },
  { group: "RunPod", key: "runpod.volume_id", category: "runpod", description: "RunPod persistent volume id." },
  { group: "RunPod", key: "runpod.gpu_pricing_json", category: "runpod", description: "JSON map of GPU type name → hourly USD price. Managed via Admin → RunPod → GPU Pricing." },
  { group: "RunPod", key: "runpod.max_hourly_cost_usd", category: "runpod", description: "Maximum total active hourly GPU spend in USD before new launches are blocked." },
  { group: "RunPod", key: "runpod.max_active_pods", category: "runpod", description: "Maximum number of simultaneously active pods." },
  { group: "RunPod", key: "runpod.allowed_gpus", category: "runpod", description: "Comma-separated allowlist of permitted GPU type names. Empty = any GPU allowed." },
  { group: "AI", key: "openai.api_key", category: "ai", description: "OpenAI API key." },
  { group: "AI", key: "openai.model", category: "ai", description: "Default OpenAI model name." },
  { group: "General", key: "general.debug_mode", category: "other", description: "Set to \"true\" to enable verbose platform debug logging." },
  { group: "Auth", key: "sso.issuer", category: "auth", description: "JWT issuer claim for Signalium-issued SSO tokens. Overrides JWT_ISSUER env var." },
  { group: "Auth", key: "sso.access_token_ttl_seconds", category: "auth", description: "SSO access token lifetime in seconds. Overrides JWT_EXPIRATION env var." },
  { group: "Auth", key: "sso.refresh_token_ttl_days", category: "auth", description: "SSO refresh token lifetime in days. Overrides JWT_REFRESH_EXPIRATION env var." },
  { group: "EA Feed", key: "ea_feed.symbols", category: "ea_feed", description: "Data providers / symbol mappings driving the EA telemetry feed." },
];

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

  function applyKnownKey(k: string) {
    const found = KNOWN_KEYS.find((kk) => kk.key === k);
    if (!found) return;
    setKey(found.key);
    setCategory(found.category);
    setDescription(found.description);
  }

  return (
    <div className="border border-border rounded-sm bg-card p-4 flex flex-col gap-3 max-w-lg">
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Quick add (optional)</label>
        <select
          defaultValue=""
          onChange={(e) => applyKnownKey(e.target.value)}
          className="h-9 rounded-sm border border-border bg-background px-2 font-mono text-xs"
        >
          <option value="" disabled>Choose a known key…</option>
          {Object.entries(
            KNOWN_KEYS.reduce<Record<string, typeof KNOWN_KEYS>>((acc, k) => {
              (acc[k.group] ??= []).push(k);
              return acc;
            }, {}),
          ).map(([group, keys]) => (
            <optgroup key={group} label={group}>
              {keys.map((k) => <option key={k.key} value={k.key}>{k.key}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Key</label>
        <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. trainer.url" className="font-mono text-xs" />
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
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

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

  async function rotate(id: number) {
    const value = prompt("Enter the new secret value:");
    if (!value) return;
    try {
      await api(`/${id}/rotate`, { method: "POST", body: JSON.stringify({ value }) });
      toast({ title: "Secret rotated" });
      refresh();
    } catch (err: any) {
      toast({ title: "Failed to rotate secret", description: err.message, variant: "destructive" });
    }
  }

  async function toggleActive(id: number, isActive: boolean) {
    try {
      await api(`/${id}/${isActive ? "disable" : "enable"}`, { method: "POST" });
      toast({ title: isActive ? "Secret disabled" : "Secret enabled" });
      refresh();
    } catch (err: any) {
      toast({ title: "Failed to update secret", description: err.message, variant: "destructive" });
    }
  }

  function copy(value: string) {
    navigator.clipboard.writeText(value);
    toast({ title: "Copied to clipboard" });
  }

  if (error) return <div className="text-sm text-destructive font-mono">{error}</div>;

  const visibleRows = rows ? (categoryFilter === "all" ? rows : rows.filter((r) => r.category === categoryFilter)) : null;
  const categoryCounts = rows
    ? rows.reduce<Record<string, number>>((acc, r) => { acc[r.category] = (acc[r.category] ?? 0) + 1; return acc; }, {})
    : {};

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2 rounded-sm bg-amber-500/10 border border-amber-500/30 px-4 py-3">
        <ShieldAlert className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
        <p className="text-xs font-mono text-amber-600 dark:text-amber-400">
          Values here are encrypted at rest (AES-256-GCM) and every reveal is written to the audit log.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <AddSecretForm onCreated={refresh} />
        <div className="flex items-center gap-1 flex-wrap ml-2">
          <button
            onClick={() => setCategoryFilter("all")}
            className={`px-2.5 py-1 rounded-sm text-[11px] font-mono border ${categoryFilter === "all" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            all{rows ? ` (${rows.length})` : ""}
          </button>
          {CATEGORIES.filter((c) => categoryCounts[c]).map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={`px-2.5 py-1 rounded-sm text-[11px] font-mono border ${categoryFilter === c ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {c} ({categoryCounts[c]})
            </button>
          ))}
        </div>
      </div>

      {!visibleRows ? (
        <div className="text-sm text-muted-foreground font-mono">Loading…</div>
      ) : visibleRows.length === 0 ? (
        <div className="border border-border bg-card rounded-sm p-12 text-center text-muted-foreground">
          <KeyRound className="w-8 h-8 mx-auto mb-3 opacity-30" />
          {rows && rows.length > 0 ? "No secrets in this category." : "No managed secrets yet."}
        </div>
      ) : (
        <div className="border border-border rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                {["Key", "Category", "Description", "Value", "Status", "Updated", "Actions"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
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
                  <td className="px-4 py-3 text-xs font-mono">
                    {row.isActive ? (
                      <span className="flex items-center gap-1 text-success"><CheckCircle2 className="w-3 h-3" /> active</span>
                    ) : (
                      <span className="flex items-center gap-1 text-muted-foreground"><XCircle className="w-3 h-3" /> disabled</span>
                    )}
                    {row.rotatedAt && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">rotated {new Date(row.rotatedAt).toLocaleDateString()}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{new Date(row.updatedAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-sm" onClick={() => toggleReveal(row.id)} title={revealed[row.id] ? "Hide" : "Reveal"}>
                        {revealed[row.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 rounded-sm font-mono text-[10px]" onClick={() => rotate(row.id)} title="Rotate">
                        Rotate
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 rounded-sm font-mono text-[10px]" onClick={() => toggleActive(row.id, row.isActive)} title={row.isActive ? "Disable" : "Enable"}>
                        {row.isActive ? "Disable" : "Enable"}
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

interface SsoKeyStatus {
  activeKid: string | null;
  activeKeyCreatedAt: string | null;
  totalKeys: number;
  keys: { kid: string; isActive: boolean; createdAt: string }[];
  config: { issuer: string; accessTokenTtlSeconds: number; refreshTokenTtlDays: number };
}

async function ssoApi<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}api/sso${path}`, {
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

function SsoKeysTab() {
  const { toast } = useToast();
  const [status, setStatus] = useState<SsoKeyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  function refresh() {
    ssoApi<SsoKeyStatus>("/key-status").then(setStatus).catch((e) => setError(e.message));
  }

  useEffect(() => { refresh(); }, []);

  async function rotate() {
    if (!confirm("Rotate the SSO signing key? The previous key stays valid for verification, but every new token will use the new key.")) return;
    setRotating(true);
    try {
      await ssoApi("/rotate-signing-key", { method: "POST" });
      toast({ title: "SSO signing key rotated" });
      refresh();
    } catch (err: any) {
      toast({ title: "Failed to rotate signing key", description: err.message, variant: "destructive" });
    } finally {
      setRotating(false);
    }
  }

  if (error) return <div className="text-sm text-destructive font-mono">{error}</div>;

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="flex items-start gap-2 rounded-sm bg-amber-500/10 border border-amber-500/30 px-4 py-3">
        <ShieldAlert className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
        <p className="text-xs font-mono text-amber-600 dark:text-amber-400">
          Signing keys are ES256 key pairs generated and stored server-side — the private key is never displayed here. Issuer and token lifetimes can be overridden from the Managed Secrets tab (keys: sso.issuer, sso.access_token_ttl_seconds, sso.refresh_token_ttl_days).
        </p>
      </div>

      {!status ? (
        <div className="text-sm text-muted-foreground font-mono">Loading…</div>
      ) : (
        <>
          <div className="border border-border rounded-sm bg-card p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Active key</span>
              <Button size="sm" className="font-mono text-xs" onClick={rotate} disabled={rotating}>{rotating ? "Rotating…" : "Rotate signing key"}</Button>
            </div>
            <div className="font-mono text-xs">kid: {status.activeKid ?? "—"}</div>
            <div className="font-mono text-xs text-muted-foreground">
              created: {status.activeKeyCreatedAt ? new Date(status.activeKeyCreatedAt).toLocaleString() : "—"}
            </div>
            <div className="font-mono text-xs text-muted-foreground">total keys retained for verification: {status.totalKeys}</div>
          </div>

          <div className="border border-border rounded-sm bg-card p-4 flex flex-col gap-2">
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Resolved config</span>
            <div className="font-mono text-xs">issuer: {status.config.issuer}</div>
            <div className="font-mono text-xs">access token ttl: {status.config.accessTokenTtlSeconds}s</div>
            <div className="font-mono text-xs">refresh token ttl: {status.config.refreshTokenTtlDays} days</div>
          </div>

          <div className="border border-border rounded-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  {["Kid", "Status", "Created"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {status.keys.map((k) => (
                  <tr key={k.kid} className="border-b border-border last:border-0 hover:bg-secondary/20">
                    <td className="px-4 py-3 font-mono text-xs truncate max-w-[220px]">{k.kid}</td>
                    <td className="px-4 py-3 text-xs font-mono">
                      {k.isActive ? (
                        <span className="flex items-center gap-1 text-success"><CheckCircle2 className="w-3 h-3" /> active</span>
                      ) : (
                        <span className="text-muted-foreground">retired (verify-only)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{new Date(k.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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
            <TabsTrigger value="sso-keys" className="rounded-sm font-mono text-xs">SSO Keys</TabsTrigger>
            <TabsTrigger value="google-oauth" className="rounded-sm font-mono text-xs">Google OAuth</TabsTrigger>
          </TabsList>
          <TabsContent value="system"><SystemSecretsTab /></TabsContent>
          <TabsContent value="managed"><ManagedSecretsTab /></TabsContent>
          <TabsContent value="sso-keys"><SsoKeysTab /></TabsContent>
          <TabsContent value="google-oauth"><GoogleOAuthTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
