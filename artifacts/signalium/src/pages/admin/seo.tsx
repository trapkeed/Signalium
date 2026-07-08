import { useState } from "react";
import {
  useListSeoPages,
  useCreateSeoPage,
  useUpdateSeoPage,
  useDeleteSeoPage,
  useListSeoRedirects,
  useCreateSeoRedirect,
  useUpdateSeoRedirect,
  useDeleteSeoRedirect,
  useGetSeoSettings,
  useUpdateSeoSettings,
} from "@workspace/api-client-react";
import type { SeoPage, SeoRedirect, HreflangEntry } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Search, Plus, Trash2, Globe, ArrowRightLeft, FileCode, ExternalLink, Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type PageForm = {
  path: string;
  title: string;
  description: string;
  canonicalUrl: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  twitterCard: "summary" | "summary_large_image";
  twitterTitle: string;
  twitterDescription: string;
  twitterImage: string;
  structuredData: string;
  noIndex: boolean;
  noFollow: boolean;
  hreflang: HreflangEntry[];
};

const EMPTY_PAGE_FORM: PageForm = {
  path: "",
  title: "",
  description: "",
  canonicalUrl: "",
  ogTitle: "",
  ogDescription: "",
  ogImage: "",
  twitterCard: "summary_large_image",
  twitterTitle: "",
  twitterDescription: "",
  twitterImage: "",
  structuredData: "",
  noIndex: false,
  noFollow: false,
  hreflang: [],
};

function pageToForm(p: SeoPage): PageForm {
  return {
    path: p.path,
    title: p.title ?? "",
    description: p.description ?? "",
    canonicalUrl: p.canonicalUrl ?? "",
    ogTitle: p.ogTitle ?? "",
    ogDescription: p.ogDescription ?? "",
    ogImage: p.ogImage ?? "",
    twitterCard: p.twitterCard,
    twitterTitle: p.twitterTitle ?? "",
    twitterDescription: p.twitterDescription ?? "",
    twitterImage: p.twitterImage ?? "",
    structuredData: p.structuredData ?? "",
    noIndex: p.noIndex,
    noFollow: p.noFollow,
    hreflang: p.hreflang ?? [],
  };
}

function formToPayload(f: PageForm) {
  return {
    path: f.path,
    title: f.title || undefined,
    description: f.description || undefined,
    canonicalUrl: f.canonicalUrl || undefined,
    ogTitle: f.ogTitle || undefined,
    ogDescription: f.ogDescription || undefined,
    ogImage: f.ogImage || undefined,
    twitterCard: f.twitterCard,
    twitterTitle: f.twitterTitle || undefined,
    twitterDescription: f.twitterDescription || undefined,
    twitterImage: f.twitterImage || undefined,
    structuredData: f.structuredData || undefined,
    noIndex: f.noIndex,
    noFollow: f.noFollow,
    hreflang: f.hreflang.filter((h) => h.lang.trim() && h.url.trim()),
  };
}

