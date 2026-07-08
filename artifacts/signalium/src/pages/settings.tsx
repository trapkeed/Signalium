import { useUser, UserProfile } from "@clerk/react";

export default function Settings() {
  const { user } = useUser();

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-6 border-b border-border">
        <h1 className="text-xl font-bold tracking-tight">Settings</h1>
        <p className="text-xs text-muted-foreground mt-0.5 font-mono">Manage your account</p>
      </div>

      <div className="p-8 max-w-3xl">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-4">Account Profile</div>
        <UserProfile
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "bg-card border border-border shadow-none rounded-sm",
              navbar: "bg-secondary border-r border-border",
              navbarButton: "text-muted-foreground hover:text-foreground hover:bg-secondary",
              navbarButtonActive: "text-foreground bg-secondary",
              pageScrollBox: "bg-card",
              formFieldInput: "bg-input border-border text-foreground rounded-sm",
              formButtonPrimary: "bg-primary text-primary-foreground hover:bg-primary/90 rounded-sm",
              badge: "bg-primary/10 text-primary",
            },
          }}
        />
      </div>
    </div>
  );
}
