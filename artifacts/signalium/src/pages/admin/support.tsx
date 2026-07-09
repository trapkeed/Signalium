import { useState } from "react";
import { Link, useParams } from "wouter";
import {
  useListAllSupportTickets,
  useUpdateSupportTicketAdmin,
  useGetSupportTicket,
  useCreateSupportTicketReply,
  useRequestSupportTicketAttachmentUploadUrl,
  useAssignSupportTicket,
  useEscalateSupportTicket,
} from "@workspace/api-client-react";
import type { SupportTicket } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { LifeBuoy, ArrowLeft, Paperclip, Send } from "lucide-react";

function statusVariant(status: SupportTicket["status"]): "default" | "secondary" | "outline" | "destructive" {
  if (status === "open") return "default";
  if (status === "pending") return "secondary";
  if (status === "resolved") return "outline";
  return "destructive";
}

export default function AdminSupport() {
  const { id } = useParams<{ id?: string }>();
  if (id) return <AdminTicketDetail id={Number(id)} />;
  return <AdminTicketQueue />;
}

function AdminTicketQueue() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { data: tickets = [], isLoading, refetch } = useListAllSupportTickets(
    statusFilter === "all" ? {} : { status: statusFilter as SupportTicket["status"] }
  );
  const updateTicket = useUpdateSupportTicketAdmin();

  async function handleStatusChange(id: number, status: SupportTicket["status"]) {
    try {
      await updateTicket.mutateAsync({ id, data: { status } });
      toast({ title: "Ticket updated" });
      refetch();
    } catch {
      toast({ title: "Failed to update ticket", variant: "destructive" });
    }
  }

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-4xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-primary" /> Support Tickets
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Manage and respond to user support tickets.</p>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 rounded-sm text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-3">
        {isLoading ? (
          <div className="text-sm text-muted-foreground font-mono">Loading...</div>
        ) : tickets.length === 0 ? (
          <div className="border border-border rounded-sm p-12 text-center text-muted-foreground font-mono text-xs">
            No tickets found.
          </div>
        ) : (
          tickets.map((t) => (
            <div key={t.id} className="border border-border rounded-sm bg-card p-5 flex items-center justify-between gap-4">
              <Link href={`/admin/support/${t.id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-medium text-sm">{t.subject}</span>
                  <Badge variant={statusVariant(t.status)} className="text-xs font-mono rounded-sm">{t.status}</Badge>
                  <Badge variant="outline" className="text-xs font-mono rounded-sm">{t.priority}</Badge>
                </div>
                <div className="text-xs text-muted-foreground/70 font-mono">
                  User {t.userId} · Updated {new Date(t.updatedAt).toLocaleString()}
                </div>
              </Link>
              <Select value={t.status} onValueChange={(v) => handleStatusChange(t.id, v as SupportTicket["status"])}>
                <SelectTrigger className="w-32 rounded-sm text-xs shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TicketAssignmentBar({ ticket, onChanged }: { ticket: SupportTicket; onChanged: () => void }) {
  const { toast } = useToast();
  const assign = useAssignSupportTicket();
  const escalate = useEscalateSupportTicket();
  const [adminIdInput, setAdminIdInput] = useState(ticket.assignedAdminId ?? "");

  async function handleAssign() {
    try {
      await assign.mutateAsync({ id: ticket.id, data: { adminId: adminIdInput.trim() || null } });
      toast({ title: adminIdInput.trim() ? "Ticket assigned" : "Ticket unassigned" });
      onChanged();
    } catch {
      toast({ title: "Failed to update assignment", variant: "destructive" });
    }
  }

  async function handleEscalate() {
    try {
      await escalate.mutateAsync({ id: ticket.id });
      toast({ title: "Ticket escalated to urgent" });
      onChanged();
    } catch {
      toast({ title: "Failed to escalate", variant: "destructive" });
    }
  }

  return (
    <div className="flex items-center gap-2 mt-3 flex-wrap">
      <input
        placeholder="Admin user ID"
        value={adminIdInput}
        onChange={(e) => setAdminIdInput(e.target.value)}
        className="h-8 w-48 rounded-sm border border-border bg-background px-2 text-xs font-mono"
      />
      <Button size="sm" variant="outline" className="h-8 rounded-sm text-xs" onClick={handleAssign} disabled={assign.isPending}>
        {ticket.assignedAdminId ? "Reassign" : "Assign"}
      </Button>
      {!ticket.escalatedAt && (
        <Button size="sm" variant="destructive" className="h-8 rounded-sm text-xs" onClick={handleEscalate} disabled={escalate.isPending}>
          Escalate
        </Button>
      )}
    </div>
  );
}

function AdminTicketDetail({ id }: { id: number }) {
  const { toast } = useToast();
  const { data: ticket, isLoading, refetch } = useGetSupportTicket(id);
  const createReply = useCreateSupportTicketReply();
  const requestUploadUrl = useRequestSupportTicketAttachmentUploadUrl();

  const [reply, setReply] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (!reply.trim()) {
      toast({ title: "Enter a reply", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      let attachmentPath: string | undefined;
      if (file) {
        const { uploadURL, objectPath } = await requestUploadUrl.mutateAsync();
        await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
        attachmentPath = objectPath;
      }
      await createReply.mutateAsync({ id, data: { body: reply, attachmentPath } });
      setReply("");
      setFile(null);
      refetch();
    } catch (err) {
      toast({ title: "Failed to send reply", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground font-mono">Loading...</div>;
  if (!ticket) return <div className="p-8 text-sm text-muted-foreground font-mono">Ticket not found.</div>;

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-3xl">
      <Link href="/admin/support" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground w-fit">
        <ArrowLeft className="w-4 h-4" /> Back to queue
      </Link>

      <div>
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h1 className="text-xl font-bold text-foreground">{ticket.subject}</h1>
          <Badge variant="outline" className="text-xs font-mono rounded-sm">{ticket.status}</Badge>
          <Badge variant="outline" className="text-xs font-mono rounded-sm">{ticket.priority}</Badge>
          {ticket.category && <Badge variant="secondary" className="text-xs font-mono rounded-sm">{ticket.category}</Badge>}
          {ticket.escalatedAt && <Badge variant="destructive" className="text-xs font-mono rounded-sm">Escalated</Badge>}
        </div>
        <p className="text-xs text-muted-foreground font-mono">
          User {ticket.userId} · Opened {new Date(ticket.createdAt).toLocaleString()}
          {ticket.assignedAdminId && <> · Assigned to {ticket.assignedAdminId}</>}
        </p>
        <TicketAssignmentBar ticket={ticket} onChanged={refetch} />
      </div>

      <div className="flex flex-col gap-3">
        {ticket.replies.map((r) => (
          <div
            key={r.id}
            className={`border rounded-sm p-4 ${r.authorRole === "admin" ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                {r.authorRole === "admin" ? "Support Team" : "User"}
              </span>
              <span className="text-xs text-muted-foreground/60 font-mono">{new Date(r.createdAt).toLocaleString()}</span>
            </div>
            <div className="text-sm whitespace-pre-wrap">{r.body}</div>
            {r.attachmentPath && (
              <a
                href={`${import.meta.env.BASE_URL}api/support/tickets/${ticket.id}/replies/${r.id}/attachment`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline mt-2"
              >
                <Paperclip className="w-3 h-3" /> Attachment
              </a>
            )}
          </div>
        ))}
      </div>

      <div className="border border-border rounded-sm p-4 bg-card flex flex-col gap-3">
        <Textarea
          rows={4}
          placeholder="Write a reply..."
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          className="rounded-sm text-sm"
        />
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs text-muted-foreground font-mono flex items-center gap-2 cursor-pointer">
            <Paperclip className="w-3.5 h-3.5" />
            {file ? file.name : "Attach a file"}
            <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <Button onClick={handleSend} disabled={sending} className="gap-2 rounded-sm text-xs">
            <Send className="w-3.5 h-3.5" /> {sending ? "Sending..." : "Send reply"}
          </Button>
        </div>
      </div>
    </div>
  );
}
