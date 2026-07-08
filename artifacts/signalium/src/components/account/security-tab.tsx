import { useState } from "react";
import {
  useGetAccountSecurityStatus,
  useListAccountSessions,
  useRevokeAccountSession,
  useGetLoginHistory,
  useLockAccount,
  useUnlockAccount,
  getGetAccountSecurityStatusQueryKey,
  getListAccountSessionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  Unlock,
  Monitor,
  Smartphone,
  MapPin,
  LogOut,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

function formatLocation(city?: string | null, country?: string | null) {
  if (!city && !country) return "Unknown location";
  return [city, country].filter(Boolean).join(", ");
}

function DeviceIcon({ isMobile }: { isMobile: boolean }) {
  return isMobile ? (
    <Smartphone className="w-4 h-4 text-muted-foreground shrink-0" />
  ) : (
    <Monitor className="w-4 h-4 text-muted-foreground shrink-0" />
  );
}

export function SecurityTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isLocking, setIsLocking] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [unlockToken, setUnlockToken] = useState("");

  const { data: status, refetch: refetchStatus } = useGetAccountSecurityStatus();
  const { data: sessions = [], refetch: refetchSessions } = useListAccountSessions();
  const { data: history = [] } = useGetLoginHistory();
  const revokeSession = useRevokeAccountSession();
  const lockAccount = useLockAccount();
  const unlockAccount = useUnlockAccount();

  function invalidateSecurity() {
    queryClient.invalidateQueries({ queryKey: getGetAccountSecurityStatusQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListAccountSessionsQueryKey() });
  }

  async function handleRevoke(sessionId: string) {
    try {
      await revokeSession.mutateAsync({ sessionId });
      toast({ title: "Session revoked" });
      refetchSessions();
    } catch {
      toast({ title: "Failed to revoke session", variant: "destructive" });
    }
  }

  async function handleLock() {
    try {
      await lockAccount.mutateAsync();
      toast({ title: "Account locked", description: "Check your email for the unlock code." });
      setIsLocking(false);
      refetchStatus();
      invalidateSecurity();
    } catch {
      toast({ title: "Failed to lock account", variant: "destructive" });
    }
  }

  async function handleUnlock() {
    if (!unlockToken.trim()) return;
    try {
      await unlockAccount.mutateAsync({ data: { token: unlockToken.trim() } });
      toast({ title: "Account unlocked" });
      setIsUnlocking(false);
      setUnlockToken("");
      refetchStatus();
      invalidateSecurity();
    } catch {
      toast({ title: "Invalid or expired unlock code", variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Lock status */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Account Lock</div>
        {status?.isLocked ? (
          <Alert className="border-destructive/30 bg-destructive/5 rounded-lg">
            <ShieldAlert className="w-4 h-4 text-destructive" />
            <AlertDescription className="text-sm">
              <div className="font-medium text-destructive mb-1">Your account is locked</div>
              <div className="text-muted-foreground">
                {status.lockReason ?? "Locked as a security precaution."}
                {status.lockedAt && ` · ${new Date(status.lockedAt).toLocaleString()}`}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 rounded-lg gap-2"
                onClick={() => setIsUnlocking(true)}
              >
                <Unlock className="w-3.5 h-3.5" /> Enter unlock code
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="border border-border bg-card rounded-lg p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
              <div>
                <div className="text-sm font-medium">Account is active</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  No suspicious activity detected
                  {status && status.recentSuspiciousCount > 0 && ` · ${status.recentSuspiciousCount} flagged sign-in(s) in the last 24h`}
                </div>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="rounded-lg gap-2 text-destructive border-destructive/30 hover:bg-destructive/10 shrink-0"
              onClick={() => setIsLocking(true)}
            >
              <Lock className="w-3.5 h-3.5" /> Lock account
            </Button>
          </div>
        )}
      </div>

      {/* Active sessions */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Active Sessions</div>
        <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
          {sessions.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">No active sessions.</div>
          ) : (
            sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <DeviceIcon isMobile={s.isMobile} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                      {s.browserName ?? "Unknown browser"} · {s.deviceType ?? "unknown device"}
                      {s.isCurrent && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                          This device
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <MapPin className="w-3 h-3" /> {formatLocation(s.city, s.country)}
                      {s.ipAddress && <span className="font-mono">· {s.ipAddress}</span>}
                      <span>· active {new Date(s.lastActiveAt).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                {!s.isCurrent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive shrink-0 gap-1.5 rounded-lg"
                    onClick={() => handleRevoke(s.id)}
                    disabled={revokeSession.isPending}
                  >
                    <LogOut className="w-3.5 h-3.5" /> Revoke
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Login history / security timeline */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Login History</div>
        <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
          {history.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">No login history yet.</div>
          ) : (
            history.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <DeviceIcon isMobile={e.isMobile} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                      {e.browserName ?? "Unknown browser"} · {e.deviceType ?? "unknown device"}
                      {e.isSuspicious && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">
                          <AlertTriangle className="w-2.5 h-2.5" /> Suspicious
                        </span>
                      )}
                      {e.isNewDevice && !e.isSuspicious && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-yellow-500 bg-yellow-500/10 px-1.5 py-0.5 rounded">
                          New device
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <MapPin className="w-3 h-3" /> {formatLocation(e.city, e.country)}
                      {e.ipAddress && <span className="font-mono">· {e.ipAddress}</span>}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {new Date(e.occurredAt).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Lock confirm dialog */}
      <Dialog open={isLocking} onOpenChange={setIsLocking}>
        <DialogContent className="bg-card border-border rounded-lg">
          <DialogHeader>
            <DialogTitle>Lock your account?</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground py-2">
            This immediately blocks API and platform access until you unlock it with a code we'll email you.
            Use this if you suspect unauthorized access.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsLocking(false)} className="rounded-lg">Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleLock}
              disabled={lockAccount.isPending}
              className="rounded-lg"
            >
              {lockAccount.isPending ? "Locking..." : "Lock account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlock dialog */}
      <Dialog open={isUnlocking} onOpenChange={setIsUnlocking}>
        <DialogContent className="bg-card border-border rounded-lg">
          <DialogHeader>
            <DialogTitle>Unlock your account</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Unlock code (from your email)
            </Label>
            <Input
              value={unlockToken}
              onChange={(e) => setUnlockToken(e.target.value)}
              placeholder="Paste the code from your email"
              className="rounded-lg font-mono"
              onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsUnlocking(false)} className="rounded-lg">Cancel</Button>
            <Button onClick={handleUnlock} disabled={!unlockToken.trim() || unlockAccount.isPending} className="rounded-lg">
              {unlockAccount.isPending ? "Unlocking..." : "Unlock account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
