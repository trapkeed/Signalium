import { useState } from "react";
import {
  useListBrokersAdmin,
  useCreateBroker,
  useUpdateBroker,
  useDeleteBroker,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Building2, Plus, Trash2, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
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

function AddBrokerDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [website, setWebsite] = useState("");
  const createBroker = useCreateBroker();

  async function handleSubmit() {
    if (!name || !slug) return;
    try {
      await createBroker.mutateAsync({ data: { name, slug, website: website || undefined } });
      toast({ title: "Broker created" });
      setName("");
      setSlug("");
      setWebsite("");
      setOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to create broker", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5 font-mono text-xs rounded-sm">
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> New Broker
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-sm">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">New Broker</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="broker-name" className="text-xs font-mono text-muted-foreground">Name</Label>
            <Input id="broker-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="IC Markets" className="rounded-sm font-mono text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="broker-slug" className="text-xs font-mono text-muted-foreground">Slug</Label>
            <Input id="broker-slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="ic-markets" className="rounded-sm font-mono text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="broker-website" className="text-xs font-mono text-muted-foreground">Website (optional)</Label>
            <Input id="broker-website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://icmarkets.com" className="rounded-sm font-mono text-sm" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" className="rounded-sm font-mono text-xs">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={createBroker.isPending} className="rounded-sm font-mono text-xs">
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminBrokers() {
  const { toast } = useToast();
  const { data: brokers = [], isLoading, refetch } = useListBrokersAdmin();
  const updateBroker = useUpdateBroker();
  const deleteBroker = useDeleteBroker();

  async function handleToggleActive(id: number, isActive: boolean) {
    try {
      await updateBroker.mutateAsync({ id, data: { isActive } });
      refetch();
    } catch (err: any) {
      toast({ title: "Failed to update broker", description: err?.message, variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteBroker.mutateAsync({ id });
      toast({ title: "Broker deleted" });
      refetch();
    } catch (err: any) {
      toast({ title: "Failed to delete broker", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-xl font-bold font-mono tracking-tight">Brokers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage the registry of execution brokers referenced by symbol aliases and EA registrations
        </p>
      </div>

      <div className="flex-1 p-8 max-w-5xl">
        <div className="flex justify-end mb-3">
          <AddBrokerDialog />
        </div>
        <div className="border border-border rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                {["Broker", "Slug", "Website", "Status", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">Loading...</td></tr>
              ) : brokers.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">No brokers yet</td></tr>
              ) : (
                brokers.map((b) => (
                  <tr key={b.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                    <td className="px-4 py-3 font-mono text-xs font-medium flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-primary" aria-hidden="true" /> {b.name}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{b.slug}</td>
                    <td className="px-4 py-3 text-xs">
                      {b.website ? (
                        <a
                          href={b.website}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring rounded-sm"
                        >
                          {b.website} <ExternalLink className="w-3 h-3" aria-hidden="true" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleActive(b.id, !b.isActive)}
                        className="flex items-center gap-1 text-xs font-mono focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring rounded-sm"
                        aria-label={b.isActive ? `Deactivate ${b.name}` : `Activate ${b.name}`}
                      >
                        {b.isActive ? (
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
                        onClick={() => handleDelete(b.id)}
                        aria-label={`Delete ${b.name}`}
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
