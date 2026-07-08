import { useState } from "react";
import { Link } from "wouter";
import { useListMySupportTickets, useCreateSupportTicket, useRequestSupportTicketAttachmentUploadUrl } from "@workspace/api-client-react";
import type { SupportTicket } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { LifeBuoy, Plus, ChevronRight, Paperclip } from "lucide-react";

function statusVariant(status: SupportTicket["status"]): "default" | "secondary" | "outline" | "destructive" {
  if (status === "open") return "default";
  if (status === "pending") return "secondary";
  if (status === "resolved") return "outline";
  return "destructive";
}

export default function Support() {
  const { toast } = useToast();
  const { data: tickets = [], isLoading, refetch } = useListMySupportTickets();
  const createTicket = useCreateSupportTicket();
  const requestUploadUrl = useRequestSupportTicketAttachmentUploadUrl();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ subject: "", message: "", priority: "normal" as SupportTicket["priority"] });
  const [file, setFile] = useState<File | null>(null);

  function field<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleCreate() {
    if (!form.subject.trim() || !form.message.trim()) {
      toast({ title: "Subject and message are required", variant: "destructive" });
      return;
    }
    try {
      let attachmentPath: string | undefined;
      if (file) {
        const { uploadURL, objectPath } = await requestUploadUrl.mutateAsync();
        await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
        attachmentPath = objectPath;
      }
      await createTicket.mutateAsync({ data: { ...form, attachmentPath } });
      toast({ title: "Ticket submitted" });
      setForm({ subject: "", message: "", priority: "normal" });
      setFile(null);
      setShowForm(false);
      refetch();
    } catch (err) {
      toast({ title: "Failed to submit ticket", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  }

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-4xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-primary" /> Support
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Submit and track support tickets.</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="gap-2 font-mono text-xs rounded-sm shrink-0">
          <Plus className="w-4 h-4" /> New Ticket
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {isLoading ? (
          <div className="text-sm text-muted-foreground font-mono">Loading...</div>
        ) : tickets.length === 0 ? (
          <div className="border border-border rounded-sm p-12 text-center text-muted-foreground font-mono text-xs">
            No support tickets yet.
          </div>
        ) : (
          tickets.map((t) => (
            <Link
              key={t.id}
              href={`/support/${t.id}`}
              className="border border-border rounded-sm bg-card p-5 flex items-center justify-between gap-4 hover:border-primary/40 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-medium text-sm">{t.subject}</span>
                  <Badge variant={statusVariant(t.status)} className="text-xs font-mono rounded-sm">{t.status}</Badge>
                  <Badge variant="outline" className="text-xs font-mono rounded-sm">{t.priority}</Badge>
                </div>
                <div className="text-xs text-muted-foreground/70 font-mono">
                  Updated {new Date(t.updatedAt).toLocaleString()}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </Link>
          ))
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-card border-border rounded-sm max-w-lg">
          <DialogHeader>
            <DialogTitle>New Support Ticket</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Subject</Label>
              <Input value={form.subject} onChange={(e) => field("subject", e.target.value)} className="rounded-sm text-sm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Priority</Label>
              <Select value={form.priority} onValueChange={(v) => field("priority", v as SupportTicket["priority"])}>
                <SelectTrigger className="rounded-sm text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Message</Label>
              <Textarea rows={5} value={form.message} onChange={(e) => field("message", e.target.value)} className="rounded-sm text-sm" />
            </div>
            <label className="text-xs text-muted-foreground font-mono flex items-center gap-2 cursor-pointer w-fit">
              <Paperclip className="w-3.5 h-3.5" />
              {file ? file.name : "Attach a file (optional)"}
              <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={handleCreate} disabled={createTicket.isPending} className="rounded-sm">
              {createTicket.isPending ? "Submitting..." : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
