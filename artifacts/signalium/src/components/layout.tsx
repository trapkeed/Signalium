import { Link, useLocation } from "wouter";
import { UserButton, useUser } from "@clerk/react";
import {
  LayoutDashboard,
  Box,
  Activity,
  CreditCard,
  Settings,
  Shield,
  Users,
  Database,
  Key,
  Wallet,
  Mail,
  Cpu,
  Coins,
  Radio,
} from "lucide-react";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/ea", label: "EA Library", icon: Box },
  { href: "/runtime", label: "Runtime", icon: Activity },
  { href: "/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/payments", label: "Payments", icon: Wallet },
  { href: "/api-keys", label: "API Keys", icon: Key },
  { href: "/ea-builds", label: "EA Builds", icon: Cpu },
];

const ADMIN_ITEMS = [
  { href: "/admin", label: "Overview", icon: Shield },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/admin/eas", label: "EAs", icon: Database },
  { href: "/admin/payments", label: "Payments", icon: Wallet },
  { href: "/admin/smtp", label: "SMTP", icon: Mail },
  { href: "/admin/api-keys", label: "API Keys", icon: Key },
  { href: "/admin/ea-builds", label: "EA Builds", icon: Cpu },
  { href: "/admin/symbols", label: "Symbols", icon: Coins },
  { href: "/admin/qde", label: "QDE Loop", icon: Radio },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useUser();
  const isAdmin = user?.publicMetadata?.role === "admin"; // Check clerk role if available, or just render it based on backend call later. For now we just show it.

  return (
    <div className="flex min-h-[100dvh] bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card flex flex-col shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <Link href="/dashboard" className="text-xl font-bold tracking-tight text-primary flex items-center gap-2">
            <Activity className="w-5 h-5" />
            SIGNALIUM
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto py-4 px-3 flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <div className="text-xs font-mono tracking-wider text-muted-foreground uppercase mb-2 px-3">
              Platform
            </div>
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors",
                  location === item.href || location.startsWith(item.href + "/")
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            ))}
          </div>

          <div className="flex flex-col gap-1">
            <div className="text-xs font-mono tracking-wider text-muted-foreground uppercase mb-2 px-3">
              Admin
            </div>
            {ADMIN_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors",
                  location === item.href || (item.href !== "/admin" && location.startsWith(item.href))
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-auto p-4 border-t border-border flex items-center gap-3">
          <UserButton 
            appearance={{
              elements: {
                userButtonAvatarBox: "w-8 h-8 rounded-sm",
              }
            }}
          />
          <div className="flex-1 overflow-hidden">
            <div className="text-sm font-medium truncate">{user?.firstName || user?.emailAddresses[0]?.emailAddress}</div>
            <div className="text-xs text-muted-foreground truncate">{user?.emailAddresses[0]?.emailAddress}</div>
          </div>
          <Link href="/settings" className="text-muted-foreground hover:text-foreground p-1 rounded-sm hover:bg-secondary/50">
            <Settings className="w-4 h-4" />
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {children}
      </main>
    </div>
  );
}