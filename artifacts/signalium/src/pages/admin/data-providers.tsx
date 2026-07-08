import { useState } from "react";
import {
  useListDataProvidersAdmin,
  useCreateDataProvider,
  useUpdateDataProvider,
  useDeleteDataProvider,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Database, Plus, Trash2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

function AddDataProviderDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [apiEndpoint, setApiEndpoint] = useState("");
  const createProvider = useCreateDataProvider();

  async function handleSubmit() {
    if (!name || !slug) return;
    try {
      await createProvider.mutateAsync({ data: { name, slug, apiEndpoint: apiEndpoint || undefined } });
      toast({ title: "Data provider created" });
      setName("");
      setSlug("");
      setApiEndpoint("");
      setOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to create data provider", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5 font-mono text-xs rounded-sm">
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> New Data Provider
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-sm">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">New Data Provider</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-name" className="text-xs font-mono text-muted-foreground">Name</Label>
            <Input id="provider-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Polygon.io" className="rounded-sm font-mono text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-slug" className="text-xs font-mono text-muted-foreground">Slug</Label>
            <Input id="provider-slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="polygon" className="rounded-sm font-mono text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-endpoint" className="text-xs font-mono text-muted-foreground">API Endpoint (optional)</Label>
            <Input id="provider-endpoint" value={apiEndpoint} onChange={(e) => setApiEndpoint(e.target.value)} placeholder="https://api.polygon.io" className="rounded-sm font-mono text-sm" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" className="rounded-sm font-mono text-xs">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={createProvider.isPending} className="rounded-sm font-mono text-xs">
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminDataProviders() {
  const { toast } = useToast();
  const { data: providers = [], isLoading, refetch } = useListDataProvidersAdmin();
  const updateProvider = useUpdateDataProvider();
  const deleteProvider = useDeleteDataProvider();

  async function handleToggleActive(id: number, isActive: boolean) {
    try {
      await updateProvider.mutateAsync({ id, data: { isActive } });
      refetch();
    } catch (err: any) {
      toast({ title: "Failed to update data provider", description: err?.message, variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteProvider.mutateAsync({ id });
      toast({ title: "Data provider deleted" });
      refetch();
    } catch (err: any) {
      toast({ title: "Failed to delete data provider", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-xl font-bold font-mono tracking-tight">Data Providers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage the registry of market-data feed sources
        </p>
      </div>

      <div className="flex-1 p-8 max-w-5xl">
        <div className="flex justify-end mb-3">
          <AddDataProviderDialog />
        </div>
        <div className="border border-border rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                {["Provider", "Slug", "API Endpoint", "Status", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">Loading...</td></tr>
              ) : providers.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">No data providers yet</td></tr>
              ) : (
                providers.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                    <td className="px-4 py-3 font-mono text-xs font-medium flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-primary" aria-hidden="true" /> {p.name}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.slug}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.apiEndpoint ?? "—"}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleActive(p.id, !p.isActive)}
                        className="flex items-center gap-1 text-xs font-mono focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring rounded-sm"
                        aria-label={p.isActive ? `Deactivate ${p.name}` : `Activate ${p.name}`}
                      >
                        {p.isActive ? (
                          <span className="flex items-center gap-1 text-primary"><CheckCircle2 className="w-3 h-3" aria-hidden="true" /> active</span>
                        ) : (
                          <span className="flex items-center gap-1 text-muted-foreground"><XCircle className="w-3 h-3" aria-hidden="true" /> inactive</span>
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive h-7 w-7 p-0 rounded-sm"
                        onClick={() => handleDelete(p.id)}
                        aria-label={`Delete ${p.name}`}
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
      </div>
    </div>
  );
}
