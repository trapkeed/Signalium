import { useState } from "react";
import {
  useListAnnouncements,
  useCreateAnnouncement,
  useUpdateAnnouncement,
  useDeleteAnnouncement,
  usePublishAnnouncement,
  useRetractAnnouncement,
} from "@workspace/api-client-react";
import type { Announcement } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Megaphone, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Form = {
  title: string;
  body: string;
  audience: "all" | "plan_tier";
  planTier: "starter" | "professional" | "enterprise";
  showAsBanner: boolean;
  expiresAt: string;
};

const EMPTY_FORM: Form = {
  title: "",
  body: "",
  audience: "all",
  planTier: "starter",
  showAsBanner: false,
  expiresAt: "",
};

function statusVariant(status: Announcement["status"]): "default" | "secondary" | "outline" {
  if (status === "published") return "default";
  if (status === "draft") return "outline";
  return "secondary";
}

export default function AdminAnnouncements() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);

  const { data: announcements = [], refetch } = useListAnnouncements();
  const createAnnouncement = useCreateAnnouncement();
  const updateAnnouncement = useUpdateAnnouncement();
  const deleteAnnouncement = useDeleteAnnouncement();
  const publishAnnouncement = usePublishAnnouncement();
  const retractAnnouncement = useRetractAnnouncement();

  function field<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function openCreate() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(a: Announcement) {
    setEditId(a.id);
    setForm({
      title: a.title,
      body: a.body,
      audience: a.audience,
      planTier: (a.planTier as Form["planTier"]) ?? "starter",
      showAsBanner: a.showAsBanner,
      expiresAt: a.expiresAt ? a.expiresAt.slice(0, 16) : "",
    });
    setShowForm(true);
  }

  function payload() {
    return {
      title: form.title,
      body: form.body,
      audience: form.audience,
      planTier: form.audience === "plan_tier" ? form.planTier : undefined,
      showAsBanner: form.showAsBanner,
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
    };
  }

  async function handleSave() {
    if (!form.title.trim() || !form.body.trim()) {
      toast({ title: "Title and body are required", variant: "destructive" });
      return;
    }
    try {
      if (editId) {
        await updateAnnouncement.mutateAsync({ id: editId, data: payload() });
        toast({ title: "Announcement updated" });
      } else {
        await createAnnouncement.mutateAsync({ data: payload() });
        toast({ title: "Announcement created as draft" });
      }
      setShowForm(false);
      refetch();
    } catch (err) {
      toast({ title: "Failed to save", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteAnnouncement.mutateAsync({ id });
      toast({ title: "Announcement deleted" });
      refetch();
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  }

  async function handlePublish(id: number) {
    try {
      await publishAnnouncement.mutateAsync({ id });
      toast({ title: "Announcement published and delivered to its audience" });
      refetch();
    } catch (err) {
      toast({ title: "Failed to publish", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  }

  async function handleRetract(id: number) {
    try {
      await retractAnnouncement.mutateAsync({ id });
      toast({ title: "Announcement retracted" });
      refetch();
    } catch {
      toast({ title: "Failed to retract", variant: "destructive" });
    }
  }

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-4xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-primary" /> Announcements
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Publish announcements to users' notification centers, optionally shown as a banner.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2 font-mono text-xs rounded-sm shrink-0">
          <Plus className="w-4 h-4" /> New Announcement
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {announcements.length === 0 ? (
          <div className="border border-border rounded-sm p-12 text-center text-muted-foreground font-mono text-xs">
            No announcements yet.
          </div>
        ) : (
          announcements.map((a) => (
            <div key={a.id} className="border border-border rounded-sm bg-card p-5 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-medium text-sm">{a.title}</span>
                  <Badge variant={statusVariant(a.status)} className="text-xs font-mono rounded-sm">{a.status}</Badge>
                  <Badge variant="outline" className="text-xs font-mono rounded-sm">
                    {a.audience === "all" ? "all users" : `plan: ${a.planTier}`}
                  </Badge>
                  {a.showAsBanner && <Badge variant="outline" className="text-xs font-mono rounded-sm">banner</Badge>}
                </div>
                <div className="text-sm text-muted-foreground truncate">{a.body}</div>
                {a.expiresAt && (
                  <div className="text-xs text-muted-foreground/70 mt-1 font-mono">
                    Expires {new Date(a.expiresAt).toLocaleString()}
                  </div>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                {a.status !== "published" ? (
                  <Button variant="outline" size="sm" className="rounded-sm text-xs gap-1" onClick={() => handlePublish(a.id)}>
                    <Send className="w-3.5 h-3.5" /> Publish
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="rounded-sm text-xs gap-1" onClick={() => handleRetract(a.id)}>
                    <Undo2 className="w-3.5 h-3.5" /> Retract
                  </Button>
                )}
                <Button variant="outline" size="sm" className="rounded-sm text-xs" onClick={() => openEdit(a)}>Edit</Button>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive h-8 w-8 p-0 rounded-sm" onClick={() => handleDelete(a.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-card border-border rounded-sm max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Announcement" : "New Announcement"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Title</Label>
              <Input value={form.title} onChange={(e) => field("title", e.target.value)} className="rounded-sm text-sm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Body</Label>
              <Textarea value={form.body} onChange={(e) => field("body", e.target.value)} className="rounded-sm text-sm" rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Audience</Label>
                <Select value={form.audience} onValueChange={(v) => field("audience", v as Form["audience"])}>
                  <SelectTrigger className="rounded-sm text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All users</SelectItem>
                    <SelectItem value="plan_tier">By plan tier</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.audience === "plan_tier" && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Plan Tier</Label>
                  <Select value={form.planTier} onValueChange={(v) => field("planTier", v as Form["planTier"])}>
                    <SelectTrigger className="rounded-sm text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starter">Starter</SelectItem>
                      <SelectItem value="professional">Professional</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Expires At (optional)</Label>
              <Input type="datetime-local" value={form.expiresAt} onChange={(e) => field("expiresAt", e.target.value)} className="rounded-sm text-sm" />
            </div>
            <div className="flex items-center justify-between border border-border rounded-sm p-3">
              <div>
                <div className="text-sm font-medium">Show as banner</div>
                <div className="text-xs text-muted-foreground">Also display across the app while published and not expired.</div>
              </div>
              <Switch checked={form.showAsBanner} onCheckedChange={(v) => field("showAsBanner", v)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={handleSave} className="rounded-sm">{editId ? "Save" : "Create Draft"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
