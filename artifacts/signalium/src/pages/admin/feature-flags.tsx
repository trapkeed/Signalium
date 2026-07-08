import { useState } from "react";
import {
  useListFeatureFlagsAdmin,
  useCreateFeatureFlag,
  useUpdateFeatureFlag,
  useDeleteFeatureFlag,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Flag, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

function AddFeatureFlagDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const createFlag = useCreateFeatureFlag();

  async function handleSubmit() {
    if (!key || !label) return;
    try {
      await createFlag.mutateAsync({ data: { key, label, description: description || undefined } });
      toast({ title: "Feature flag created" });
      setKey("");
      setLabel("");
      setDescription("");
      setOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to create feature flag", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5 font-mono text-xs rounded-sm">
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> New Flag
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-sm">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">New Feature Flag</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="flag-key" className="text-xs font-mono text-muted-foreground">Key</Label>
            <Input id="flag-key" value={key} onChange={(e) => setKey(e.target.value.toLowerCase().replace(/\s+/g, "_"))} placeholder="referrals_enabled" className="rounded-sm font-mono text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="flag-label" className="text-xs font-mono text-muted-foreground">Label</Label>
            <Input id="flag-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Referral Program" className="rounded-sm font-mono text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="flag-description" className="text-xs font-mono text-muted-foreground">Description (optional)</Label>
            <Input id="flag-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Gates the referral program tab and admin page" className="rounded-sm font-mono text-sm" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" className="rounded-sm font-mono text-xs">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={createFlag.isPending} className="rounded-sm font-mono text-xs">
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminFeatureFlags() {
  const { toast } = useToast();
  const { data: flags = [], isLoading, refetch } = useListFeatureFlagsAdmin();
  const updateFlag = useUpdateFeatureFlag();
  const deleteFlag = useDeleteFeatureFlag();

  async function handleToggle(id: number, enabled: boolean) {
    try {
      await updateFlag.mutateAsync({ id, data: { enabled } });
      refetch();
    } catch (err: any) {
      toast({ title: "Failed to update feature flag", description: err?.message, variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteFlag.mutateAsync({ id });
      toast({ title: "Feature flag deleted" });
      refetch();
    } catch (err: any) {
      toast({ title: "Failed to delete feature flag", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-xl font-bold font-mono tracking-tight">Feature Flags</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Toggle features on or off across the platform by key, without a deploy
        </p>
      </div>

      <div className="flex-1 p-8 max-w-4xl">
        <div className="flex justify-end mb-3">
          <AddFeatureFlagDialog />
        </div>
        <div className="border border-border rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                {["Flag", "Key", "Description", "Enabled", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">Loading...</td></tr>
              ) : flags.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">No feature flags yet</td></tr>
              ) : (
                flags.map((f) => (
                  <tr key={f.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                    <td className="px-4 py-3 font-mono text-xs font-medium flex items-center gap-1.5">
                      <Flag className="w-3.5 h-3.5 text-primary" aria-hidden="true" /> {f.label}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{f.key}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{f.description ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Switch
                        checked={f.enabled}
                        onCheckedChange={(checked) => handleToggle(f.id, checked)}
                        aria-label={`${f.enabled ? "Disable" : "Enable"} ${f.label}`}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive h-7 w-7 p-0 rounded-sm"
                        onClick={() => handleDelete(f.id)}
                        aria-label={`Delete ${f.label}`}
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
