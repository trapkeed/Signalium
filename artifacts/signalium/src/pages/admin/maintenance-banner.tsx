import { useEffect, useState } from "react";
import { useGetMaintenanceBanner, useUpdateMaintenanceBanner } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

type Form = {
  isEnabled: boolean;
  message: string;
  startsAt: string;
  endsAt: string;
};

const EMPTY_FORM: Form = { isEnabled: false, message: "", startsAt: "", endsAt: "" };

export default function AdminMaintenanceBanner() {
  const { toast } = useToast();
  const { data: banner, refetch } = useGetMaintenanceBanner();
  const updateBanner = useUpdateMaintenanceBanner();
  const [form, setForm] = useState<Form>(EMPTY_FORM);

  useEffect(() => {
    if (!banner) return;
    setForm({
      isEnabled: banner.isEnabled,
      message: banner.message,
      startsAt: banner.startsAt ? banner.startsAt.slice(0, 16) : "",
      endsAt: banner.endsAt ? banner.endsAt.slice(0, 16) : "",
    });
  }, [banner]);

  function field<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    try {
      await updateBanner.mutateAsync({
        data: {
          isEnabled: form.isEnabled,
          message: form.message,
          startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : undefined,
          endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : undefined,
        },
      });
      toast({ title: "Maintenance banner updated" });
      refetch();
    } catch (err) {
      toast({ title: "Failed to save", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  }

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-warning" /> Maintenance Banner
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Show a site-wide banner without needing a deploy. Optionally schedule a start/end window.
        </p>
      </div>

      <div className="border border-border rounded-sm bg-card p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between border border-border rounded-sm p-3">
          <div>
            <div className="text-sm font-medium">Enabled</div>
            <div className="text-xs text-muted-foreground">Turn the banner on or off.</div>
          </div>
          <Switch checked={form.isEnabled} onCheckedChange={(v) => field("isEnabled", v)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Message</Label>
          <Textarea
            value={form.message}
            onChange={(e) => field("message", e.target.value)}
            className="rounded-sm text-sm"
            rows={2}
            placeholder="We'll be performing scheduled maintenance from 2-3am UTC."
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Starts At (optional)</Label>
            <Input type="datetime-local" value={form.startsAt} onChange={(e) => field("startsAt", e.target.value)} className="rounded-sm text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Ends At (optional)</Label>
            <Input type="datetime-local" value={form.endsAt} onChange={(e) => field("endsAt", e.target.value)} className="rounded-sm text-sm" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          If left blank, an enabled banner shows immediately and indefinitely. If set, it only shows within the given window.
        </p>

        <div>
          <Button onClick={handleSave} className="rounded-sm">Save</Button>
        </div>
      </div>
    </div>
  );
}
