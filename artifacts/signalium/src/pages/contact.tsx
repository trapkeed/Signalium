import { useState } from "react";
import { useSubmitContactMessage } from "@workspace/api-client-react";
import { PublicShell } from "@/components/public-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Mail, CheckCircle2 } from "lucide-react";

export default function Contact() {
  const { toast } = useToast();
  const submitContact = useSubmitContactMessage();
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [submitted, setSubmitted] = useState(false);

  function field<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.subject.trim() || !form.message.trim()) {
      toast({ title: "Please fill out every field", variant: "destructive" });
      return;
    }
    try {
      await submitContact.mutateAsync({ data: form });
      setSubmitted(true);
    } catch (err) {
      toast({ title: "Failed to send message", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  }

  return (
    <PublicShell>
      <section className="max-w-2xl mx-auto px-6 py-20">
        <div className="flex items-center gap-2 text-sm text-primary tracking-widest uppercase mb-4">
          <Mail className="w-4 h-4" /> Contact
        </div>
        <h1 className="text-3xl md:text-4xl font-normal text-white mb-4">Get in touch</h1>
        <p className="text-muted-foreground font-light mb-12">
          Have a question before you sign up, or need to reach the team? Send us a message and we'll get back to you.
        </p>

        {submitted ? (
          <div className="border border-white/10 bg-card rounded p-10 text-center flex flex-col items-center gap-3">
            <CheckCircle2 className="w-8 h-8 text-primary" />
            <div className="text-white font-medium">Message sent</div>
            <p className="text-sm text-muted-foreground font-light">Thanks for reaching out — we'll respond to {form.email} soon.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="grid sm:grid-cols-2 gap-5">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Name</Label>
                <Input value={form.name} onChange={(e) => field("name", e.target.value)} className="rounded-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Email</Label>
                <Input type="email" value={form.email} onChange={(e) => field("email", e.target.value)} className="rounded-sm" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Subject</Label>
              <Input value={form.subject} onChange={(e) => field("subject", e.target.value)} className="rounded-sm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Message</Label>
              <Textarea rows={6} value={form.message} onChange={(e) => field("message", e.target.value)} className="rounded-sm" />
            </div>
            <Button type="submit" disabled={submitContact.isPending} className="rounded-sm self-start px-8">
              {submitContact.isPending ? "Sending..." : "Send message"}
            </Button>
          </form>
        )}
      </section>
    </PublicShell>
  );
}
