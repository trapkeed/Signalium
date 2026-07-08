import { useState } from "react";
import {
  useListPlans,
  useCreatePlan,
  useUpdatePlan,
  useDeletePlan,
  getListPlansQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ScrollText, Plus, Trash2, Pencil, Zap, Bot, Terminal, Microscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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

type PlanFormState = {
  name: string;
  description: string;
  priceMonthly: string;
  tier: "starter" | "professional" | "enterprise";
  features: string;
  maxEas: string;
  maxSymbols: string;
  autonomousAllowed: boolean;
  apiAccessAllowed: boolean;
  researchAccess: boolean;
  isActive: boolean;
};

const EMPTY_FORM: PlanFormState = {
  name: "",
  description: "",
  priceMonthly: "",
  tier: "starter",
  features: "",
  maxEas: "",
  maxSymbols: "",
  autonomousAllowed: false,
  apiAccessAllowed: true,
  researchAccess: true,
  isActive: true,
};

function PlanFormDialog({
  trigger,
  initial,
  onSubmit,
  submitting,
  title,
}: {
  trigger: React.ReactNode;
  initial: PlanFormState;
  onSubmit: (values: PlanFormState) => Promise<void>;
  submitting: boolean;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PlanFormState>(initial);

  async function handleSubmit() {
    if (!form.name || !form.priceMonthly) return;
    await onSubmit(form);
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setForm(initial);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="rounded-sm max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground">Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Professional"
                className="rounded-sm font-mono text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground">Price / month (USD)</Label>
              <Input
                type="number"
                value={form.priceMonthly}
                onChange={(e) => setForm((f) => ({ ...f, priceMonthly: e.target.value }))}
                placeholder="49"
                className="rounded-sm font-mono text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-mono text-muted-foreground">Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Short marketing description"
              className="rounded-sm font-mono text-sm"
              rows={2}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-mono text-muted-foreground">Features (one per line, marketing only)</Label>
            <Textarea
              value={form.features}
              onChange={(e) => setForm((f) => ({ ...f, features: e.target.value }))}
              placeholder={"Autonomous trading\nUnlimited symbols"}
              className="rounded-sm font-mono text-sm"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground">Tier (display/ordering only)</Label>
              <Select value={form.tier} onValueChange={(v) => setForm((f) => ({ ...f, tier: v as PlanFormState["tier"] }))}>
                <SelectTrigger className="rounded-sm font-mono text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="professional">Professional</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
              <Label className="text-xs font-mono text-muted-foreground">Active (purchasable)</Label>
            </div>
          </div>

          <div className="border-t border-border pt-3 mt-1">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Entitlements — read by the EntitlementEngine
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-mono text-muted-foreground">Max active EAs (blank = unlimited)</Label>
                <Input
                  type="number"
                  value={form.maxEas}
                  onChange={(e) => setForm((f) => ({ ...f, maxEas: e.target.value }))}
                  placeholder="Unlimited"
                  className="rounded-sm font-mono text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-mono text-muted-foreground">Max symbols (blank = unlimited)</Label>
                <Input
                  type="number"
                  value={form.maxSymbols}
                  onChange={(e) => setForm((f) => ({ ...f, maxSymbols: e.target.value }))}
                  placeholder="Unlimited"
                  className="rounded-sm font-mono text-sm"
                />
              </div>
            </div>
            <div className="flex flex-col gap-2.5 mt-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-mono flex items-center gap-1.5"><Bot className="w-3.5 h-3.5" /> Autonomous mode allowed</Label>
                <Switch checked={form.autonomousAllowed} onCheckedChange={(v) => setForm((f) => ({ ...f, autonomousAllowed: v }))} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-mono flex items-center gap-1.5"><Terminal className="w-3.5 h-3.5" /> API access allowed</Label>
                <Switch checked={form.apiAccessAllowed} onCheckedChange={(v) => setForm((f) => ({ ...f, apiAccessAllowed: v }))} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-mono flex items-center gap-1.5"><Microscope className="w-3.5 h-3.5" /> Research access</Label>
                <Switch checked={form.researchAccess} onCheckedChange={(v) => setForm((f) => ({ ...f, researchAccess: v }))} />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" className="rounded-sm font-mono text-xs">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={submitting} className="rounded-sm font-mono text-xs">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminPlans() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: plans = [], isLoading } = useListPlans();
  const createPlan = useCreatePlan();
  const updatePlan = useUpdatePlan();
  const deletePlan = useDeletePlan();

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListPlansQueryKey() });
  }

  async function handleCreate(values: PlanFormState) {
    try {
      await createPlan.mutateAsync({
        data: {
          name: values.name,
          description: values.description || undefined,
          priceMonthly: Number(values.priceMonthly),
          tier: values.tier,
          features: values.features.split("\n").map((f) => f.trim()).filter(Boolean),
          maxEas: values.maxEas ? Number(values.maxEas) : undefined,
          maxSymbols: values.maxSymbols ? Number(values.maxSymbols) : undefined,
          autonomousAllowed: values.autonomousAllowed,
          apiAccessAllowed: values.apiAccessAllowed,
          researchAccess: values.researchAccess,
          isActive: values.isActive,
        },
      });
      toast({ title: "Plan created" });
      invalidate();
    } catch (err: any) {
      toast({ title: "Failed to create plan", description: err?.message, variant: "destructive" });
    }
  }

  async function handleUpdate(id: number, values: PlanFormState) {
    try {
      await updatePlan.mutateAsync({
        id,
        data: {
          name: values.name,
          description: values.description || undefined,
          priceMonthly: Number(values.priceMonthly),
          tier: values.tier,
          features: values.features.split("\n").map((f) => f.trim()).filter(Boolean),
          maxEas: values.maxEas ? Number(values.maxEas) : undefined,
          maxSymbols: values.maxSymbols ? Number(values.maxSymbols) : undefined,
          autonomousAllowed: values.autonomousAllowed,
          apiAccessAllowed: values.apiAccessAllowed,
          researchAccess: values.researchAccess,
          isActive: values.isActive,
        },
      });
      toast({ title: "Plan updated" });
      invalidate();
    } catch (err: any) {
      toast({ title: "Failed to update plan", description: err?.message, variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this plan? Existing subscriptions referencing it will be unaffected but new signups won't be possible.")) return;
    try {
      await deletePlan.mutateAsync({ id });
      toast({ title: "Plan deleted" });
      invalidate();
    } catch (err: any) {
      toast({ title: "Failed to delete plan", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight">Plans</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Define pricing tiers and the capability limits the EntitlementEngine enforces for each one
          </p>
        </div>
        <PlanFormDialog
          title="New Plan"
          initial={EMPTY_FORM}
          submitting={createPlan.isPending}
          onSubmit={handleCreate}
          trigger={
            <Button size="sm" className="gap-1.5 font-mono text-xs rounded-sm">
              <Plus className="w-3.5 h-3.5" /> New Plan
            </Button>
          }
        />
      </div>

      <div className="flex-1 p-8 max-w-6xl">
        <div className="border border-border rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                {["Plan", "Price", "Max EAs", "Max Symbols", "Capabilities", "Status", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">Loading...</td></tr>
              ) : plans.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground font-mono text-xs">
                    <div className="flex flex-col items-center gap-2">
                      <ScrollText className="w-5 h-5" />
                      No plans yet
                    </div>
                  </td>
                </tr>
              ) : (
                plans.map((plan) => (
                  <tr key={plan.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs font-medium">{plan.name}</div>
                      <div className="text-xs text-muted-foreground capitalize">{plan.tier}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">${plan.priceMonthly}/mo</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{plan.maxEas ?? "Unlimited"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{plan.maxSymbols ?? "Unlimited"}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {plan.autonomousAllowed && (
                          <Badge variant="outline" className="rounded-sm font-mono text-[10px] gap-1"><Bot className="w-3 h-3" /> Autonomous</Badge>
                        )}
                        {plan.apiAccessAllowed && (
                          <Badge variant="outline" className="rounded-sm font-mono text-[10px] gap-1"><Terminal className="w-3 h-3" /> API</Badge>
                        )}
                        {plan.researchAccess && (
                          <Badge variant="outline" className="rounded-sm font-mono text-[10px] gap-1"><Microscope className="w-3 h-3" /> Research</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {plan.isActive ? (
                        <span className="flex items-center gap-1 text-xs font-mono text-success"><Zap className="w-3 h-3" /> active</span>
                      ) : (
                        <span className="text-xs font-mono text-muted-foreground">inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <PlanFormDialog
                          title={`Edit ${plan.name}`}
                          submitting={updatePlan.isPending}
                          onSubmit={(values) => handleUpdate(plan.id, values)}
                          initial={{
                            name: plan.name,
                            description: plan.description ?? "",
                            priceMonthly: String(plan.priceMonthly),
                            tier: plan.tier,
                            features: (plan.features as string[] | undefined)?.join("\n") ?? "",
                            maxEas: plan.maxEas != null ? String(plan.maxEas) : "",
                            maxSymbols: plan.maxSymbols != null ? String(plan.maxSymbols) : "",
                            autonomousAllowed: plan.autonomousAllowed ?? false,
                            apiAccessAllowed: plan.apiAccessAllowed ?? true,
                            researchAccess: plan.researchAccess ?? true,
                            isActive: plan.isActive,
                          }}
                          trigger={
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-sm" title="Edit" aria-label={`Edit ${plan.name}`}>
                              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                            </Button>
                          }
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive h-7 w-7 p-0 rounded-sm"
                          onClick={() => handleDelete(plan.id)}
                          title="Delete"
                          aria-label={`Delete ${plan.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </Button>
                      </div>
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
