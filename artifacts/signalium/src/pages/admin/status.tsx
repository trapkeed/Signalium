import { useState } from "react";
import {
  useGetAdminStatus,
  useUpdatePlatformStatus,
  useCreateStatusIncident,
  useUpdateStatusIncident,
  useDeleteStatusIncident,
} from "@workspace/api-client-react";
import type { StatusIncident, UpdatePlatformStatusBodyStatus } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Activity, Plus, Trash2, Pencil } from "lucide-react";

const PLATFORM_STATUSES: UpdatePlatformStatusBodyStatus[] = ["operational", "degraded", "partial_outage", "major_outage"];

export default function AdminStatusPage() {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useGetAdminStatus();
  const updateStatus = useUpdatePlatformStatus();
  const createIncident = useCreateStatusIncident();
  const updateIncident = useUpdateStatusIncident();
  const deleteIncident = useDeleteStatusIncident();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<StatusIncident | null>(null);
  const [form, setForm] = useState<{ title: string; message: string; impact: StatusIncident["impact"]; status: StatusIncident["status"] }>({
    title: "",
    message: "",
    impact: "minor",
    status: "investigating",
  });

  async function handlePlatformStatusChange(status: UpdatePlatformStatusBodyStatus) {
    try {
      await updateStatus.mutateAsync({ data: { status } });
      toast({ title: "Platform status updated" });
      refetch();
    } catch {
      toast({ title: "Failed to update platform status", variant: "destructive" });
    }
  }

  function openCreate() {
    setEditing(null);
    setForm({ title: "", message: "", impact: "minor", status: "investigating" });
    setShowForm(true);
  }

  function openEdit(i: StatusIncident) {
    setEditing(i);
    setForm({ title: i.title, message: i.message, impact: i.impact, status: i.status });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.title.trim() || !form.message.trim()) {
      toast({ title: "Title and message are required", variant: "destructive" });
      return;
    }
    try {
      if (editing) {
        await updateIncident.mutateAsync({ id: editing.id, data: form });
      } else {
        await createIncident.mutateAsync({ data: { title: form.title, message: form.message, impact: form.impact } });
      }
      toast({ title: editing ? "Incident updated" : "Incident created" });
      setShowForm(false);
      refetch();
    } catch (err) {
      toast({ title: "Failed to save incident", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  }

  async function handleDelete(i: StatusIncident) {
    if (!confirm(`Delete incident "${i.title}"?`)) return;
    try {
      await deleteIncident.mutateAsync({ id: i.id });
      refetch();
    } catch {
      toast({ title: "Failed to delete incident", variant: "destructive" });
    }
  }

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" /> Platform Status
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Control the public status page and manage incidents.</p>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground font-mono">Loading...</div>
      ) : (
        <>
          <div className="border border-border rounded-sm bg-card p-5 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">Current overall status</div>
              <div className="text-lg font-medium">{data?.status.status}</div>
            </div>
            <Select value={data?.status.status} onValueChange={(v) => handlePlatformStatusChange(v as UpdatePlatformStatusBodyStatus)}>
              <SelectTrigger className="w-48 rounded-sm text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PLATFORM_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted-foreground font-mono">
            Note: the maintenance banner controls the "maintenance" state shown on the public status page independently of this selector.
          </p>

          <div className="flex items-center justify-between gap-4">
            <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Incidents</h2>
            <Button onClick={openCreate} className="gap-2 font-mono text-xs rounded-sm">
              <Plus className="w-4 h-4" /> New Incident
            </Button>
          </div>

          <div className="flex flex-col gap-3">
            {(data?.incidents ?? []).length === 0 ? (
              <div className="border border-border rounded-sm p-10 text-center text-muted-foreground font-mono text-xs">
                No incidents.
              </div>
            ) : (
              data?.incidents.map((i) => (
                <div key={i.id} className="border border-border rounded-sm bg-card p-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-medium text-sm">{i.title}</span>
                      <Badge variant="outline" className="text-xs font-mono rounded-sm">{i.impact}</Badge>
                      <Badge variant="outline" className="text-xs font-mono rounded-sm capitalize">{i.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{i.message}</p>
                    <div className="text-xs text-muted-foreground/60 font-mono mt-1">Updated {new Date(i.updatedAt).toLocaleString()}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => openEdit(i)} className="rounded-sm"><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="outline" size="sm" onClick={() => handleDelete(i)} className="rounded-sm text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-card border-border rounded-sm max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} Incident</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Title</Label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="rounded-sm text-sm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Message</Label>
              <Textarea rows={4} value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} className="rounded-sm text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Impact</Label>
                <Select value={form.impact} onValueChange={(v) => setForm((f) => ({ ...f, impact: v as StatusIncident["impact"] }))}>
                  <SelectTrigger className="rounded-sm text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minor">Minor</SelectItem>
                    <SelectItem value="major">Major</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {editing && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v as StatusIncident["status"] }))}>
                    <SelectTrigger className="rounded-sm text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="investigating">Investigating</SelectItem>
                      <SelectItem value="identified">Identified</SelectItem>
                      <SelectItem value="monitoring">Monitoring</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={handleSave} className="rounded-sm">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
