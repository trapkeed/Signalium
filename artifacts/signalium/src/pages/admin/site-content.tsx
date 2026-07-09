import { useEffect, useState } from "react";
import { useGetSiteContent, useUpdateSiteContent } from "@workspace/api-client-react";
import { DEFAULT_SITE_CONTENT, mergeSiteContent, type SiteContentData } from "@/lib/site-content";
import { useToast } from "@/hooks/use-toast";
import { Layout, Plus, Trash2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-sm bg-card p-5 flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{label}</Label>
      {multiline ? (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} className="rounded-sm text-sm" rows={3} />
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="rounded-sm text-sm" />
      )}
    </div>
  );
}

// Generic editor for arrays of plain strings (bullets, badges) with add/remove.
function StringListEditor({ label, items, onChange }: { label: string; items: string[]; onChange: (items: string[]) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{label}</Label>
      {items.map((item, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={item}
            onChange={(e) => onChange(items.map((it, j) => (j === i ? e.target.value : it)))}
            className="rounded-sm text-sm"
          />
          <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-destructive shrink-0" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="self-start gap-1 text-xs rounded-sm" onClick={() => onChange([...items, ""])}>
        <Plus className="w-3.5 h-3.5" /> Add
      </Button>
    </div>
  );
}

// Generic editor for arrays of { title/desc } or { q/a } or { label/value } style card objects.
function ObjectListEditor<T extends Record<string, string>>({
  label,
  items,
  fields,
  empty,
  onChange,
}: {
  label: string;
  items: T[];
  fields: { key: keyof T; placeholder: string; multiline?: boolean }[];
  empty: T;
  onChange: (items: T[]) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{label}</Label>
      {items.map((item, i) => (
        <div key={i} className="border border-border rounded-sm p-3 flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground font-mono">#{i + 1}</span>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => onChange(items.filter((_, j) => j !== i))}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
          {fields.map((f) =>
            f.multiline ? (
              <Textarea
                key={String(f.key)}
                value={item[f.key] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => onChange(items.map((it, j) => (j === i ? { ...it, [f.key]: e.target.value } : it)))}
                className="rounded-sm text-sm"
                rows={2}
              />
            ) : (
              <Input
                key={String(f.key)}
                value={item[f.key] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => onChange(items.map((it, j) => (j === i ? { ...it, [f.key]: e.target.value } : it)))}
                className="rounded-sm text-sm"
              />
            ),
          )}
        </div>
      ))}
      <Button variant="outline" size="sm" className="self-start gap-1 text-xs rounded-sm" onClick={() => onChange([...items, empty])}>
        <Plus className="w-3.5 h-3.5" /> Add
      </Button>
    </div>
  );
}

export default function AdminSiteContent() {
  const { toast } = useToast();
  const { data, refetch, isLoading } = useGetSiteContent();
  const updateSiteContent = useUpdateSiteContent();
  const [content, setContent] = useState<SiteContentData>(DEFAULT_SITE_CONTENT);
  const [hasOverride, setHasOverride] = useState(false);

  useEffect(() => {
    if (!data) return;
    setHasOverride(!!data.content);
    setContent(data.content ? mergeSiteContent(JSON.parse(data.content)) : DEFAULT_SITE_CONTENT);
  }, [data]);

  function set<K extends keyof SiteContentData>(key: K, value: SiteContentData[K]) {
    setContent((c) => ({ ...c, [key]: value }));
  }

  async function handleSave() {
    try {
      await updateSiteContent.mutateAsync({ data: { content: JSON.stringify(content) } });
      toast({ title: "Homepage content updated" });
      refetch();
    } catch (err) {
      toast({ title: "Failed to save", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  }

  async function handleReset() {
    try {
      await updateSiteContent.mutateAsync({ data: { content: null } });
      toast({ title: "Homepage content reset to defaults" });
      refetch();
    } catch {
      toast({ title: "Failed to reset", variant: "destructive" });
    }
  }

  if (isLoading) {
    return <div className="p-6 lg:p-8 text-sm text-muted-foreground font-mono">Loading…</div>;
  }

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Layout className="w-5 h-5 text-primary" /> Homepage Content
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Edit the copy shown on the public landing page. Changes apply immediately once saved.
            {hasOverride ? " Currently showing a customized version." : " Currently showing built-in defaults."}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {hasOverride && (
            <Button variant="outline" onClick={handleReset} className="gap-2 font-mono text-xs rounded-sm" disabled={updateSiteContent.isPending}>
              <RotateCcw className="w-4 h-4" /> Reset to Defaults
            </Button>
          )}
          <Button onClick={handleSave} className="font-mono text-xs rounded-sm" disabled={updateSiteContent.isPending}>
            Save Changes
          </Button>
        </div>
      </div>

      <Section title="Hero">
        <Field label="Badge" value={content.hero.badge} onChange={(v) => set("hero", { ...content.hero, badge: v })} />
        <Field label="Headline" value={content.hero.headline} onChange={(v) => set("hero", { ...content.hero, headline: v })} />
        <Field label="Subheadline" value={content.hero.subheadline} onChange={(v) => set("hero", { ...content.hero, subheadline: v })} multiline />
        <Field label="Primary button label" value={content.hero.primaryCtaLabel} onChange={(v) => set("hero", { ...content.hero, primaryCtaLabel: v })} />
        <Field label="Secondary button label" value={content.hero.secondaryCtaLabel} onChange={(v) => set("hero", { ...content.hero, secondaryCtaLabel: v })} />
      </Section>

      <Section title="How It Works">
        <Field label="Eyebrow" value={content.howItWorks.eyebrow} onChange={(v) => set("howItWorks", { ...content.howItWorks, eyebrow: v })} />
        <Field label="Heading" value={content.howItWorks.heading} onChange={(v) => set("howItWorks", { ...content.howItWorks, heading: v })} />
        <ObjectListEditor
          label="Steps"
          items={content.howItWorks.steps}
          fields={[{ key: "title", placeholder: "Step title" }, { key: "desc", placeholder: "Step description", multiline: true }]}
          empty={{ title: "", desc: "" }}
          onChange={(v) => set("howItWorks", { ...content.howItWorks, steps: v })}
        />
      </Section>

      <Section title="Trading Modes">
        <Field label="Eyebrow" value={content.tradingModes.eyebrow} onChange={(v) => set("tradingModes", { ...content.tradingModes, eyebrow: v })} />
        <Field label="Heading" value={content.tradingModes.heading} onChange={(v) => set("tradingModes", { ...content.tradingModes, heading: v })} />
        <div className="border border-border rounded-sm p-3 flex flex-col gap-2">
          <span className="text-xs text-muted-foreground font-mono uppercase">Manual mode</span>
          <Field label="Title" value={content.tradingModes.manual.title} onChange={(v) => set("tradingModes", { ...content.tradingModes, manual: { ...content.tradingModes.manual, title: v } })} />
          <Field label="Description" value={content.tradingModes.manual.desc} onChange={(v) => set("tradingModes", { ...content.tradingModes, manual: { ...content.tradingModes.manual, desc: v } })} multiline />
          <StringListEditor label="Bullets" items={content.tradingModes.manual.bullets} onChange={(v) => set("tradingModes", { ...content.tradingModes, manual: { ...content.tradingModes.manual, bullets: v } })} />
        </div>
        <div className="border border-border rounded-sm p-3 flex flex-col gap-2">
          <span className="text-xs text-muted-foreground font-mono uppercase">Autonomous mode</span>
          <Field label="Title" value={content.tradingModes.autonomous.title} onChange={(v) => set("tradingModes", { ...content.tradingModes, autonomous: { ...content.tradingModes.autonomous, title: v } })} />
          <Field label="Description" value={content.tradingModes.autonomous.desc} onChange={(v) => set("tradingModes", { ...content.tradingModes, autonomous: { ...content.tradingModes.autonomous, desc: v } })} multiline />
          <StringListEditor label="Bullets" items={content.tradingModes.autonomous.bullets} onChange={(v) => set("tradingModes", { ...content.tradingModes, autonomous: { ...content.tradingModes.autonomous, bullets: v } })} />
        </div>
      </Section>

      <Section title="Core Pillars">
        <Field label="Eyebrow" value={content.pillars.eyebrow} onChange={(v) => set("pillars", { ...content.pillars, eyebrow: v })} />
        <Field label="Heading" value={content.pillars.heading} onChange={(v) => set("pillars", { ...content.pillars, heading: v })} />
        <ObjectListEditor
          label="Pillars"
          items={content.pillars.items}
          fields={[{ key: "title", placeholder: "Pillar title" }, { key: "desc", placeholder: "Description", multiline: true }]}
          empty={{ title: "", desc: "" }}
          onChange={(v) => set("pillars", { ...content.pillars, items: v })}
        />
      </Section>

      <Section title="Security">
        <Field label="Eyebrow" value={content.security.eyebrow} onChange={(v) => set("security", { ...content.security, eyebrow: v })} />
        <Field label="Heading" value={content.security.heading} onChange={(v) => set("security", { ...content.security, heading: v })} />
        <Field label="Body" value={content.security.body} onChange={(v) => set("security", { ...content.security, body: v })} multiline />
        <StringListEditor label="Bullets" items={content.security.bullets} onChange={(v) => set("security", { ...content.security, bullets: v })} />
      </Section>

      <Section title="FAQ">
        <ObjectListEditor
          label="Questions"
          items={content.faq}
          fields={[{ key: "q", placeholder: "Question" }, { key: "a", placeholder: "Answer", multiline: true }]}
          empty={{ q: "", a: "" }}
          onChange={(v) => set("faq", v)}
        />
      </Section>

      <Section title="Closing CTA">
        <Field label="Heading" value={content.cta.heading} onChange={(v) => set("cta", { ...content.cta, heading: v })} />
        <Field label="Body" value={content.cta.body} onChange={(v) => set("cta", { ...content.cta, body: v })} multiline />
        <Field label="Button label" value={content.cta.buttonLabel} onChange={(v) => set("cta", { ...content.cta, buttonLabel: v })} />
      </Section>

      <div className="flex justify-end gap-2 pb-8">
        {hasOverride && (
          <Button variant="outline" onClick={handleReset} className="gap-2 font-mono text-xs rounded-sm" disabled={updateSiteContent.isPending}>
            <RotateCcw className="w-4 h-4" /> Reset to Defaults
          </Button>
        )}
        <Button onClick={handleSave} className="font-mono text-xs rounded-sm" disabled={updateSiteContent.isPending}>
          Save Changes
        </Button>
      </div>
    </div>
  );
}
