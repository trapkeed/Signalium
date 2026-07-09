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
  Menu,
  X,
  Search,
  Image,
  Megaphone,
  AlertTriangle,
  LifeBuoy,
  BookOpen,
  Gift,
  ScrollText,
  Building2,
  Flag,
  Brain,
  Layers,
  Server,
  Bell,
  Wifi,
  ShieldAlert,
} from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/notification-bell";
import { MaintenanceBanner } from "@/components/maintenance-banner";
import { AnnouncementBanners } from "@/components/announcement-banners";
import { useFeatureFlag } from "@/hooks/use-feature-flags";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/ea", label: "EA Library", icon: Box },
  { href: "/runtime", label: "Runtime", icon: Activity },
  { href: "/support", label: "Support", icon: LifeBuoy },
  { href: "/account", label: "Account & Security", icon: Shield },
];

// Grouped to match the full spec's admin surface: each section below is a
// coherent slice of the panel rather than one long flat list.
const ADMIN_GROUPS: { title: string; items: typeof NAV_ITEMS }[] = [
  {
    title: "Overview",
    items: [{ href: "/admin", label: "Overview", icon: Shield }],
  },
  {
    title: "Accounts & Billing",
    items: [
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/plans", label: "Plans", icon: ScrollText },
      { href: "/admin/subscriptions", label: "Subscriptions", icon: CreditCard },
      { href: "/admin/payments", label: "Payments", icon: Wallet },
      { href: "/admin/api-keys", label: "API Keys", icon: Key },
    ],
  },
  {
    title: "Trading Infrastructure",
    items: [
      { href: "/admin/symbols", label: "Symbols", icon: Coins },
      { href: "/admin/brokers", label: "Brokers", icon: Building2 },
      { href: "/admin/data-providers", label: "Data Providers", icon: Database },
      { href: "/admin/eas", label: "EAs", icon: Box },
      { href: "/admin/ea-builds", label: "EA Builds", icon: Cpu },
      { href: "/admin/qde", label: "QDE Loop", icon: Radio },
      { href: "/admin/inference-gateway", label: "Inference Gateway", icon: Brain },
      { href: "/admin/trade-intelligence", label: "Trade Intelligence", icon: Brain },
      { href: "/admin/deployments", label: "Deployments", icon: Layers },
    ],
  },
  {
    title: "Operations",
    items: [
      { href: "/admin/operations", label: "Ops Dashboard", icon: Server },
      { href: "/admin/platform-health", label: "Platform Health", icon: Cpu },
      { href: "/admin/ea-monitor", label: "EA Monitor", icon: Wifi },
      { href: "/admin/incidents", label: "Incidents", icon: AlertTriangle },
      { href: "/admin/alerts", label: "Alerts", icon: Bell },
      { href: "/admin/symbol-health", label: "Symbol Health", icon: Radio },
      { href: "/admin/security-operations", label: "Security Operations", icon: ShieldAlert },
    ],
  },
  {
    title: "Content & Growth",
    items: [
      { href: "/admin/announcements", label: "Announcements", icon: Megaphone },
      { href: "/admin/seo", label: "SEO", icon: Search },
      { href: "/admin/media", label: "Media Library", icon: Image },
      { href: "/admin/knowledge-base", label: "Knowledge Base", icon: BookOpen },
      { href: "/admin/referrals", label: "Referrals", icon: Gift },
    ],
  },
  {
    title: "Support & Comms",
    items: [
      { href: "/admin/support", label: "Support Tickets", icon: LifeBuoy },
      { href: "/admin/contact", label: "Contact Messages", icon: Mail },
      { href: "/admin/smtp", label: "SMTP", icon: Mail },
      { href: "/admin/maintenance-banner", label: "Maintenance Banner", icon: AlertTriangle },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/admin/feature-flags", label: "Feature Flags", icon: Flag },
      { href: "/admin/status", label: "Platform Status", icon: Activity },
      { href: "/admin/audit-log", label: "Audit Log", icon: ScrollText },
    ],
  },
];

function Logo() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 group">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-[0_0_16px_-4px_hsl(var(--primary)/0.5)]">
        <Activity className="w-4 h-4 text-primary-foreground" strokeWidth={2.5} />
      </div>
      <span className="text-lg font-bold tracking-tight text-foreground">
        Signalium
      </span>
    </Link>
  );
}

function NavSection({
  title,
  items,
  location,
  onNavigate,
}: {
  title: string;
  items: typeof NAV_ITEMS;
  location: string;
  onNavigate: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase mb-1.5 px-3">
        {title}
      </div>
      {items.map((item) => {
        const isActive =
          location === item.href ||
          (item.href !== "/admin" && location.startsWith(item.href + "/")) ||
          (item.href === "/admin" && location === "/admin");
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors relative",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            )}
          >
            {isActive && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-primary" />
            )}
            <item.icon className="w-4 h-4 shrink-0" />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate: () => void }) {
  const [location] = useLocation();
  const { user } = useUser();
  const userRole = user?.publicMetadata?.role as string | undefined;
  const isAdmin = !!userRole && userRole !== "user";
  const referralsEnabled = useFeatureFlag("referrals_enabled");

  const adminGroups = ADMIN_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => referralsEnabled || item.href !== "/admin/referrals"),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex flex-col h-full">
      <div className="h-16 flex items-center px-5 border-b border-border shrink-0">
        <Logo />
      </div>

      <div className="flex-1 overflow-y-auto py-5 px-3 flex flex-col gap-7">
        <NavSection title="Platform" items={NAV_ITEMS} location={location} onNavigate={onNavigate} />
        {isAdmin && adminGroups.map((group) => (
          <NavSection key={group.title} title={group.title} items={group.items} location={location} onNavigate={onNavigate} />
        ))}
      </div>

      <div className="mt-auto p-3 border-t border-border shrink-0">
        <div className="flex items-center gap-3 rounded-lg p-2 hover:bg-secondary/40 transition-colors">
          <UserButton
            appearance={{
              elements: {
                userButtonAvatarBox: "w-8 h-8 rounded-lg",
              },
            }}
          />
          <div className="flex-1 overflow-hidden min-w-0">
            <div className="text-sm font-medium truncate">
              {user?.firstName || user?.emailAddresses[0]?.emailAddress}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {user?.emailAddresses[0]?.emailAddress}
            </div>
          </div>
          <Link
            href="/account"
            onClick={onNavigate}
            className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-secondary shrink-0"
          >
            <Settings className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location]);

  useEffect(() => {
    document.body.style.overflow = mobileNavOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileNavOpen]);

  return (
    <div className="flex min-h-[100dvh] bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 border-r border-border bg-card flex-col shrink-0">
        <SidebarContent onNavigate={() => {}} />
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-40 h-14 flex items-center justify-between px-4 border-b border-border bg-card/95 backdrop-blur">
        <Logo />
        <div className="flex items-center gap-1">
          <NotificationBell />
          <button
            onClick={() => setMobileNavOpen(true)}
            className="p-2 -mr-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary/60"
            aria-label="Open navigation"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] bg-card border-r border-border h-full flex flex-col animate-in slide-in-from-left duration-200">
            <button
              onClick={() => setMobileNavOpen(false)}
              className="absolute top-4 right-4 p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary/60"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4" />
            </button>
            <SidebarContent onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 pt-14 lg:pt-0">
        <div className="hidden lg:flex h-14 items-center justify-end px-6 border-b border-border shrink-0">
          <NotificationBell />
        </div>
        <MaintenanceBanner />
        <AnnouncementBanners />
        {children}
      </main>
    </div>
  );
}
