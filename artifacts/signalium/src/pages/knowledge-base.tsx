import { useState } from "react";
import { Link } from "wouter";
import { useListKbCategories, useListKbArticles } from "@workspace/api-client-react";
import { PublicShell } from "@/components/public-shell";
import { Input } from "@/components/ui/input";
import { BookOpen, Search, ChevronRight } from "lucide-react";

export default function KnowledgeBase() {
  const [q, setQ] = useState("");
  const [categorySlug, setCategorySlug] = useState<string | undefined>(undefined);

  const { data: categories = [] } = useListKbCategories();
  const { data: articles = [], isLoading } = useListKbArticles({ q: q || undefined, categorySlug });

  return (
    <PublicShell>
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="flex items-center gap-2 text-sm text-primary tracking-widest uppercase mb-4">
          <BookOpen className="w-4 h-4" /> Help Center
        </div>
        <h1 className="text-3xl md:text-4xl font-normal text-white mb-8">How can we help?</h1>

        <div className="relative mb-10 max-w-lg">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search articles..."
            className="rounded-sm pl-9"
          />
        </div>

        <div className="grid md:grid-cols-[220px_1fr] gap-10">
          <div className="flex flex-col gap-1">
            <button
              onClick={() => setCategorySlug(undefined)}
              className={`text-left px-3 py-2 rounded text-sm transition-colors ${
                !categorySlug ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-white hover:bg-white/5"
              }`}
            >
              All categories
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategorySlug(c.slug)}
                className={`text-left px-3 py-2 rounded text-sm transition-colors flex items-center justify-between gap-2 ${
                  categorySlug === c.slug ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-white hover:bg-white/5"
                }`}
              >
                <span className="truncate">{c.name}</span>
                <span className="text-xs text-muted-foreground/60 font-mono shrink-0">{c.articleCount}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            {isLoading ? (
              <div className="text-sm text-muted-foreground font-mono">Loading...</div>
            ) : articles.length === 0 ? (
              <div className="border border-white/10 rounded p-10 text-center text-muted-foreground text-sm font-light">
                No articles found.
              </div>
            ) : (
              articles.map((a) => (
                <Link
                  key={a.id}
                  href={`/kb/${a.slug}`}
                  className="border border-white/10 bg-card rounded p-5 flex items-center justify-between gap-4 hover:border-primary/40 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-white font-medium truncate">{a.title}</div>
                    <div className="text-sm text-muted-foreground font-light truncate mt-1">{a.body.slice(0, 140)}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </Link>
              ))
            )}
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
