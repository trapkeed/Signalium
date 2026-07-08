import { useListContactMessages, useUpdateContactMessage } from "@workspace/api-client-react";
import type { ContactMessage } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Mail } from "lucide-react";

export default function AdminContact() {
  const { toast } = useToast();
  const { data: messages = [], isLoading, refetch } = useListContactMessages();
  const updateMessage = useUpdateContactMessage();

  async function toggleHandled(m: ContactMessage) {
    try {
      await updateMessage.mutateAsync({ id: m.id, data: { status: m.status === "handled" ? "new" : "handled" } });
      refetch();
    } catch {
      toast({ title: "Failed to update message", variant: "destructive" });
    }
  }

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Mail className="w-5 h-5 text-primary" /> Contact Messages
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Messages submitted through the public contact form.</p>
      </div>

      <div className="flex flex-col gap-3">
        {isLoading ? (
          <div className="text-sm text-muted-foreground font-mono">Loading...</div>
        ) : messages.length === 0 ? (
          <div className="border border-border rounded-sm p-12 text-center text-muted-foreground font-mono text-xs">
            No messages yet.
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="border border-border rounded-sm bg-card p-5 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{m.subject}</span>
                    <Badge variant={m.status === "handled" ? "outline" : "default"} className="text-xs font-mono rounded-sm">
                      {m.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground/70 font-mono mt-1">
                    {m.name} &lt;{m.email}&gt; · {new Date(m.createdAt).toLocaleString()}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => toggleHandled(m)} className="rounded-sm text-xs shrink-0">
                  Mark as {m.status === "handled" ? "new" : "handled"}
                </Button>
              </div>
              <p className="text-sm whitespace-pre-wrap text-foreground/90">{m.message}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
