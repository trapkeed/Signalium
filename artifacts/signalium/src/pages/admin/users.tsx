import {
  useListUsers,
  useUpdateUser,
  useCreateUser,
  useDeleteUser,
  useUpdateUserSubscriptionStatus,
  getListUsersQueryKey,
  useGetMyUser,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-auth";
import { Users, ShieldCheck, User, Crown, Briefcase, ClipboardList, CheckCircle2, XCircle, ChevronDown, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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

// ─── Subscription status selector (admin+) ─────────────────────────────────────

const SUBSCRIPTION_STATUSES = ["active", "grace_period", "suspended", "expired", "cancelled"] as const;
type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

function SubscriptionStatusSelector({
  userId,
  currentStatus,
}: {
  userId: string;
  currentStatus: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateStatus = useUpdateUserSubscriptionStatus();

  async function assign(status: SubscriptionStatus) {
    if (status === currentStatus) return;
    try {
      await updateStatus.mutateAsync(
        { id: userId, data: { status } },
        { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }) }
      );
      toast({ title: `Subscription status updated to ${status}` });
    } catch (err: any) {
      toast({ title: "Failed to update subscription status", description: err?.data?.error ?? err?.message, variant: "destructive" });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={updateStatus.isPending}
          className="inline-flex items-center gap-1 focus-visible:outline-none"
        >
          <span className={`text-xs font-mono ${currentStatus === "active" ? "text-success" : "text-muted-foreground"}`}>
            {currentStatus}
          </span>
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[160px]">
        <div className="px-2 py-1 text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
          Set status
        </div>
        <DropdownMenuSeparator />
        {SUBSCRIPTION_STATUSES.map((status) => (
          <DropdownMenuItem
            key={status}
            onClick={() => assign(status)}
            className={`font-mono text-xs gap-2 ${status === currentStatus ? "font-semibold" : ""}`}
          >
            {status}
            {status === currentStatus && <span className="ml-auto text-[10px] text-muted-foreground">current</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Create user modal (super_admin only) ──────────────────────────────────────

function CreateUserModal({
  open,
  onOpenChange,
  actorRole,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actorRole: UserRole;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const createUser = useCreateUser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<UserRole>("user");

  const actorLevel = ROLE_LEVEL[actorRole] ?? 0;
  const assignableRoles = ALL_ROLES.filter((r) => ROLE_LEVEL[r] < actorLevel || r === "user");

  function reset() {
    setEmail(""); setPassword(""); setFirstName(""); setLastName(""); setRole("user");
  }

  async function submit() {
    if (!email.trim() || !password.trim()) {
      toast({ title: "Email and password are required", variant: "destructive" });
      return;
    }
    try {
      await createUser.mutateAsync({
        data: {
          email: email.trim(),
          password,
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          role,
        },
      });
      toast({ title: "User created" });
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err: any) {
      toast({ title: "Failed to create user", description: err?.message ?? "Something went wrong", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">Create User</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Email</label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="font-mono text-xs" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Password</label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className="font-mono text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">First name</label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="font-mono text-xs" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Last name</label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} className="font-mono text-xs" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="h-9 rounded-sm border border-border bg-background px-2 font-mono text-xs"
            >
              {assignableRoles.map((r) => (
                <option key={r} value={r}>{ROLE_CONFIG[r].label}</option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" className="font-mono text-xs" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" className="font-mono text-xs" onClick={submit} disabled={createUser.isPending}>
            {createUser.isPending ? "Creating…" : "Create User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function AdminUsers() {
  const { data: users, isLoading } = useListUsers();
  const { data: me } = useGetMyUser();
  const { user: authUser } = useUser();
  const queryClient = useQueryClient();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  // Prefer DB role from /users/me; fall back to the auth session's role during initial load
  const actorRole = (me?.role ?? authUser?.role ?? "admin") as UserRole;
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
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users…"
            className="h-8 w-56 rounded-sm border border-border bg-background px-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {isSuperAdmin && (
            <Button size="sm" className="h-8 font-mono text-xs gap-1.5" onClick={() => setCreateOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> Create User
            </Button>
          )}
        </div>
      </div>

      {isSuperAdmin && (
        <CreateUserModal
          open={createOpen}
          onOpenChange={setCreateOpen}
          actorRole={actorRole}
          onCreated={() => queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() })}
        />
      )}

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
                          isSuperAdmin || actorRole === "admin" ? (
                            <SubscriptionStatusSelector
                              userId={user.id}
                              currentStatus={user.subscriptionStatus}
                            />
                          ) : (
                            <span className={`text-xs font-mono ${user.subscriptionStatus === "active" ? "text-success" : "text-muted-foreground"}`}>
                              {user.subscriptionStatus}
                            </span>
                          )
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
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleActive(user.id, user.isActive ?? true)}
                            disabled={updateUser.isPending || isSelf}
                            className="text-xs font-mono text-muted-foreground hover:text-foreground border border-border hover:border-foreground/30 h-7 px-2 rounded-sm"
                          >
                            {user.isActive ? "Deactivate" : "Activate"}
                          </Button>
                          {isSuperAdmin && !isSelf && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                if (!confirm(`Permanently delete ${user.email}? This cannot be undone.`)) return;
                                deleteUser.mutate(
                                  { id: user.id },
                                  {
                                    onSuccess: () => queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }),
                                    onError: (err: any) => toast({ title: "Failed to delete user", description: err?.message, variant: "destructive" }),
                                  }
                                );
                              }}
                              disabled={deleteUser.isPending}
                              className="text-destructive hover:text-destructive border border-border hover:border-destructive/40 h-7 w-7 p-0 rounded-sm"
                              title="Delete user"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
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
