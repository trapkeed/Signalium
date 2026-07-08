import { useState } from "react";
import { useListEas, useCreateEa, useUpdateEa, useDeleteEa, getListEasQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Cpu, Pencil, Trash2, Check, X } from "lucide-react";

const TIER_COLORS: Record<string, string> = {
  starter: "text-success border-success/30 bg-success/10",
  professional: "text-primary border-primary/30 bg-primary/10",
  enterprise: "text-warning border-warning/30 bg-warning/10",
};

type EaForm = {
  name: string;
  description: string;
  version: string;
  platform: "mt4" | "mt5" | "both";
  requiredTier: "starter" | "professional" | "enterprise";
  changeLog: string;
};

const EMPTY_FORM: EaForm = {
  name: "",
  description: "",
  version: "1.0.0",
  platform: "both",
  requiredTier: "starter",
  changeLog: "",
};

export default function AdminEas() {
  const { data: eas, isLoading } = useListEas();
  const queryClient = useQueryClient();
  const createEa = useCreateEa();
  const updateEa = useUpdateEa();
  const deleteEa = useDeleteEa();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<EaForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListEasQueryKey() });

  const handleSubmit = () => {
    if (!form.name || !form.version) return;
    if (editingId !== null) {
      updateEa.mutate({ id: editingId, data: form }, { onSuccess: () => { invalidate(); setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); } });
    } else {
      createEa.mutate({ data: form }, { onSuccess: () => { invalidate(); setShowForm(false); setForm(EMPTY_FORM); } });
    }
  };

  const handleEdit = (ea: any) => {
    setForm({
      name: ea.name,
      description: ea.description ?? "",
      version: ea.version,
      platform: ea.platform,
      requiredTier: ea.requiredTier,
      changeLog: ea.changeLog ?? "",
    });
    setEditingId(ea.id);
    setShowForm(true);
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete this EA?")) return;
    deleteEa.mutate({ id }, { onSuccess: invalidate });
  };

  const handleToggleActive = (ea: any) => {
    updateEa.mutate({ id: ea.id, data: { isActive: !ea.isActive } }, { onSuccess: invalidate });
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-6 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">EA Management</h1>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">{eas?.length ?? 0} expert advisors</p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setEditingId(null); setForm(EMPTY_FORM); }}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-sm text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add EA
        </button>
      </div>

      <div className="p-8 space-y-6">
        {/* Create/Edit form */}
        {showForm && (
          <div className="border border-primary/30 bg-primary/5 rounded-sm p-6 space-y-4">
            <div className="text-xs font-mono text-primary uppercase tracking-wider">
              {editingId ? "Edit EA" : "New EA"}
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground font-mono block mb-1">Name *</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-input border border-border text-foreground rounded-sm px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="QDE Alpha"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-mono block mb-1">Version *</label>
                <input
                  value={form.version}
                  onChange={e => setForm(f => ({ ...f, version: e.target.value }))}
                  className="w-full bg-input border border-border text-foreground rounded-sm px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="1.0.0"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-mono block mb-1">Platform</label>
                <select
                  value={form.platform}
                  onChange={e => setForm(f => ({ ...f, platform: e.target.value as any }))}
                  className="w-full bg-input border border-border text-foreground rounded-sm px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="mt4">MT4</option>
                  <option value="mt5">MT5</option>
                  <option value="both">MT4 & MT5</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-mono block mb-1">Required Tier</label>
                <select
                  value={form.requiredTier}
                  onChange={e => setForm(f => ({ ...f, requiredTier: e.target.value as any }))}
                  className="w-full bg-input border border-border text-foreground rounded-sm px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="starter">Starter</option>
                  <option value="professional">Professional</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground font-mono block mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className="w-full bg-input border border-border text-foreground rounded-sm px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                  placeholder="EA description..."
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground font-mono block mb-1">Changelog</label>
                <textarea
                  value={form.changeLog}
                  onChange={e => setForm(f => ({ ...f, changeLog: e.target.value }))}
                  rows={2}
                  className="w-full bg-input border border-border text-foreground rounded-sm px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                  placeholder="v1.0.0: Initial release"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleSubmit}
                disabled={createEa.isPending || updateEa.isPending}
                className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-sm text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                {editingId ? "Save changes" : "Create EA"}
              </button>
              <button
                onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); }}
                className="flex items-center gap-2 text-muted-foreground border border-border px-4 py-2 rounded-sm text-sm hover:bg-secondary transition-colors"
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* EA table */}
        {isLoading ? (
          <div className="border border-border rounded-sm overflow-hidden animate-pulse">
            {[1,2,3].map(i => (
              <div key={i} className="px-4 py-4 border-b border-border last:border-0 flex gap-4">
                <div className="h-4 bg-secondary rounded w-32" />
                <div className="h-4 bg-secondary rounded w-16" />
                <div className="h-4 bg-secondary rounded w-20" />
              </div>
            ))}
          </div>
        ) : eas && eas.length > 0 ? (
          <div className="border border-border rounded-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary">
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Version</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Platform</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Tier</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Downloads</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {eas.map((ea) => (
                  <tr key={ea.id} className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium">{ea.name}</div>
                      {ea.description && <div className="text-xs text-muted-foreground truncate max-w-[200px]">{ea.description}</div>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{ea.version}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground uppercase">{ea.platform}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-mono border px-2 py-0.5 rounded-sm ${TIER_COLORS[ea.requiredTier]}`}>
                        {ea.requiredTier}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{ea.downloadCount}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-mono ${ea.isActive ? "text-success" : "text-muted-foreground"}`}>
                        {ea.isActive ? "active" : "inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleToggleActive(ea)}
                          disabled={updateEa.isPending}
                          className="text-xs text-muted-foreground hover:text-foreground border border-border hover:border-foreground/30 px-2 py-1 rounded-sm transition-colors"
                        >
                          {ea.isActive ? "Disable" : "Enable"}
                        </button>
                        <button
                          onClick={() => handleEdit(ea)}
                          className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-sm transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(ea.id)}
                          disabled={deleteEa.isPending}
                          className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-sm transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
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
            <Cpu className="w-8 h-8 mx-auto mb-3 opacity-30" />
            No Expert Advisors yet. Create one above.
          </div>
        )}
      </div>
    </div>
  );
}
