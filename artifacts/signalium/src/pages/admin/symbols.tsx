import { useState } from "react";
import {
  useListSymbols,
  useListSymbolCategories,
  useListSymbolAliases,
  useGetSymbolNormalizationLog,
  useCreateSymbolCategory,
  useCreateSymbol,
  useDeleteSymbol,
  useCreateSymbolAlias,
  useDeleteSymbolAlias,
  useListBrokers,
  useListSymbolMappingConflicts,
  useResolveSymbolMappingConflict,
  useListSymbolRegexPatterns,
  useCreateSymbolRegexPattern,
  useUpdateSymbolRegexPattern,
  useDeleteSymbolRegexPattern,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Coins, Plus, Trash2, ScrollText, Tags, CheckCircle2, XCircle, AlertTriangle, Regex } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function AddCategoryDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const createCategory = useCreateSymbolCategory();

  async function handleSubmit() {
    if (!name || !slug) return;
    try {
      await createCategory.mutateAsync({ data: { name, slug } });
      toast({ title: "Category created" });
      setName("");
      setSlug("");
      setOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to create category", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 font-mono text-xs rounded-sm">
          <Tags className="w-3.5 h-3.5" /> New Category
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-sm">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">New Symbol Category</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-mono text-muted-foreground">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Commodities" className="rounded-sm font-mono text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-mono text-muted-foreground">Slug</Label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="commodities" className="rounded-sm font-mono text-sm" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" className="rounded-sm font-mono text-xs">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={createCategory.isPending} className="rounded-sm font-mono text-xs">
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddSymbolDialog({ categories }: { categories: { id: number; name: string }[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [canonicalSymbol, setCanonicalSymbol] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const createSymbol = useCreateSymbol();

  async function handleSubmit() {
    if (!canonicalSymbol || !displayName || !categoryId) return;
    try {
      await createSymbol.mutateAsync({ data: { canonicalSymbol, displayName, categoryId: Number(categoryId) } });
      toast({ title: "Symbol created" });
      setCanonicalSymbol("");
      setDisplayName("");
      setCategoryId("");
      setOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to create symbol", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5 font-mono text-xs rounded-sm">
          <Plus className="w-3.5 h-3.5" /> New Symbol
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-sm">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">New Canonical Symbol</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-mono text-muted-foreground">Canonical Symbol</Label>
            <Input
              value={canonicalSymbol}
              onChange={(e) => setCanonicalSymbol(e.target.value.toUpperCase())}
              placeholder="XAUUSD"
              className="rounded-sm font-mono text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-mono text-muted-foreground">Display Name</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Gold vs US Dollar" className="rounded-sm font-mono text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-mono text-muted-foreground">Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="rounded-sm font-mono text-sm">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" className="rounded-sm font-mono text-xs">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={createSymbol.isPending} className="rounded-sm font-mono text-xs">
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddAliasDialog({ symbols, defaultAlias }: { symbols: { id: number; canonicalSymbol: string }[]; defaultAlias?: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [alias, setAlias] = useState(defaultAlias ?? "");
  const [canonicalSymbol, setCanonicalSymbol] = useState("");
  const [brokerId, setBrokerId] = useState<string>("");
  const createAlias = useCreateSymbolAlias();
  const { data: brokers = [] } = useListBrokers();

  async function handleSubmit() {
    if (!alias || !canonicalSymbol) return;
    try {
      await createAlias.mutateAsync({
        data: {
          alias,
          canonicalSymbol,
          brokerId: brokerId ? Number(brokerId) : undefined,
        },
      });
      toast({ title: "Alias created", description: `${alias} → ${canonicalSymbol}` });
      setAlias("");
      setCanonicalSymbol("");
      setBrokerId("");
      setOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to create alias", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setAlias(defaultAlias ?? ""); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5 font-mono text-xs rounded-sm">
          <Plus className="w-3.5 h-3.5" /> New Alias
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-sm">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">New Symbol Alias</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-mono text-muted-foreground">Alias (as reported by broker/EA)</Label>
            <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="WallStreet30" className="rounded-sm font-mono text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-mono text-muted-foreground">Canonical Symbol</Label>
            <Select value={canonicalSymbol} onValueChange={setCanonicalSymbol}>
              <SelectTrigger className="rounded-sm font-mono text-sm">
                <SelectValue placeholder="Select a canonical symbol" />
              </SelectTrigger>
              <SelectContent>
                {symbols.map((s) => (
                  <SelectItem key={s.id} value={s.canonicalSymbol}>{s.canonicalSymbol}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-mono text-muted-foreground">Broker (optional)</Label>
            <Select value={brokerId} onValueChange={setBrokerId}>
              <SelectTrigger className="rounded-sm font-mono text-sm">
                <SelectValue placeholder="No specific broker" />
              </SelectTrigger>
              <SelectContent>
                {brokers.map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" className="rounded-sm font-mono text-xs">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={createAlias.isPending} className="rounded-sm font-mono text-xs">
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddRegexPatternDialog({ symbols }: { symbols: { id: number; canonicalSymbol: string }[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pattern, setPattern] = useState("");
  const [canonicalSymbol, setCanonicalSymbol] = useState("");
  const [priority, setPriority] = useState("0");
  const createPattern = useCreateSymbolRegexPattern();

  async function handleSubmit() {
    if (!pattern || !canonicalSymbol) return;
    try {
      await createPattern.mutateAsync({ data: { pattern, canonicalSymbol, priority: Number(priority) || 0 } });
      toast({ title: "Regex pattern created" });
      setPattern("");
      setCanonicalSymbol("");
      setPriority("0");
      setOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to create pattern", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5 font-mono text-xs rounded-sm">
          <Plus className="w-3.5 h-3.5" /> New Regex Pattern
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-sm">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">New Regex Fallback Pattern</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-mono text-muted-foreground">Pattern (JS regex, matched against raw broker symbol)</Label>
            <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="^XAU.*USD$" className="rounded-sm font-mono text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-mono text-muted-foreground">Canonical Symbol</Label>
            <Select value={canonicalSymbol} onValueChange={setCanonicalSymbol}>
              <SelectTrigger className="rounded-sm font-mono text-sm">
                <SelectValue placeholder="Select a canonical symbol" />
              </SelectTrigger>
              <SelectContent>
                {symbols.map((s) => (
                  <SelectItem key={s.id} value={s.canonicalSymbol}>{s.canonicalSymbol}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-mono text-muted-foreground">Priority (lower tried first)</Label>
            <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded-sm font-mono text-sm" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" className="rounded-sm font-mono text-xs">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={createPattern.isPending} className="rounded-sm font-mono text-xs">
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminSymbols() {
  const { toast } = useToast();
  const [logFilter, setLogFilter] = useState<"all" | "unresolved">("all");

  const { data: symbols = [], isLoading: symbolsLoading, refetch: refetchSymbols } = useListSymbols();
  const { data: categories = [] } = useListSymbolCategories();
  const { data: aliases = [], refetch: refetchAliases } = useListSymbolAliases();
  const { data: brokers = [] } = useListBrokers();
  const brokerNameById = new Map(brokers.map((b) => [b.id, b.name]));
  const { data: log = [] } = useGetSymbolNormalizationLog(
    logFilter === "unresolved" ? { unresolvedOnly: "true" } : undefined,
  );
  const [conflictFilter, setConflictFilter] = useState<"all" | "unresolved">("unresolved");
  const { data: conflicts = [], refetch: refetchConflicts } = useListSymbolMappingConflicts(
    conflictFilter === "unresolved" ? { unresolvedOnly: "true" } : undefined,
  );
  const { data: regexPatterns = [], refetch: refetchRegexPatterns } = useListSymbolRegexPatterns();

  const deleteSymbol = useDeleteSymbol();
  const deleteAlias = useDeleteSymbolAlias();
  const resolveConflict = useResolveSymbolMappingConflict();
  const updateRegexPattern = useUpdateSymbolRegexPattern();
  const deleteRegexPattern = useDeleteSymbolRegexPattern();

  async function handleDeleteSymbol(id: number) {
    try {
      await deleteSymbol.mutateAsync({ id });
      toast({ title: "Symbol deleted" });
      refetchSymbols();
    } catch (err: any) {
      toast({ title: "Failed to delete symbol", description: err?.message, variant: "destructive" });
    }
  }

  async function handleDeleteAlias(id: number) {
    try {
      await deleteAlias.mutateAsync({ id });
      toast({ title: "Alias deleted" });
      refetchAliases();
    } catch (err: any) {
      toast({ title: "Failed to delete alias", description: err?.message, variant: "destructive" });
    }
  }

  const unresolvedCount = log.filter((l) => !l.resolved).length;
  const unresolvedConflictCount = conflicts.filter((c: any) => !c.resolved).length;

  async function handleResolveConflict(id: number) {
    try {
      await resolveConflict.mutateAsync({ id });
      toast({ title: "Conflict marked resolved" });
      refetchConflicts();
    } catch (err: any) {
      toast({ title: "Failed to resolve conflict", description: err?.message, variant: "destructive" });
    }
  }

  async function handleToggleRegexPattern(id: number, isActive: boolean) {
    try {
      await updateRegexPattern.mutateAsync({ id, data: { isActive: !isActive } });
      refetchRegexPatterns();
    } catch (err: any) {
      toast({ title: "Failed to update pattern", description: err?.message, variant: "destructive" });
    }
  }

  async function handleDeleteRegexPattern(id: number) {
    try {
      await deleteRegexPattern.mutateAsync({ id });
      toast({ title: "Regex pattern deleted" });
      refetchRegexPatterns();
    } catch (err: any) {
      toast({ title: "Failed to delete pattern", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-xl font-bold font-mono tracking-tight">Symbol Management</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage the canonical symbol registry, broker/EA aliases, and normalization telemetry
        </p>
      </div>

      <div className="flex-1 p-8 max-w-6xl">
        <Tabs defaultValue="symbols">
          <TabsList className="rounded-sm mb-6 bg-secondary/50 border border-border">
            <TabsTrigger value="symbols" className="rounded-sm font-mono text-xs">Symbols</TabsTrigger>
            <TabsTrigger value="aliases" className="rounded-sm font-mono text-xs">Aliases</TabsTrigger>
            <TabsTrigger value="log" className="rounded-sm font-mono text-xs">
              Normalization Log
              {unresolvedCount > 0 && (
                <span className="ml-2 bg-destructive/20 text-destructive text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {unresolvedCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="conflicts" className="rounded-sm font-mono text-xs">
              Mapping Conflicts
              {unresolvedConflictCount > 0 && (
                <span className="ml-2 bg-destructive/20 text-destructive text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {unresolvedConflictCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="regex" className="rounded-sm font-mono text-xs">Regex Fallback</TabsTrigger>
          </TabsList>

          <TabsContent value="symbols">
            <div className="flex justify-end mb-3 gap-2">
              <AddCategoryDialog />
              <AddSymbolDialog categories={categories} />
            </div>
            <div className="border border-border rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    {["Symbol", "Display Name", "Category", "Status", ""].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {symbolsLoading ? (
                    <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">Loading...</td></tr>
                  ) : symbols.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">No canonical symbols yet</td></tr>
                  ) : (
                    symbols.map((s) => (
                      <tr key={s.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                        <td className="px-4 py-3 font-mono text-xs font-medium flex items-center gap-1.5">
                          <Coins className="w-3.5 h-3.5 text-primary" /> {s.canonicalSymbol}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{s.displayName}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="rounded-sm font-mono text-xs">{s.categoryName}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          {s.enabled ? (
                            <span className="flex items-center gap-1 text-xs font-mono text-primary"><CheckCircle2 className="w-3 h-3" /> enabled</span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs font-mono text-muted-foreground"><XCircle className="w-3 h-3" /> disabled</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive h-7 w-7 p-0 rounded-sm"
                            onClick={() => handleDeleteSymbol(s.id)}
                            title="Delete"
                            aria-label={`Delete ${s.canonicalSymbol}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="aliases">
            <div className="flex justify-end mb-3">
              <AddAliasDialog symbols={symbols} />
            </div>
            <div className="border border-border rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    {["Alias", "Canonical Symbol", "Broker", "Source", "Added", ""].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {aliases.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">No aliases yet</td></tr>
                  ) : (
                    aliases.map((a) => (
                      <tr key={a.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                        <td className="px-4 py-3 font-mono text-xs">{a.alias}</td>
                        <td className="px-4 py-3 font-mono text-xs text-primary">{a.canonicalSymbol}</td>
                        <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                          {a.brokerId ? brokerNameById.get(a.brokerId) ?? `#${a.brokerId}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-muted-foreground capitalize">{a.source}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{new Date(a.createdAt).toLocaleDateString()}</td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive h-7 w-7 p-0 rounded-sm"
                            onClick={() => handleDeleteAlias(a.id)}
                            title="Delete"
                            aria-label={`Delete alias ${a.alias}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="log">
            <div className="flex justify-between items-center mb-3">
              <div className="flex gap-1 border border-border rounded-sm p-0.5 bg-secondary/30 w-fit">
                <Button
                  variant={logFilter === "all" ? "default" : "ghost"}
                  size="sm"
                  className="h-7 rounded-sm font-mono text-xs"
                  onClick={() => setLogFilter("all")}
                >
                  All
                </Button>
                <Button
                  variant={logFilter === "unresolved" ? "default" : "ghost"}
                  size="sm"
                  className="h-7 rounded-sm font-mono text-xs"
                  onClick={() => setLogFilter("unresolved")}
                >
                  Unresolved
                </Button>
              </div>
            </div>
            <div className="border border-border rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    {["Raw Input", "Result", "Source", "User", "When", ""].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {log.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">
                        <div className="flex flex-col items-center gap-2">
                          <ScrollText className="w-5 h-5" />
                          No normalization attempts yet
                        </div>
                      </td>
                    </tr>
                  ) : (
                    log.map((entry) => (
                      <tr key={entry.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                        <td className="px-4 py-3 font-mono text-xs">{entry.rawInput}</td>
                        <td className="px-4 py-3">
                          {entry.resolved ? (
                            <span className="flex items-center gap-1 text-xs font-mono text-primary"><CheckCircle2 className="w-3 h-3" /> resolved</span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs font-mono text-destructive"><XCircle className="w-3 h-3" /> unknown</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-muted-foreground capitalize">{entry.source}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-[120px] truncate">{entry.userId ?? "—"}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{new Date(entry.createdAt).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right">
                          {!entry.resolved && <AddAliasDialog symbols={symbols} defaultAlias={entry.rawInput} />}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="conflicts">
            <div className="flex justify-between items-center mb-3">
              <div className="flex gap-1 border border-border rounded-sm p-0.5 bg-secondary/30 w-fit">
                <Button
                  variant={conflictFilter === "unresolved" ? "default" : "ghost"}
                  size="sm"
                  className="h-7 rounded-sm font-mono text-xs"
                  onClick={() => setConflictFilter("unresolved")}
                >
                  Unresolved
                </Button>
                <Button
                  variant={conflictFilter === "all" ? "default" : "ghost"}
                  size="sm"
                  className="h-7 rounded-sm font-mono text-xs"
                  onClick={() => setConflictFilter("all")}
                >
                  All
                </Button>
              </div>
            </div>
            <div className="border border-border rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    {["Raw Alias", "Broker", "Previous Symbol", "New Symbol", "Detected", "Status", ""].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {conflicts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">
                        <div className="flex flex-col items-center gap-2">
                          <AlertTriangle className="w-5 h-5" />
                          No mapping conflicts
                        </div>
                      </td>
                    </tr>
                  ) : (
                    conflicts.map((c: any) => (
                      <tr key={c.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                        <td className="px-4 py-3 font-mono text-xs">{c.rawAlias}</td>
                        <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                          {c.brokerId ? brokerNameById.get(c.brokerId) ?? `#${c.brokerId}` : "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c.previousSymbol ?? "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-primary">{c.newSymbol ?? "—"}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{new Date(c.createdAt).toLocaleString()}</td>
                        <td className="px-4 py-3">
                          {c.resolved ? (
                            <span className="flex items-center gap-1 text-xs font-mono text-primary"><CheckCircle2 className="w-3 h-3" /> resolved</span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs font-mono text-destructive"><AlertTriangle className="w-3 h-3" /> open</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {!c.resolved && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 rounded-sm font-mono text-xs"
                              onClick={() => handleResolveConflict(c.id)}
                            >
                              Resolve
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="regex">
            <div className="flex justify-end mb-3">
              <AddRegexPatternDialog symbols={symbols} />
            </div>
            <div className="border border-border rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    {["Pattern", "Canonical Symbol", "Priority", "Status", ""].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {regexPatterns.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">
                        <div className="flex flex-col items-center gap-2">
                          <Regex className="w-5 h-5" />
                          No regex fallback patterns yet
                        </div>
                      </td>
                    </tr>
                  ) : (
                    regexPatterns.map((p: any) => (
                      <tr key={p.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                        <td className="px-4 py-3 font-mono text-xs">{p.pattern}</td>
                        <td className="px-4 py-3 font-mono text-xs text-primary">{p.canonicalSymbol}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.priority}</td>
                        <td className="px-4 py-3">
                          <button
                            className="text-xs font-mono"
                            onClick={() => handleToggleRegexPattern(p.id, p.isActive)}
                          >
                            {p.isActive ? (
                              <span className="flex items-center gap-1 text-primary"><CheckCircle2 className="w-3 h-3" /> active</span>
                            ) : (
                              <span className="flex items-center gap-1 text-muted-foreground"><XCircle className="w-3 h-3" /> inactive</span>
                            )}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive h-7 w-7 p-0 rounded-sm"
                            onClick={() => handleDeleteRegexPattern(p.id)}
                            title="Delete"
                            aria-label={`Delete pattern ${p.pattern}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </Button>
                        </td>
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
