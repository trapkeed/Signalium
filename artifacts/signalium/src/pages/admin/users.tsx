import { useListUsers, useUpdateUser, getListUsersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Users, Shield, User } from "lucide-react";

export default function AdminUsers() {
  const { data: users, isLoading } = useListUsers();
  const queryClient = useQueryClient();
  const updateUser = useUpdateUser();

  const toggleActive = (id: string, isActive: boolean) => {
    updateUser.mutate(
      { id, data: { isActive: !isActive } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }) }
    );
  };

  const toggleRole = (id: string, role: string) => {
    updateUser.mutate(
      { id, data: { role: role === "admin" ? "user" : "admin" } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }) }
    );
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-6 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Users</h1>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">
            {users?.length ?? 0} total users
          </p>
        </div>
      </div>

      <div className="p-8">
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
        ) : users && users.length > 0 ? (
          <div className="border border-border rounded-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary">
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">User</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Subscription</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Joined</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-sm">{user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.email}</div>
                      <div className="text-xs text-muted-foreground font-mono">{user.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-mono border px-2 py-0.5 rounded-sm ${user.role === "admin" ? "text-warning border-warning/30 bg-warning/10" : "text-muted-foreground border-border bg-secondary"}`}>
                        {user.role === "admin" ? <Shield className="inline w-3 h-3 mr-1" /> : <User className="inline w-3 h-3 mr-1" />}
                        {user.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {user.subscriptionStatus ? (
                        <span className={`text-xs font-mono ${user.subscriptionStatus === "active" ? "text-success" : "text-muted-foreground"}`}>
                          {user.subscriptionStatus}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground font-mono">none</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-mono ${user.isActive ? "text-success" : "text-destructive"}`}>
                        {user.isActive ? "active" : "inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleActive(user.id, user.isActive ?? true)}
                          disabled={updateUser.isPending}
                          className="text-xs font-mono text-muted-foreground hover:text-foreground border border-border hover:border-foreground/30 px-2 py-1 rounded-sm transition-colors"
                        >
                          {user.isActive ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          onClick={() => toggleRole(user.id, user.role)}
                          disabled={updateUser.isPending}
                          className="text-xs font-mono text-muted-foreground hover:text-foreground border border-border hover:border-foreground/30 px-2 py-1 rounded-sm transition-colors"
                        >
                          {user.role === "admin" ? "Make user" : "Make admin"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="border border-border bg-card rounded-sm p-12 text-center text-muted-foreground">
            <Users className="w-8 h-8 mx-auto mb-3 opacity-30" />
            No users yet.
          </div>
        )}
      </div>
    </div>
  );
}
