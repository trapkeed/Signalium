import { useGetMyReferrals } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Gift, Copy, Users } from "lucide-react";

export function ReferralsTab() {
  const { toast } = useToast();
  const { data } = useGetMyReferrals();

  const referralCode = data?.referralCode ?? "";
  const referralLink = referralCode ? `${window.location.origin}${import.meta.env.BASE_URL}?ref=${referralCode}` : "";

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} copied to clipboard` });
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="border border-border rounded-lg bg-card p-6 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Gift className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Refer a friend</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Share your referral link. When someone signs up through it, they're attributed to you here.
        </p>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Your referral code</span>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm font-mono truncate">
              {referralCode || "—"}
            </code>
            <Button
              variant="outline"
              size="icon"
              className="rounded-lg shrink-0"
              disabled={!referralCode}
              onClick={() => copyToClipboard(referralCode, "Referral code")}
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Your referral link</span>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm font-mono truncate">
              {referralLink || "—"}
            </code>
            <Button
              variant="outline"
              size="icon"
              className="rounded-lg shrink-0"
              disabled={!referralLink}
              onClick={() => copyToClipboard(referralLink, "Referral link")}
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="border border-border rounded-lg bg-card p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Your referrals</h2>
          </div>
          <Badge variant="outline" className="font-mono">{data?.referralCount ?? 0} total</Badge>
        </div>

        {!data?.referrals?.length ? (
          <div className="border border-dashed border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
            No referrals yet. Share your link to get started.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {data.referrals.map((r) => (
              <div key={r.id} className="flex items-center justify-between border border-border rounded-lg px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {r.firstName || r.lastName ? `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() : (r.email ?? "Unknown user")}
                  </div>
                  {(r.firstName || r.lastName) && r.email && (
                    <div className="text-xs text-muted-foreground truncate">{r.email}</div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground shrink-0 font-mono">
                  {new Date(r.createdAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
