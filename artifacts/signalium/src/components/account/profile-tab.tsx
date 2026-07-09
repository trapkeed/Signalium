import { useState } from "react";
import { customFetch, ApiError } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export function ProfileTab() {
  const { user, refetch } = useAuth();
  const { toast } = useToast();

  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  // Google-only accounts have no password yet, so skip the "current
  // password" confirmation step (mirrors the backend's own check).
  const hasPassword = !user?.googleId;

  async function handleSaveProfile() {
    setSavingProfile(true);
    try {
      await customFetch("/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({ firstName, lastName }),
      });
      await refetch();
      toast({ title: "Profile updated" });
    } catch (err) {
      toast({
        title: "Failed to update profile",
        description: err instanceof ApiError ? (err.data as any)?.error ?? "Please try again" : "Please try again",
        variant: "destructive",
      });
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword() {
    if (newPassword.length < 8) {
      toast({ title: "New password must be at least 8 characters", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    setSavingPassword(true);
    try {
      await customFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password updated" });
    } catch (err) {
      toast({
        title: "Failed to change password",
        description: err instanceof ApiError ? (err.data as any)?.error ?? "Please try again" : "Please try again",
        variant: "destructive",
      });
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-card border border-border rounded-lg p-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email</span>
          <span className="text-sm">{user?.email}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Sign-in method</span>
          <span className="text-sm">{user?.googleId ? "Google" : "Email & password"}</span>
        </div>

        <Separator />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="profile-first-name" className="text-xs">First name</Label>
            <Input
              id="profile-first-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="profile-last-name" className="text-xs">Last name</Label>
            <Input
              id="profile-last-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
            />
          </div>
        </div>
        <div>
          <Button size="sm" onClick={handleSaveProfile} disabled={savingProfile}>
            {savingProfile ? "Saving…" : "Save Profile"}
          </Button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-6 flex flex-col gap-4">
        <div>
          <p className="text-sm font-semibold">Reset Password</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {hasPassword
              ? "Enter your current password and choose a new one."
              : "Set a password for your account (currently signed in with Google only)."}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {hasPassword && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="current-password" className="text-xs">Current password</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-password" className="text-xs">New password</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="confirm-password" className="text-xs">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
        </div>
        <div>
          <Button size="sm" onClick={handleChangePassword} disabled={savingPassword}>
            {savingPassword ? "Updating…" : "Update Password"}
          </Button>
        </div>
      </div>
    </div>
  );
}
