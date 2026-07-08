import { useState } from "react";
import { useListSmtpSettings, useCreateSmtpSettings, useUpdateSmtpSettings, useDeleteSmtpSettings, useTestSmtp } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Mail, Plus, Trash2, CheckCircle, TestTube, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

type SmtpForm = {
  host: string; port: string; username: string; password: string;
  fromEmail: string; fromName: string; useTls: boolean; isActive: boolean;
};

const EMPTY_FORM: SmtpForm = {
  host: "", port: "587", username: "", password: "",
  fromEmail: "", fromName: "Signalium", useTls: true, isActive: false,
};

export default function AdminSmtp() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<SmtpForm>(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testDialogOpen, setTestDialogOpen] = useState(false);

  const { data: configs = [], refetch } = useListSmtpSettings();
  const createConfig = useCreateSmtpSettings();
  const updateConfig = useUpdateSmtpSettings();
  const deleteConfig = useDeleteSmtpSettings();
  const testConfig = useTestSmtp();

  function openCreate() { setEditId(null); setForm(EMPTY_FORM); setShowForm(true); }

  function openEdit(c: typeof configs[0]) {
    setEditId(c.id);
    setForm({
      host: c.host, port: String(c.port ?? 587), username: c.username,
      password: "", fromEmail: c.fromEmail, fromName: c.fromName,
      useTls: c.useTls, isActive: c.isActive,
    });
    setShowForm(true);
  }

  async function handleSave() {
    const payload = {
      host: form.host, port: Number(form.port), username: form.username,
      fromEmail: form.fromEmail, fromName: form.fromName,
      useTls: form.useTls, isActive: form.isActive,
      ...(form.password && { password: form.password }),
    };
    try {
      if (editId) {
        await updateConfig.mutateAsync({ id: editId, data: payload });
        toast({ title: "SMTP configuration updated" });
      } else {
        if (!form.password) { toast({ title: "Password required", variant: "destructive" }); return; }
        await createConfig.mutateAsync({ data: { ...payload, password: form.password } });
        toast({ title: "SMTP configuration created" });
      }
      setShowForm(false);
      refetch();
    } catch {
      toast({ title: "Failed to save SMTP configuration", variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteConfig.mutateAsync({ id });
      toast({ title: "Configuration deleted" });
      refetch();
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  }

  async function handleTest() {
    if (!testEmail) return;
    try {
      const result = await testConfig.mutateAsync({ data: { to: testEmail } }) as any;
      toast({ title: result?.message ?? "Test completed" });
      setTestDialogOpen(false);
    } catch {
      toast({ title: "Test failed", variant: "destructive" });
    }
  }

  function field(key: keyof SmtpForm, value: string | boolean) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight">SMTP Configuration</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage email delivery settings. Only one config can be active at a time.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setTestDialogOpen(true)} className="gap-2 font-mono text-xs rounded-sm">
            <TestTube className="w-4 h-4" /> Test
          </Button>
          <Button onClick={openCreate} className="gap-2 font-mono text-xs rounded-sm">
            <Plus className="w-4 h-4" /> Add Config
          </Button>
        </div>
      </div>

      <div className="p-8 max-w-4xl flex flex-col gap-4">
        {configs.length === 0 ? (
          <div className="border border-border rounded-sm p-12 text-center text-muted-foreground font-mono text-xs">
            No SMTP configurations yet. Add one to enable email delivery.
          </div>
        ) : (
          configs.map((c) => (
            <div key={c.id} className="border border-border rounded-sm bg-card p-5 flex items-start justify-between gap-4">
              <div className="flex items-start gap-4 min-w-0">
                <div className="w-9 h-9 rounded-sm bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Mail className="w-4 h-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium font-mono text-sm">{c.host}:{c.port}</span>
                    {c.isActive && <Badge className="bg-primary/10 text-primary border-primary/20 text-xs font-mono rounded-sm">active</Badge>}
                    {c.useTls && <span className="text-xs text-muted-foreground font-mono">TLS</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    From: <span className="text-foreground">{c.fromName} &lt;{c.fromEmail}&gt;</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Auth: <span className="text-foreground font-mono">{c.username}</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" className="rounded-sm text-xs" onClick={() => openEdit(c)}>Edit</Button>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive h-8 w-8 p-0 rounded-sm" onClick={() => handleDelete(c.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Form dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-card border-border rounded-sm max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono">{editId ? "Edit SMTP Config" : "New SMTP Config"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            {([
              ["host", "Host", "smtp.example.com", false],
              ["port", "Port", "587", false],
              ["username", "Username", "user@example.com", false],
              ["fromEmail", "From Email", "noreply@signalium.com", false],
              ["fromName", "From Name", "Signalium", false],
            ] as [keyof SmtpForm, string, string, boolean][]).map(([key, label, placeholder]) => (
              <div key={key} className={`flex flex-col gap-1.5 ${key === "host" || key === "fromEmail" || key === "fromName" ? "col-span-2" : ""}`}>
                <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{label}</Label>
                <Input
                  value={form[key] as string}
                  onChange={(e) => field(key, e.target.value)}
                  placeholder={placeholder}
                  className="rounded-sm font-mono text-sm"
                />
              </div>
            ))}
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Password {editId && <span className="normal-case">(leave blank to keep current)</span>}
              </Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => field("password", e.target.value)}
                  placeholder={editId ? "•••••••• (unchanged)" : "SMTP password"}
                  className="rounded-sm font-mono text-sm pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3 col-span-2">
              <Switch checked={form.useTls} onCheckedChange={(v) => field("useTls", v)} />
              <Label className="text-sm">Use TLS/STARTTLS</Label>
            </div>
            <div className="flex items-center gap-3 col-span-2">
              <Switch checked={form.isActive} onCheckedChange={(v) => field("isActive", v)} />
              <Label className="text-sm">Set as active configuration</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={handleSave} disabled={createConfig.isPending || updateConfig.isPending} className="rounded-sm font-mono">
              {(createConfig.isPending || updateConfig.isPending) ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test dialog */}
      <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
        <DialogContent className="bg-card border-border rounded-sm max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-mono">Test SMTP</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Send test email to</Label>
            <Input
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="test@example.com"
              className="rounded-sm font-mono text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestDialogOpen(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={handleTest} disabled={!testEmail || testConfig.isPending} className="rounded-sm font-mono">
              {testConfig.isPending ? "Sending..." : "Send Test"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
