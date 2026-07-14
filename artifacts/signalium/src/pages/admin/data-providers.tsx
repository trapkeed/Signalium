import { useState } from "react";
import {
  useListDataProvidersAdmin,
  useCreateDataProvider,
  useUpdateDataProvider,
  useDeleteDataProvider,
  useListProviderCredentials,
  useCreateProviderCredential,
  useUpdateProviderCredential,
  useDeleteProviderCredential,
  useListProviderCapabilities,
  useUpsertProviderCapability,
  useDeleteProviderCapability,
  useGetProviderStatus,
  useCheckProviderConnectivity,
  useListProviderSymbolMappings,
  useCreateProviderSymbolMapping,
  useDeleteProviderSymbolMapping,
  useUpdateProviderPriority,
  useListSymbols,
  useGetProviderAdapterInfo,
  useGetOandaStreamStatus,
  useGetOandaConfig,
  useSetOandaConfig,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  Database,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Key,
  Cpu,
  Activity,
  GitBranch,
  RotateCw,
  Wifi,
  WifiOff,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Radio,
  Signal,
  SignalHigh,
  SignalLow,
  SignalZero,
  Save,
  Settings2,
  Eye,
  EyeOff,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import type { DataProvider } from "@workspace/api-client-react";

const CAPABILITY_TYPES = ["live", "historical", "calendar", "news", "sentiment"] as const;
const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];

// ─── Providers list ───────────────────────────────────────────────────────────

function AddDataProviderDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [apiEndpoint, setApiEndpoint] = useState("");
  const [priority, setPriority] = useState("0");
  const createProvider = useCreateDataProvider();

  async function handleSubmit() {
    if (!name || !slug) return;
    try {
      await createProvider.mutateAsync({
        data: {
          name,
          slug,
          apiEndpoint: apiEndpoint || undefined,
        },
      });
      toast({ title: "Data provider created" });
      setName(""); setSlug(""); setApiEndpoint(""); setPriority("0");
      setOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to create data provider", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5 font-mono text-xs rounded-sm">
          <Plus className="w-3.5 h-3.5" /> New Data Provider
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-sm">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">New Data Provider</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {[
            { id: "dp-name", label: "Name", val: name, set: setName, placeholder: "OANDA" },
            { id: "dp-slug", label: "Slug", val: slug, set: (v: string) => setSlug(v.toLowerCase()), placeholder: "oanda" },
            { id: "dp-endpoint", label: "API Endpoint (optional)", val: apiEndpoint, set: setApiEndpoint, placeholder: "https://api-fxtrade.oanda.com" },
            { id: "dp-priority", label: "Priority (lower = higher)", val: priority, set: setPriority, placeholder: "0" },
          ].map(({ id, label, val, set, placeholder }) => (
            <div key={id} className="flex flex-col gap-1.5">
              <Label htmlFor={id} className="text-xs font-mono text-muted-foreground">{label}</Label>
              <Input id={id} value={val} onChange={(e) => set(e.target.value)} placeholder={placeholder} className="rounded-sm font-mono text-sm" />
            </div>
          ))}
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost" className="rounded-sm font-mono text-xs">Cancel</Button></DialogClose>
          <Button onClick={handleSubmit} disabled={createProvider.isPending} className="rounded-sm font-mono text-xs">Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderRow({
  provider,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: {
  provider: DataProvider;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const updateProvider = useUpdateDataProvider();
  const deleteProvider = useDeleteDataProvider();
  const { data: adapterInfo } = useGetProviderAdapterInfo(provider.id);

  async function handleToggle() {
    try {
      await updateProvider.mutateAsync({ id: provider.id, data: { isActive: !provider.isActive } });
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message, variant: "destructive" });
    }
  }

  async function handleDelete() {
    try {
      await deleteProvider.mutateAsync({ id: provider.id });
      toast({ title: "Provider deleted" });
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <>
      <tr className="border-b border-border last:border-0 hover:bg-secondary/20">
        <td className="px-4 py-3 font-mono text-xs font-medium">
          <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1.5 focus-visible:outline-none">
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <Database className="w-3.5 h-3.5 text-primary" />
            {provider.name}
          </button>
        </td>
        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            {provider.slug}
            {adapterInfo && (
              <Badge
                variant={adapterInfo.hasAdapter ? (adapterInfo.isConfigured ? "default" : "secondary") : "secondary"}
                className="text-[10px] px-1.5 py-0 font-mono"
              >
                {!adapterInfo.hasAdapter ? "not connected" : adapterInfo.isConfigured ? "configured" : "no api key"}
              </Badge>
            )}
            {provider.slug === "oanda" && <OandaStreamBadge />}
          </div>
        </td>
        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{provider.apiEndpoint ?? "—"}</td>
        <td className="px-4 py-3 font-mono text-xs">
          <div className="flex items-center justify-center gap-1.5">
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0 rounded-sm" disabled={!canMoveUp} onClick={onMoveUp}>
              <ArrowUp className="w-3 h-3" />
            </Button>
            <span className="w-4 text-center">{provider.priority}</span>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0 rounded-sm" disabled={!canMoveDown} onClick={onMoveDown}>
              <ArrowDown className="w-3 h-3" />
            </Button>
          </div>
        </td>
        <td className="px-4 py-3">
          <button onClick={handleToggle} className="flex items-center gap-1 text-xs font-mono">
            {provider.isActive ? (
              <span className="flex items-center gap-1 text-primary"><CheckCircle2 className="w-3 h-3" /> active</span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground"><XCircle className="w-3 h-3" /> inactive</span>
            )}
          </button>
        </td>
        <td className="px-4 py-3 text-right">
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive h-7 w-7 p-0 rounded-sm" onClick={handleDelete}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border bg-secondary/5">
          <td colSpan={6} className="px-6 py-4">
            <ProviderDetail provider={provider} />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── OANDA stream badge (inline in row) ──────────────────────────────────────

function OandaStreamBadge() {
  const { data } = useGetOandaStreamStatus({ refetchInterval: 10_000 });
  if (!data) return null;
  const state = data.state;
  if (state === "off") return null;
  const color =
    state === "connected" ? "text-green-500" :
    state === "reconnecting" ? "text-yellow-500" :
    "text-destructive";
  return (
    <span className={`flex items-center gap-0.5 font-mono text-[10px] ${color}`}>
      <Radio className="w-2.5 h-2.5" />
      stream
    </span>
  );
}

// ─── Provider detail (expandable) ─────────────────────────────────────────────

function ProviderDetail({ provider }: { provider: DataProvider }) {
  const isOanda = provider.slug === "oanda";
  return (
    <Tabs defaultValue={isOanda ? "oanda-config" : "credentials"}>
      <TabsList className="h-auto flex-wrap gap-1">
        {isOanda && (
          <TabsTrigger value="oanda-config" className="text-xs font-mono gap-1">
            <Settings2 className="w-3 h-3" /> OANDA Config
          </TabsTrigger>
        )}
        <TabsTrigger value="credentials" className="text-xs font-mono gap-1">
          <Key className="w-3 h-3" /> Credentials
        </TabsTrigger>
        <TabsTrigger value="capabilities" className="text-xs font-mono gap-1">
          <Cpu className="w-3 h-3" /> Capabilities
        </TabsTrigger>
        <TabsTrigger value="status" className="text-xs font-mono gap-1">
          <Activity className="w-3 h-3" /> Status
        </TabsTrigger>
        <TabsTrigger value="mappings" className="text-xs font-mono gap-1">
          <GitBranch className="w-3 h-3" /> Symbol Mappings
        </TabsTrigger>
        {isOanda && (
          <TabsTrigger value="stream" className="text-xs font-mono gap-1">
            <Radio className="w-3 h-3" /> Stream
          </TabsTrigger>
        )}
      </TabsList>
      {isOanda && (
        <TabsContent value="oanda-config" className="mt-3"><OandaConfigPanel /></TabsContent>
      )}
      <TabsContent value="credentials" className="mt-3"><CredentialsPanel providerId={provider.id} /></TabsContent>
      <TabsContent value="capabilities" className="mt-3"><CapabilitiesPanel providerId={provider.id} /></TabsContent>
      <TabsContent value="status" className="mt-3"><StatusPanel providerId={provider.id} apiEndpoint={provider.apiEndpoint ?? null} /></TabsContent>
      <TabsContent value="mappings" className="mt-3"><SymbolMappingsPanel providerId={provider.id} /></TabsContent>
      {isOanda && (
        <TabsContent value="stream" className="mt-3"><OandaStreamPanel /></TabsContent>
      )}
    </Tabs>
  );
}

// ─── OANDA config panel ───────────────────────────────────────────────────────

function OandaConfigPanel() {
  const { toast } = useToast();
  const { data: config, isLoading } = useGetOandaConfig();
  const save = useSetOandaConfig();

  // Local state: one entry per field key
  const [values, setValues] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  function setValue(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  function toggleShow(key: string) {
    setShowKey((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSave() {
    const fields = Object.entries(values)
      .filter(([, v]) => v.trim().length > 0)
      .map(([key, value]) => ({ key, value }));

    if (fields.length === 0) {
      toast({ title: "Nothing to save", description: "Enter at least one value.", variant: "destructive" });
      return;
    }

    try {
      await save.mutateAsync({ fields });
      setValues({});
      toast({ title: "OANDA config saved", description: "Restart the server for stream changes to take effect." });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err?.message, variant: "destructive" });
    }
  }

  if (isLoading) {
    return <p className="text-xs font-mono text-muted-foreground">Loading config…</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-secondary/20 rounded-sm px-4 py-3">
        <p className="text-xs font-mono text-muted-foreground">
          Set your OANDA credentials here. The <strong>API Key</strong> and <strong>Account ID</strong> are required to
          activate the live price stream. Stream URL and Symbols are optional — defaults shown as placeholder text.
          After saving, restart the server for stream changes to take effect.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {(config ?? []).map((field) => {
          const currentVal = values[field.key] ?? "";
          const isVisible = showKey[field.key] ?? false;
          const isSensitive = field.key === "market_data.oanda_api_key";

          return (
            <div key={field.key} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Label className="text-xs font-mono font-medium">
                  {field.label}
                  {!field.optional && <span className="text-destructive ml-0.5">*</span>}
                </Label>
                {field.configured ? (
                  <span className="flex items-center gap-1 text-[10px] font-mono text-green-500">
                    <CheckCircle2 className="w-3 h-3" /> configured
                    {field.maskedValue && (
                      <span className="text-muted-foreground ml-1">{field.maskedValue}</span>
                    )}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                    <XCircle className="w-3 h-3" /> not set
                  </span>
                )}
              </div>
              <p className="text-[10px] font-mono text-muted-foreground">{field.description}</p>
              <div className="relative flex items-center">
                <Input
                  type={isSensitive && !isVisible ? "password" : "text"}
                  value={currentVal}
                  onChange={(e) => setValue(field.key, e.target.value)}
                  placeholder={
                    field.configured
                      ? "Enter new value to update…"
                      : (field.defaultValue ?? `Enter ${field.label}…`)
                  }
                  className="rounded-sm font-mono text-xs h-8 pr-8"
                />
                {isSensitive && (
                  <button
                    type="button"
                    onClick={() => toggleShow(field.key)}
                    className="absolute right-2 text-muted-foreground hover:text-foreground"
                  >
                    {isVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={save.isPending || Object.values(values).every((v) => !v.trim())}
          className="rounded-sm font-mono text-xs gap-1.5 h-8"
        >
          <Save className="w-3.5 h-3.5" />
          {save.isPending ? "Saving…" : "Save Changes"}
        </Button>
        <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
          <Lock className="w-3 h-3" /> Values are encrypted at rest
        </span>
      </div>
    </div>
  );
}

// ─── OANDA streaming status panel ─────────────────────────────────────────────

function OandaStreamPanel() {
  const { data, isLoading, error } = useGetOandaStreamStatus({ refetchInterval: 10_000 });

  if (isLoading) {
    return <p className="text-xs font-mono text-muted-foreground">Loading stream status…</p>;
  }

  if (error || !data) {
    return (
      <p className="text-xs font-mono text-destructive">
        Failed to load stream status. Ensure the API key and account ID are set in Admin → Managed Secrets.
      </p>
    );
  }

  const { state, subscribedSymbols, tickCount, lastHeartbeatAt, lastTickAt, prices, errorMessage } = data;

  const stateColor =
    state === "connected" ? "text-green-500" :
    state === "reconnecting" ? "text-yellow-500" :
    state === "disconnected" ? "text-destructive" :
    "text-muted-foreground";

  const StateIcon =
    state === "connected" ? SignalHigh :
    state === "reconnecting" ? SignalLow :
    state === "disconnected" ? SignalZero :
    Signal;

  function ageLabel(iso: string | null): string {
    if (!iso) return "—";
    const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    return `${Math.floor(secs / 3600)}h ago`;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Connection state header */}
      <div className="flex items-center gap-4 bg-secondary/20 rounded-sm px-4 py-3">
        <span className={`flex items-center gap-1.5 font-mono text-sm font-medium ${stateColor}`}>
          <StateIcon className="w-4 h-4" />
          {state.toUpperCase()}
        </span>
        <span className="text-xs font-mono text-muted-foreground">
          {tickCount.toLocaleString()} ticks received
        </span>
        {lastTickAt && (
          <span className="text-xs font-mono text-muted-foreground">
            last tick: {ageLabel(lastTickAt)}
          </span>
        )}
        {lastHeartbeatAt && (
          <span className="text-xs font-mono text-muted-foreground">
            heartbeat: {ageLabel(lastHeartbeatAt)}
          </span>
        )}
      </div>

      {/* Error message */}
      {errorMessage && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-sm px-3 py-2">
          <p className="text-xs font-mono text-destructive">{errorMessage}</p>
        </div>
      )}

      {/* Configuration hint when off */}
      {state === "off" && (
        <div className="bg-secondary/20 rounded-sm px-4 py-3">
          <p className="text-xs font-mono text-muted-foreground">
            Stream is idle. Set <code className="bg-secondary px-1 rounded">market_data.oanda_api_key</code> and{" "}
            <code className="bg-secondary px-1 rounded">market_data.oanda_account_id</code> in{" "}
            <strong>Admin → Managed Secrets</strong>, then restart the API server.
          </p>
          <p className="text-xs font-mono text-muted-foreground mt-1">
            Optionally set <code className="bg-secondary px-1 rounded">market_data.oanda_stream_symbols</code> (comma-separated, e.g.{" "}
            <code className="bg-secondary px-1 rounded">EUR_USD,XAU_USD,GBP_USD</code>).
          </p>
        </div>
      )}

      {/* Subscribed symbols */}
      {subscribedSymbols.length > 0 && (
        <div>
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">
            Subscribed Instruments
          </p>
          <div className="flex flex-wrap gap-1.5">
            {subscribedSymbols.map((sym) => (
              <Badge key={sym} variant="secondary" className="font-mono text-[10px] px-2 py-0.5">
                {sym}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Live price table */}
      {Object.keys(prices).length > 0 && (
        <div>
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">
            Cached Prices
          </p>
          <div className="border border-border rounded-sm overflow-hidden">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  {["Instrument", "Bid", "Mid", "Ask", "Updated"].map((h) => (
                    <th key={h} className="text-left px-3 py-2 text-[10px] text-muted-foreground uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(prices)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([instrument, price]) => (
                    <tr key={instrument} className="border-b border-border last:border-0 hover:bg-secondary/20">
                      <td className="px-3 py-2 font-medium">{instrument}</td>
                      <td className="px-3 py-2 text-blue-500">{price.bid.toFixed(5)}</td>
                      <td className="px-3 py-2 text-foreground">{price.mid.toFixed(5)}</td>
                      <td className="px-3 py-2 text-green-500">{price.ask.toFixed(5)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{ageLabel(price.timestamp)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[10px] font-mono text-muted-foreground">
        Auto-refreshes every 10 seconds · Stream URL: stream-fxpractice.oanda.com (demo)
      </p>
    </div>
  );
}

// ─── Credentials panel ────────────────────────────────────────────────────────

function CredentialsPanel({ providerId }: { providerId: number }) {
  const { toast } = useToast();
  const { data: creds = [], isLoading } = useListProviderCredentials(providerId);
  const addCred = useCreateProviderCredential();
  const deleteCred = useDeleteProviderCredential();
  const [keyName, setKeyName] = useState("");
  const [keyValue, setKeyValue] = useState("");
  const [description, setDescription] = useState("");

  async function handleAdd() {
    if (!keyName || !keyValue) return;
    try {
      await addCred.mutateAsync({ id: providerId, data: { keyName, keyValue, description: description || undefined } });
      toast({ title: "Credential added" });
      setKeyName(""); setKeyValue(""); setDescription("");
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message, variant: "destructive" });
    }
  }

  async function handleDelete(credId: number) {
    try {
      await deleteCred.mutateAsync({ id: providerId, credId });
      toast({ title: "Credential deleted" });
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="api_key" className="rounded-sm font-mono text-xs w-32 h-7" />
        <Input value={keyValue} onChange={(e) => setKeyValue(e.target.value)} placeholder="value" type="password" className="rounded-sm font-mono text-xs w-48 h-7" />
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="description (opt)" className="rounded-sm font-mono text-xs w-40 h-7" />
        <Button size="sm" onClick={handleAdd} disabled={addCred.isPending} className="h-7 text-xs font-mono rounded-sm">Add</Button>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground font-mono">Loading…</p>
      ) : creds.length === 0 ? (
        <p className="text-xs text-muted-foreground font-mono">No credentials configured.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {creds.map((c: any) => (
            <div key={c.id} className="flex items-center gap-3 bg-secondary/20 rounded-sm px-3 py-1.5">
              <span className="font-mono text-xs font-medium w-24 shrink-0">{c.keyName}</span>
              <span className="font-mono text-xs text-muted-foreground flex-1">{c.keyValueMasked}</span>
              {c.description && <span className="font-mono text-xs text-muted-foreground">{c.description}</span>}
              <Badge variant={c.isActive ? "default" : "secondary"} className="text-[10px] px-1.5 py-0 font-mono">{c.isActive ? "active" : "inactive"}</Badge>
              {c.rotatedAt && <span className="text-[10px] text-muted-foreground font-mono">rotated {new Date(c.rotatedAt).toLocaleDateString()}</span>}
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-destructive" onClick={() => handleDelete(c.id)}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Capabilities panel ───────────────────────────────────────────────────────

function CapabilitiesPanel({ providerId }: { providerId: number }) {
  const { toast } = useToast();
  const { data: caps = [] } = useListProviderCapabilities(providerId);
  const upsert = useUpsertProviderCapability();
  const deleteCap = useDeleteProviderCapability();
  const [selectedTfs, setSelectedTfs] = useState<Record<string, string[]>>({});

  const capMap = Object.fromEntries((caps as any[]).map((c: any) => [c.capabilityType, c]));

  async function handleToggleCap(type: string) {
    if (capMap[type]) {
      try {
        await deleteCap.mutateAsync({ id: providerId, type });
        toast({ title: `${type} capability removed` });
      } catch (err: any) { toast({ title: "Failed", description: err?.message, variant: "destructive" }); }
    } else {
      try {
        await upsert.mutateAsync({ id: providerId, type: type as any, data: { supportedTimeframes: selectedTfs[type] ?? [] } });
        toast({ title: `${type} capability added` });
      } catch (err: any) { toast({ title: "Failed", description: err?.message, variant: "destructive" }); }
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {CAPABILITY_TYPES.map((type) => {
        const cap = capMap[type];
        return (
          <button
            key={type}
            onClick={() => handleToggleCap(type)}
            disabled={upsert.isPending || deleteCap.isPending}
            className={`flex flex-col items-start gap-1 rounded-sm border px-3 py-2 text-xs font-mono transition-colors ${
              cap ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-foreground/40"
            }`}
          >
            <span className="font-medium">{type}</span>
            {cap?.supportedTimeframes && (
              <span className="text-[10px] text-muted-foreground">{(cap.supportedTimeframes as string[]).join(", ") || "all"}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Status panel ─────────────────────────────────────────────────────────────

function StatusPanel({ providerId, apiEndpoint }: { providerId: number; apiEndpoint: string | null }) {
  const { toast } = useToast();
  const { data: status, isLoading } = useGetProviderStatus(providerId);
  const check = useCheckProviderConnectivity();

  async function handleCheck() {
    try {
      await check.mutateAsync({ id: providerId });
      toast({ title: "Connectivity check complete" });
    } catch (err: any) {
      toast({ title: "Check failed", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleCheck} disabled={check.isPending} className="h-7 text-xs font-mono rounded-sm gap-1">
          <RotateCw className={`w-3 h-3 ${check.isPending ? "animate-spin" : ""}`} />
          Run Connectivity Check
        </Button>
        <span className="text-xs text-muted-foreground font-mono">Also checked automatically every 5 minutes</span>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground font-mono">Loading…</p>
      ) : !status ? (
        <p className="text-xs text-muted-foreground font-mono">No status recorded yet. Run a check.</p>
      ) : (
        <div className="flex flex-col gap-1.5 bg-secondary/20 rounded-sm p-3">
          <div className="flex items-center gap-2">
            {(status as any).isReachable ? (
              <span className="flex items-center gap-1.5 text-xs font-mono text-primary"><Wifi className="w-3.5 h-3.5" /> Reachable</span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-mono text-destructive"><WifiOff className="w-3.5 h-3.5" /> Unreachable</span>
            )}
            {(status as any).latencyMs != null && (
              <span className="text-xs font-mono text-muted-foreground">{(status as any).latencyMs}ms</span>
            )}
            {(status as any).consecutiveFailures > 0 && (
              <Badge variant="destructive" className="text-[10px] font-mono px-1.5 py-0">{(status as any).consecutiveFailures} consecutive failures</Badge>
            )}
          </div>
          {(status as any).errorMessage && (
            <p className="text-xs font-mono text-destructive">{(status as any).errorMessage}</p>
          )}
          {(status as any).lastCheckedAt && (
            <p className="text-[10px] text-muted-foreground font-mono">
              Last checked: {new Date((status as any).lastCheckedAt).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Symbol Mappings panel ────────────────────────────────────────────────────

function SymbolMappingsPanel({ providerId }: { providerId: number }) {
  const { toast } = useToast();
  const { data: mappings = [] } = useListProviderSymbolMappings(providerId);
  const { data: allSymbols = [] } = useListSymbols();
  const addMapping = useCreateProviderSymbolMapping();
  const deleteMapping = useDeleteProviderSymbolMapping();
  const [providerSymbol, setProviderSymbol] = useState("");
  const [canonicalId, setCanonicalId] = useState("");

  async function handleAdd() {
    if (!providerSymbol || !canonicalId) return;
    try {
      await addMapping.mutateAsync({ id: providerId, data: { providerSymbol, canonicalSymbolId: Number(canonicalId) } });
      toast({ title: "Mapping added" });
      setProviderSymbol(""); setCanonicalId("");
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message, variant: "destructive" });
    }
  }

  async function handleDelete(mappingId: number) {
    try {
      await deleteMapping.mutateAsync({ id: providerId, mappingId });
      toast({ title: "Mapping removed" });
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={providerSymbol} onChange={(e) => setProviderSymbol(e.target.value)} placeholder="EUR_USD" className="rounded-sm font-mono text-xs w-32 h-7" />
        <span className="text-xs font-mono text-muted-foreground">→</span>
        <select
          value={canonicalId}
          onChange={(e) => setCanonicalId(e.target.value)}
          className="h-7 rounded-sm border border-border bg-background font-mono text-xs px-2 text-sm"
        >
          <option value="">select canonical</option>
          {(allSymbols as any[]).map((s: any) => (
            <option key={s.id} value={String(s.id)}>{s.canonicalSymbol}</option>
          ))}
        </select>
        <Button size="sm" onClick={handleAdd} disabled={addMapping.isPending} className="h-7 text-xs font-mono rounded-sm">Add</Button>
      </div>

      {(mappings as any[]).length === 0 ? (
        <p className="text-xs text-muted-foreground font-mono">No symbol mappings configured.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {(mappings as any[]).map((m: any) => (
            <div key={m.id} className="flex items-center gap-3 bg-secondary/20 rounded-sm px-3 py-1.5">
              <span className="font-mono text-xs text-muted-foreground w-28 shrink-0">{m.providerSymbol}</span>
              <GitBranch className="w-3 h-3 text-muted-foreground" />
              <span className="font-mono text-xs font-medium">{m.canonicalSymbol}</span>
              <span className="font-mono text-xs text-muted-foreground flex-1">{m.displayName}</span>
              <Badge variant={m.isActive ? "default" : "secondary"} className="text-[10px] px-1.5 py-0 font-mono">{m.isActive ? "active" : "inactive"}</Badge>
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-destructive" onClick={() => handleDelete(m.id)}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminDataProviders() {
  const { data: providers = [], isLoading } = useListDataProvidersAdmin();
  const { toast } = useToast();
  const updatePriority = useUpdateProviderPriority();

  const sorted = [...(providers as DataProvider[])].sort((a, b) => a.priority - b.priority);

  async function swapPriority(a: DataProvider, b: DataProvider) {
    try {
      await Promise.all([
        updatePriority.mutateAsync({ id: a.id, data: { priority: b.priority } }),
        updatePriority.mutateAsync({ id: b.id, data: { priority: a.priority } }),
      ]);
    } catch (err: any) {
      toast({ title: "Failed to reorder", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-xl font-bold font-mono tracking-tight">Data Providers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage the registry of market-data feed sources — credentials, capabilities, symbol mappings, and live status.
        </p>
      </div>

      <div className="flex-1 p-8">
        <div className="flex justify-end mb-3">
          <AddDataProviderDialog />
        </div>
        <div className="border border-border rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                {["Provider", "Slug", "API Endpoint", "Priority", "Status", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-muted-foreground font-mono">Loading…</td></tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-muted-foreground font-mono">No data providers configured.</td></tr>
              ) : (
                sorted.map((p, i) => (
                  <ProviderRow
                    key={p.id}
                    provider={p}
                    canMoveUp={i > 0}
                    canMoveDown={i < sorted.length - 1}
                    onMoveUp={() => swapPriority(p, sorted[i - 1])}
                    onMoveDown={() => swapPriority(p, sorted[i + 1])}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
