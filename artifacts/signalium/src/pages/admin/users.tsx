import {
  useListUsers,
  useUpdateUser,
  getListUsersQueryKey,
  useGetMyUser,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { Users, ShieldCheck, User, Crown, Briefcase, ClipboardList, CheckCircle2, XCircle, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

// ─── Role config ───────────────────────────────────────────────────────────────

type UserRole = "user" | "clerk" | "staff" | "admin" | "super_admin";

const ROLE_LEVEL: Record<UserRole, number> = {
  user: 0, clerk: 1, staff: 2, admin: 3, super_admin: 4,
};

const ROLE_CONFIG: Record<UserRole, { label: string; icon: any; className: string }> = {
  user:        { label: "User",        icon: User,          className: "text-muted-foreground border-border bg-secondary" },
  clerk:       { label: "Clerk",       icon: ClipboardList, className: "text-blue-400 border-blue-400/30 bg-blue-400/10" },
  staff:       { label: "Staff",       icon: Briefcase,     className: "text-purple-400 border-purple-400/30 bg-purple-400/10" },
  admin:       { label: "Admin",       icon: ShieldCheck,   className: "text-warning border-warning/30 bg-warning/10" },
  super_admin: { label: "Super Admin", icon: Crown,         className: "text-red-400 border-red-400/30 bg-red-400/10" },
};

const ALL_ROLES: UserRole[] = ["super_admin", "admin", "staff", "clerk", "user"];

function RoleBadge({ role }: { role: string }) {
  const cfg = ROLE_CONFIG[role as UserRole] ?? ROLE_CONFIG.user;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-mono border px-2 py-0.5 rounded-sm ${cfg.className}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ─── Role selector (super_admin only) ─────────────────────────────────────────

function RoleSelector({
  userId,
  currentRole,
  actorRole,
}: {
  userId: string;
  currentRole: string;
  actorRole: UserRole;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateUser = useUpdateUser();

  const actorLevel = ROLE_LEVEL[actorRole] ?? 0;
  // Can only assign roles strictly below own level; cannot change own role
  const assignableRoles = ALL_ROLES.filter(
    (r) => ROLE_LEVEL[r] < actorLevel
  );

  if (actorRole !== "super_admin") return <RoleBadge role={currentRole} />;

  async function assign(role: UserRole) {
    if (role === currentRole) return;
    try {
      await updateUser.mutateAsync(
        { id: userId, data: { role } },
        { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }) }
      );
      toast({ title: `Role updated to ${ROLE_CONFIG[role]?.label ?? role}` });
    } catch (err: any) {
      toast({ title: "Failed to update role", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={updateUser.isPending}
          className="inline-flex items-center gap-1 focus-visible:outline-none"
        >
          <RoleBadge role={currentRole} />
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[160px]">
        <div className="px-2 py-1 text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
          Assign role
        </div>
        <DropdownMenuSeparator />
        {assignableRoles.map((role) => {
          const cfg = ROLE_CONFIG[role];
          const Icon = cfg.icon;
          return (
            <DropdownMenuItem
              key={role}
              onClick={() => assign(role)}
              className={`font-mono text-xs gap-2 ${role === currentRole ? "font-semibold" : ""}`}
            >
              <Icon className="w-3 h-3" />
              {cfg.label}
              {role === currentRole && <span className="ml-auto text-[10px] text-muted-foreground">current</span>}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function AdminUsers() {
  const { data: users, isLoading } = useListUsers();
  const { data: me } = useGetMyUser();
  const { user: clerkUser } = useUser();
  const queryClient = useQueryClient();
  const updateUser = useUpdateUser();
  const { toast } = useToast();

  // Prefer DB role from /users/me; fall back to Clerk publicMetadata during initial load
  const actorRole = (me?.role ?? clerkUser?.publicMetadata?.role ?? "admin") as UserRole;
  const isSuperAdmin = actorRole === "super_admin";

  const [search, setSearch] = useState("");

  const filtered = (users ?? []).filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.email.toLowerCase().includes(q) ||
      (u.firstName ?? "").toLowerCase().includes(q) ||
      (u.lastName ?? "").toLowerCase().includes(q)
    );
  });

  function toggleActive(id: string, isActive: boolean) {
    updateUser.mutate(
      { id, data: { isActive: !isActive } },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }),
        onError: (err: any) => toast({ title: "Failed", description: err?.message, variant: "destructive" }),
      }
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-6 border-b border-border flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Users</h1>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">
            {users?.length ?? 0} total users
            {isSuperAdmin && (
              <span className="ml-2 text-primary">· Role management enabled</span>
            )}
          </p>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users…"
          className="h-8 w-56 rounded-sm border border-border bg-background px-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      <div className="p-8">
        {isSuperAdmin && (
          <div className="mb-4 flex items-start gap-2 rounded-sm bg-amber-500/10 border border-amber-500/30 px-4 py-3">
            <Crown className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-xs font-mono text-amber-600 dark:text-amber-400">
              Super Admin mode — you can assign roles to any user below your level. Role changes take effect immediately and are synced to authentication.
            </p>
          </div>
        )}

        {isLoading ? (
          <div className="border border-border rounded-sm overflow-hidden animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="px-4 py-4 border-b border-border last:border-0 flex gap-4">
                <div className="h-4 bg-secondary rounded w-48" />
                <div className="h-4 bg-secondary rounded w-24" />
                <div className="h-4 bg-secondary rounded w-20" />
              </div>
            ))}
          </div>
        ) : filtered.length > 0 ? (
          <div className="border border-border rounded-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary">
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">User</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Access</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Subscription</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Joined</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => {
                  const isPrivileged = user.role !== "user";
                  const isSelf = user.id === me?.id;
                  return (
                    <tr key={user.id} className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-sm">
                          {user.firstName && user.lastName
                            ? `${user.firstName} ${user.lastName}`
                            : user.email}
                          {isSelf && (
                            <span className="ml-2 text-[10px] font-mono text-muted-foreground border border-border rounded-sm px-1">you</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">{user.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        {isSelf ? (
                          <RoleBadge role={user.role} />
                        ) : (
                          <RoleSelector
                            userId={user.id}
                            currentRole={user.role}
                            actorRole={actorRole}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isPrivileged ? (
                          <Badge variant="outline" className="text-[10px] font-mono gap-1 border-primary/40 text-primary bg-primary/5">
                            <CheckCircle2 className="w-2.5 h-2.5" /> Free
                          </Badge>
                        ) : (
                          <span className="text-[10px] font-mono text-muted-foreground">subscription</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isPrivileged ? (
                          <span className="text-xs font-mono text-primary">internal access</span>
                        ) : user.subscriptionStatus ? (
                          <span className={`text-xs font-mono ${user.subscriptionStatus === "active" ? "text-success" : "text-muted-foreground"}`}>
                            {user.subscriptionStatus}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground font-mono">none</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-mono flex items-center gap-1 ${user.isActive ? "text-success" : "text-destructive"}`}>
                          {user.isActive
                            ? <><CheckCircle2 className="w-3 h-3" /> active</>
                            : <><XCircle className="w-3 h-3" /> inactive</>}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleActive(user.id, user.isActive ?? true)}
                          disabled={updateUser.isPending || isSelf}
                          className="text-xs font-mono text-muted-foreground hover:text-foreground border border-border hover:border-foreground/30 h-7 px-2 rounded-sm"
                        >
                          {user.isActive ? "Deactivate" : "Activate"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="border border-border bg-card rounded-sm p-12 text-center text-muted-foreground">
            <Users className="w-8 h-8 mx-auto mb-3 opacity-30" />
            {search ? "No users match your search." : "No users yet."}
          </div>
        )}
      </div>
    </div>
  );
}