function PagesTab() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<PageForm>(EMPTY_PAGE_FORM);

  const { data: pages = [], refetch } = useListSeoPages();
  const createPage = useCreateSeoPage();
  const updatePage = useUpdateSeoPage();
  const deletePage = useDeleteSeoPage();

  const filtered = pages.filter(
    (p) => !search || p.path.toLowerCase().includes(search.toLowerCase()) || (p.title ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  function openCreate() {
    setEditId(null);
    setForm(EMPTY_PAGE_FORM);
    setShowForm(true);
  }

  function openEdit(p: SeoPage) {
    setEditId(p.id);
    setForm(pageToForm(p));
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.path.trim()) {
      toast({ title: "Path is required", variant: "destructive" });
      return;
    }
    try {
      if (editId) {
        const { path: _path, ...rest } = formToPayload(form);
        await updatePage.mutateAsync({ id: editId, data: rest });
        toast({ title: "Page SEO updated" });
      } else {
        await createPage.mutateAsync({ data: formToPayload(form) });
        toast({ title: "Page SEO created" });
      }
      setShowForm(false);
      refetch();
    } catch (err) {
      toast({
        title: "Failed to save",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  async function handleDelete(id: number) {
    try {
      await deletePage.mutateAsync({ id });
      toast({ title: "Page SEO deleted" });
      refetch();
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  }

  function field<K extends keyof PageForm>(key: K, value: PageForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function addHreflang() {
    setForm((f) => ({ ...f, hreflang: [...f.hreflang, { lang: "", url: "" }] }));
  }

  function updateHreflang(index: number, patch: Partial<HreflangEntry>) {
    setForm((f) => ({
      ...f,
      hreflang: f.hreflang.map((h, i) => (i === index ? { ...h, ...patch } : h)),
    }));
  }

  function removeHreflang(index: number) {
    setForm((f) => ({ ...f, hreflang: f.hreflang.filter((_, i) => i !== index) }));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by path or title..."
            className="pl-9 rounded-sm font-mono text-sm"
          />
        </div>
        <Button onClick={openCreate} className="gap-2 font-mono text-xs rounded-sm shrink-0">
          <Plus className="w-4 h-4" /> Add Page
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {filtered.length === 0 ? (
          <div className="border border-border rounded-sm p-12 text-center text-muted-foreground font-mono text-xs">
            No page SEO configs yet.
          </div>
        ) : (
          filtered.map((p) => (
            <div key={p.id} className="border border-border rounded-sm bg-card p-5 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-medium font-mono text-sm">{p.path}</span>
                  {p.noIndex && <Badge variant="outline" className="text-xs font-mono rounded-sm">noindex</Badge>}
                  {p.noFollow && <Badge variant="outline" className="text-xs font-mono rounded-sm">nofollow</Badge>}
                </div>
                <div className="text-sm text-foreground truncate">{p.title || <span className="text-muted-foreground italic">No title</span>}</div>
                <div className="text-xs text-muted-foreground truncate mt-0.5">{p.description || "No description"}</div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" className="rounded-sm text-xs" onClick={() => openEdit(p)}>Edit</Button>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive h-8 w-8 p-0 rounded-sm" onClick={() => handleDelete(p.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-card border-border rounded-sm max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono">{editId ? "Edit Page SEO" : "New Page SEO"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Path</Label>
              <Input
                value={form.path}
                onChange={(e) => field("path", e.target.value)}
                placeholder="/dashboard"
                disabled={!!editId}
                className="rounded-sm font-mono text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Title</Label>
              <Input value={form.title} onChange={(e) => field("title", e.target.value)} className="rounded-sm text-sm" />
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Description</Label>
              <Textarea value={form.description} onChange={(e) => field("description", e.target.value)} className="rounded-sm text-sm" rows={2} />
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Canonical URL</Label>
              <Input value={form.canonicalUrl} onChange={(e) => field("canonicalUrl", e.target.value)} className="rounded-sm font-mono text-sm" placeholder="https://signalium.com/dashboard" />
            </div>

            <div className="col-span-2 border-t border-border pt-3 mt-1 text-xs font-mono uppercase tracking-wider text-muted-foreground">Open Graph</div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">OG Title</Label>
              <Input value={form.ogTitle} onChange={(e) => field("ogTitle", e.target.value)} className="rounded-sm text-sm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">OG Image URL</Label>
              <Input value={form.ogImage} onChange={(e) => field("ogImage", e.target.value)} className="rounded-sm font-mono text-sm" />
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">OG Description</Label>
              <Textarea value={form.ogDescription} onChange={(e) => field("ogDescription", e.target.value)} className="rounded-sm text-sm" rows={2} />
            </div>

            <div className="col-span-2 border-t border-border pt-3 mt-1 text-xs font-mono uppercase tracking-wider text-muted-foreground">Twitter Card</div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Card Type</Label>
              <Select value={form.twitterCard} onValueChange={(v) => field("twitterCard", v as PageForm["twitterCard"])}>
                <SelectTrigger className="rounded-sm font-mono text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="summary">summary</SelectItem>
                  <SelectItem value="summary_large_image">summary_large_image</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Twitter Image URL</Label>
              <Input value={form.twitterImage} onChange={(e) => field("twitterImage", e.target.value)} className="rounded-sm font-mono text-sm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Twitter Title</Label>
              <Input value={form.twitterTitle} onChange={(e) => field("twitterTitle", e.target.value)} className="rounded-sm text-sm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Twitter Description</Label>
              <Input value={form.twitterDescription} onChange={(e) => field("twitterDescription", e.target.value)} className="rounded-sm text-sm" />
            </div>

            <div className="col-span-2 border-t border-border pt-3 mt-1 text-xs font-mono uppercase tracking-wider text-muted-foreground">Structured Data & Indexing</div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Structured Data (JSON-LD)</Label>
              <Textarea
                value={form.structuredData}
                onChange={(e) => field("structuredData", e.target.value)}
                className="rounded-sm font-mono text-xs"
                rows={4}
                placeholder='{"@context": "https://schema.org", "@type": "WebPage"}'
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.noIndex} onCheckedChange={(v) => field("noIndex", v)} />
              <Label className="text-sm">No Index</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.noFollow} onCheckedChange={(v) => field("noFollow", v)} />
              <Label className="text-sm">No Follow</Label>
            </div>

            <div className="col-span-2 border-t border-border pt-3 mt-1 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground">
                <Languages className="w-3.5 h-3.5" /> Hreflang Alternates
              </div>
              <Button type="button" variant="outline" size="sm" className="rounded-sm text-xs gap-1" onClick={addHreflang}>
                <Plus className="w-3.5 h-3.5" /> Add
              </Button>
            </div>
            {form.hreflang.length === 0 ? (
              <div className="col-span-2 text-xs text-muted-foreground font-mono">
                No alternate-language versions configured for this page.
              </div>
            ) : (
              form.hreflang.map((entry, i) => (
                <div key={i} className="col-span-2 flex items-center gap-2">
                  <Input
                    value={entry.lang}
                    onChange={(e) => updateHreflang(i, { lang: e.target.value })}
                    placeholder="en-US"
                    className="rounded-sm font-mono text-sm w-28 shrink-0"
                  />
                  <Input
                    value={entry.url}
                    onChange={(e) => updateHreflang(i, { url: e.target.value })}
                    placeholder="https://signalium.com/en/dashboard"
                    className="rounded-sm font-mono text-sm flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive h-8 w-8 p-0 rounded-sm shrink-0"
                    onClick={() => removeHreflang(i)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={handleSave} disabled={createPage.isPending || updatePage.isPending} className="rounded-sm font-mono">
              {(createPage.isPending || updatePage.isPending) ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type RedirectForm = { fromPath: string; toPath: string; statusCode: string; isActive: boolean };
const EMPTY_REDIRECT_FORM: RedirectForm = { fromPath: "", toPath: "", statusCode: "301", isActive: true };

function RedirectsTab() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<RedirectForm>(EMPTY_REDIRECT_FORM);

  const { data: redirects = [], refetch } = useListSeoRedirects();
  const createRedirect = useCreateSeoRedirect();
  const updateRedirect = useUpdateSeoRedirect();
  const deleteRedirect = useDeleteSeoRedirect();

  function openCreate() {
    setEditId(null);
    setForm(EMPTY_REDIRECT_FORM);
    setShowForm(true);
  }

  function openEdit(r: SeoRedirect) {
    setEditId(r.id);
    setForm({ fromPath: r.fromPath, toPath: r.toPath, statusCode: String(r.statusCode), isActive: r.isActive });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.fromPath.trim() || !form.toPath.trim()) {
      toast({ title: "From and To paths are required", variant: "destructive" });
      return;
    }
    const payload = {
      fromPath: form.fromPath,
      toPath: form.toPath,
      statusCode: Number(form.statusCode),
      isActive: form.isActive,
    };
    try {
      if (editId) {
        await updateRedirect.mutateAsync({ id: editId, data: payload });
        toast({ title: "Redirect updated" });
      } else {
        await createRedirect.mutateAsync({ data: payload });
        toast({ title: "Redirect created" });
      }
      setShowForm(false);
      refetch();
    } catch (err) {
      toast({
        title: "Failed to save redirect",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteRedirect.mutateAsync({ id });
      toast({ title: "Redirect deleted" });
      refetch();
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={openCreate} className="gap-2 font-mono text-xs rounded-sm">
          <Plus className="w-4 h-4" /> Add Redirect
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {redirects.length === 0 ? (
          <div className="border border-border rounded-sm p-12 text-center text-muted-foreground font-mono text-xs">
            No redirects configured yet.
          </div>
        ) : (
          redirects.map((r) => (
            <div key={r.id} className="border border-border rounded-sm bg-card p-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0 font-mono text-sm">
                <span className="truncate">{r.fromPath}</span>
                <ArrowRightLeft className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="truncate text-muted-foreground">{r.toPath}</span>
                <Badge variant="outline" className="text-xs font-mono rounded-sm shrink-0">{r.statusCode}</Badge>
                {!r.isActive && <Badge variant="outline" className="text-xs font-mono rounded-sm shrink-0 text-muted-foreground">inactive</Badge>}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" className="rounded-sm text-xs" onClick={() => openEdit(r)}>Edit</Button>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive h-8 w-8 p-0 rounded-sm" onClick={() => handleDelete(r.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-card border-border rounded-sm max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono">{editId ? "Edit Redirect" : "New Redirect"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">From Path</Label>
              <Input value={form.fromPath} onChange={(e) => setForm((f) => ({ ...f, fromPath: e.target.value }))} placeholder="/old-page" className="rounded-sm font-mono text-sm" />
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">To Path</Label>
              <Input value={form.toPath} onChange={(e) => setForm((f) => ({ ...f, toPath: e.target.value }))} placeholder="/new-page" className="rounded-sm font-mono text-sm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Status Code</Label>
              <Select value={form.statusCode} onValueChange={(v) => setForm((f) => ({ ...f, statusCode: v }))}>
                <SelectTrigger className="rounded-sm font-mono text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="301">301 - Permanent</SelectItem>
                  <SelectItem value="302">302 - Found</SelectItem>
                  <SelectItem value="307">307 - Temporary</SelectItem>
                  <SelectItem value="308">308 - Permanent Redirect</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
              <Label className="text-sm">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} className="rounded-sm">Cancel</Button>
            <Button onClick={handleSave} disabled={createRedirect.isPending || updateRedirect.isPending} className="rounded-sm font-mono">
              {(createRedirect.isPending || updateRedirect.isPending) ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SettingsTab() {
  const { toast } = useToast();
  const { data: settings, refetch } = useGetSeoSettings();
  const updateSettings = useUpdateSeoSettings();
  const [robotsTxt, setRobotsTxt] = useState<string | null>(null);
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  const [faviconUrl, setFaviconUrl] = useState<string | null>(null);
  const [sitemapEnabled, setSitemapEnabled] = useState<boolean | null>(null);

  const effectiveRobotsTxt = robotsTxt ?? settings?.robotsTxt ?? "";
  const effectiveSiteUrl = siteUrl ?? settings?.siteUrl ?? "";
  const effectiveFaviconUrl = faviconUrl ?? settings?.faviconUrl ?? "";
  const effectiveSitemapEnabled = sitemapEnabled ?? settings?.sitemapEnabled ?? true;

  async function handleSave() {
    try {
      await updateSettings.mutateAsync({
        data: {
          robotsTxt: effectiveRobotsTxt,
          siteUrl: effectiveSiteUrl || undefined,
          faviconUrl: effectiveFaviconUrl || undefined,
          sitemapEnabled: effectiveSitemapEnabled,
        },
      });
      toast({ title: "SEO settings saved" });
      setRobotsTxt(null);
      setSiteUrl(null);
      setFaviconUrl(null);
      setSitemapEnabled(null);
      refetch();
    } catch (err) {
      toast({
        title: "Failed to save settings",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div className="border border-border rounded-sm bg-card p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm font-mono font-medium">
          <Globe className="w-4 h-4 text-primary" /> Site Settings
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Canonical Site URL</Label>
          <Input
            value={effectiveSiteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            placeholder="https://signalium.com"
            className="rounded-sm font-mono text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Favicon URL</Label>
          <div className="flex items-center gap-3">
            {effectiveFaviconUrl ? (
              <img src={effectiveFaviconUrl} alt="Favicon preview" className="w-6 h-6 rounded-sm border border-border object-contain" />
            ) : null}
            <Input
              value={effectiveFaviconUrl}
              onChange={(e) => setFaviconUrl(e.target.value)}
              placeholder="/favicon.svg or an uploaded media URL"
              className="rounded-sm font-mono text-sm"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Upload an icon in the Media Library, copy its URL, and paste it here. Leave blank to use the default site favicon.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={effectiveSitemapEnabled} onCheckedChange={(v) => setSitemapEnabled(v)} />
          <Label className="text-sm">Enable sitemap.xml</Label>
          <a
            href="/api/seo/sitemap.xml"
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-xs text-primary hover:underline flex items-center gap-1 font-mono"
          >
            View sitemap.xml <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      <div className="border border-border rounded-sm bg-card p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-mono font-medium">
            <FileCode className="w-4 h-4 text-primary" /> robots.txt
          </div>
          <a
            href="/api/seo/robots.txt"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary hover:underline flex items-center gap-1 font-mono"
          >
            View robots.txt <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <Textarea
          value={effectiveRobotsTxt}
          onChange={(e) => setRobotsTxt(e.target.value)}
          rows={10}
          className="rounded-sm font-mono text-xs"
        />
      </div>

      <div>
        <Button onClick={handleSave} disabled={updateSettings.isPending} className="rounded-sm font-mono">
          {updateSettings.isPending ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}

export default function AdminSeo() {
  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-xl font-bold font-mono tracking-tight">SEO Management</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage per-page metadata, redirects, robots.txt, and sitemap settings.
        </p>
      </div>

      <div className="p-8">
        <Tabs defaultValue="pages">
          <TabsList className="rounded-sm mb-6 bg-secondary/50 border border-border">
            <TabsTrigger value="pages" className="rounded-sm font-mono text-xs">Pages</TabsTrigger>
            <TabsTrigger value="redirects" className="rounded-sm font-mono text-xs">Redirects</TabsTrigger>
            <TabsTrigger value="settings" className="rounded-sm font-mono text-xs">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="pages">
            <PagesTab />
          </TabsContent>
          <TabsContent value="redirects">
            <RedirectsTab />
          </TabsContent>
          <TabsContent value="settings">
            <SettingsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
