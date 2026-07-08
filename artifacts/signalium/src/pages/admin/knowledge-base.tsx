import { useState } from "react";
import {
  useListKbCategoriesAdmin,
  useCreateKbCategory,
  useUpdateKbCategory,
  useDeleteKbCategory,
  useListKbArticlesAdmin,
  useCreateKbArticle,
  useUpdateKbArticle,
  useDeleteKbArticle,
} from "@workspace/api-client-react";
import type { KbCategory, KbArticle } from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { BookOpen, Plus, Pencil, Trash2 } from "lucide-react";

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export default function AdminKnowledgeBase() {
  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-primary" /> Knowledge Base
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Manage help center categories and articles.</p>
      </div>

      <Tabs defaultValue="articles">
        <TabsList>
          <TabsTrigger value="articles">Articles</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>
        <TabsContent value="articles" className="mt-4">
          <ArticlesTab />
        </TabsContent>
        <TabsContent value="categories" className="mt-4">
          <CategoriesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CategoriesTab() {
  const { toast } = useToast();
  const { data: categories = [], isLoading, refetch } = useListKbCategoriesAdmin();
  const createCategory = useCreateKbCategory();
  const updateCategory = useUpdateKbCategory();
  const deleteCategory = useDeleteKbCategory();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<KbCategory | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", sortOrder: 0 });

  function openCreate() {
    setEditing(null);
    setForm({ name: "", slug: "", sortOrder: categories.length });
    setShowForm(true);
  }

  function openEdit(c: KbCategory) {
    setEditing(c);
    setForm({ name: c.name, slug: c.slug, sortOrder: c.sortOrder });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.slug.trim()) {
      toast({ title: "Name and slug are required", variant: "destructive" });
      return;
    }
    try {
      if (editing) {
        await updateCategory.mutateAsync({ id: editing.id, data: form });
      } else {
        await createCategory.mutateAsync({ data: form });
      }
      toast({ title: editing ? "Category updated" : "Category created" });
      setShowForm(false);
      refetch();
    } catch (err) {
      toast({ title: "Failed to save category", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  }

  async function handleDelete(c: KbCategory) {
    if (!confirm(`Delete category "${c.name}"? This will fail if it still has articles.`)) return;
    try {
      await deleteCategory.mutateAsync({ id: c.id });
      refetch();
    } catch (err) {
      toast({ title: "Failed to delete category", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Button onClick={openCreate} className="gap-2 font-mono text-xs rounded-sm self-start">
        <Plus className="w-4 h-4" /> New Category
      </Button>

      <div className="flex flex-col gap-2">
        {isLoading ? (
          <div className="text-sm text-muted-foreground font-mono">Loading...</div>
        ) : (
          categories.map((c) => (
            <div key={c.id} className="border border-border rounded-sm bg-card p-4 flex items-center justify-between gap-4">
              <div>
                <div className="font-medium text-sm">{c.name}</div>
                <div className="text-xs text-muted-foreground/70 font-mono">/{c.slug}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={() => openEdit(c)} className="rounded-sm"><Pencil className="w-3.5 h-3.5" /></Button>
                <Button variant="outline" size="sm" onClick={() => handleDelete(c)} className="rounded-sm text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-card border-border rounded-sm max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} Category</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, slug: editing ? f.slug : slugify(e.target.value) }))}
                className="rounded-sm text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Slug</Label>
              <Input value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} className="rounded-sm text-sm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Sort order</Label>
              <Input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))}
                className="rounded-sm text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={handleSave} className="rounded-sm">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ArticlesTab() {
  const { toast } = useToast();
  const { data: categories = [] } = useListKbCategoriesAdmin();
  const { data: articles = [], isLoading, refetch } = useListKbArticlesAdmin();
  const createArticle = useCreateKbArticle();
  const updateArticle = useUpdateKbArticle();
  const deleteArticle = useDeleteKbArticle();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<KbArticle | null>(null);
  const [form, setForm] = useState({ categoryId: 0, title: "", slug: "", body: "", status: "draft" as KbArticle["status"] });

  function openCreate() {
    setEditing(null);
    setForm({ categoryId: categories[0]?.id ?? 0, title: "", slug: "", body: "", status: "draft" });
    setShowForm(true);
  }

  function openEdit(a: KbArticle) {
    setEditing(a);
    setForm({ categoryId: a.categoryId, title: a.title, slug: a.slug, body: a.body, status: a.status });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.title.trim() || !form.slug.trim() || !form.body.trim() || !form.categoryId) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    try {
      if (editing) {
        await updateArticle.mutateAsync({ id: editing.id, data: form });
      } else {
        await createArticle.mutateAsync({ data: form });
      }
      toast({ title: editing ? "Article updated" : "Article created" });
      setShowForm(false);
      refetch();
    } catch (err) {
      toast({ title: "Failed to save article", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  }

  async function handleDelete(a: KbArticle) {
    if (!confirm(`Delete article "${a.title}"?`)) return;
    try {
      await deleteArticle.mutateAsync({ id: a.id });
      refetch();
    } catch {
      toast({ title: "Failed to delete article", variant: "destructive" });
    }
  }

  const categoryName = (id: number) => categories.find((c) => c.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-4">
      <Button onClick={openCreate} className="gap-2 font-mono text-xs rounded-sm self-start" disabled={categories.length === 0}>
        <Plus className="w-4 h-4" /> New Article
      </Button>
      {categories.length === 0 && (
        <p className="text-xs text-muted-foreground font-mono">Create a category first before adding articles.</p>
      )}

      <div className="flex flex-col gap-2">
        {isLoading ? (
          <div className="text-sm text-muted-foreground font-mono">Loading...</div>
        ) : (
          articles.map((a) => (
            <div key={a.id} className="border border-border rounded-sm bg-card p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{a.title}</span>
                  <Badge variant={a.status === "published" ? "default" : "outline"} className="text-xs font-mono rounded-sm">{a.status}</Badge>
                </div>
                <div className="text-xs text-muted-foreground/70 font-mono">{categoryName(a.categoryId)} · /{a.slug}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={() => openEdit(a)} className="rounded-sm"><Pencil className="w-3.5 h-3.5" /></Button>
                <Button variant="outline" size="sm" onClick={() => handleDelete(a)} className="rounded-sm text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-card border-border rounded-sm max-w-xl">
          <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} Article</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-4 py-2 max-h-[70vh] overflow-y-auto">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Category</Label>
              <Select value={String(form.categoryId)} onValueChange={(v) => setForm((f) => ({ ...f, categoryId: Number(v) }))}>
                <SelectTrigger className="rounded-sm text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value, slug: editing ? f.slug : slugify(e.target.value) }))}
                className="rounded-sm text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Slug</Label>
              <Input value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} className="rounded-sm text-sm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Body</Label>
              <Textarea rows={8} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} className="rounded-sm text-sm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v as KbArticle["status"] }))}>
                <SelectTrigger className="rounded-sm text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={handleSave} className="rounded-sm">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
