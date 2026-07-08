import { ReactNode, useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/react";
import {
  useSyncLogin,
  useGetAccountSecurityStatus,
  useUnlockAccount,
  getGetAccountSecurityStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { REFERRAL_CODE_STORAGE_KEY } from "@/lib/referral";

/**
 * Wraps signed-in app content. Syncs the current Clerk session into our
 * login-history table once per mount (stand-in for a session.created
 * webhook — Replit-managed Clerk has no dashboard/webhook access), then
 * blocks rendering the app if the account has been security-locked,
 * showing an unlock form instead.
 */
export function AccountGate({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useUser();
  const syncLogin = useSyncLogin();
  const unlockAccount = useUnlockAccount();
  const syncedForUserId = useRef<string | null>(null);
  const [unlockToken, setUnlockToken] = useState("");

  const { data: status, refetch } = useGetAccountSecurityStatus();

  useEffect(() => {
    const interval = setInterval(() => refetch(), 60_000);
    return () => clearInterval(interval);
  }, [refetch]);

  useEffect(() => {
    if (!user?.id || syncedForUserId.current === user.id) return;
    syncedForUserId.current = user.id;
    const referralCode = localStorage.getItem(REFERRAL_CODE_STORAGE_KEY) || undefined;
    syncLogin.mutate(
      { data: referralCode ? { referralCode } : undefined },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAccountSecurityStatusQueryKey() });
          if (referralCode) localStorage.removeItem(REFERRAL_CODE_STORAGE_KEY);
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function handleUnlock() {
    if (!unlockToken.trim()) return;
    try {
      await unlockAccount.mutateAsync({ data: { token: unlockToken.trim() } });
      toast({ title: "Account unlocked" });
      setUnlockToken("");
      refetch();
    } catch {
      toast({ title: "Invalid or expired unlock code", variant: "destructive" });
    }
  }

  if (status?.isLocked) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
        <div className="max-w-md w-full border border-destructive/30 bg-destructive/5 rounded-lg p-6 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-6 h-6 text-destructive shrink-0" />
            <div>
              <div className="font-semibold text-destructive">Your account is locked</div>
              <div className="text-sm text-muted-foreground mt-0.5">
                {status.lockReason ?? "Locked as a security precaution."}
              </div>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            We emailed you an unlock code. Enter it below to restore access.
          </p>
          <div className="flex flex-col gap-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Unlock code</Label>
            <Input
              value={unlockToken}
              onChange={(e) => setUnlockToken(e.target.value)}
              placeholder="Paste the code from your email"
              className="rounded-lg font-mono"
              onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
            />
          </div>
          <Button onClick={handleUnlock} disabled={!unlockToken.trim() || unlockAccount.isPending} className="rounded-lg gap-2">
            <Unlock className="w-4 h-4" /> {unlockAccount.isPending ? "Unlocking..." : "Unlock account"}
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
