import { useState } from "react";
import { useParams, Link } from "wouter";
import { useGetSupportTicket, useCreateSupportTicketReply, useRequestSupportTicketAttachmentUploadUrl } from "@workspace/api-client-react";
import { useUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Paperclip, Send } from "lucide-react";

export default function SupportTicketDetail() {
  const { id } = useParams<{ id: string }>();
  const ticketId = Number(id);
  const { user } = useUser();
  const { toast } = useToast();

  const { data: ticket, isLoading, refetch } = useGetSupportTicket(ticketId);
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
      await createReply.mutateAsync({ id: ticketId, data: { body: reply, attachmentPath } });
      setReply("");
      setFile(null);
      refetch();
    } catch (err) {
      toast({ title: "Failed to send reply", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  if (isLoading) {
    return <div className="p-8 text-sm text-muted-foreground font-mono">Loading...</div>;
  }

  if (!ticket) {
    return <div className="p-8 text-sm text-muted-foreground font-mono">Ticket not found.</div>;
  }

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-3xl">
      <Link href="/support" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground w-fit">
        <ArrowLeft className="w-4 h-4" /> Back to tickets
      </Link>

      <div>
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h1 className="text-xl font-bold text-foreground">{ticket.subject}</h1>
          <Badge variant="outline" className="text-xs font-mono rounded-sm">{ticket.status}</Badge>
          <Badge variant="outline" className="text-xs font-mono rounded-sm">{ticket.priority}</Badge>
        </div>
        <p className="text-xs text-muted-foreground font-mono">Opened {new Date(ticket.createdAt).toLocaleString()}</p>
      </div>

      <div className="flex flex-col gap-3">
        {ticket.replies.map((r) => {
          const isMe = r.authorId === user?.id;
          return (
            <div
              key={r.id}
              className={`border rounded-sm p-4 ${r.authorRole === "admin" ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  {r.authorRole === "admin" ? "Support Team" : isMe ? "You" : "User"}
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
          );
        })}
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
