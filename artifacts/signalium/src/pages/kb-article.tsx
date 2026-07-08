import { useParams, Link } from "wouter";
import { useGetKbArticle } from "@workspace/api-client-react";
import { PublicShell } from "@/components/public-shell";
import { ArrowLeft } from "lucide-react";

export default function KbArticle() {
  const { slug } = useParams<{ slug: string }>();
  const { data: article, isLoading, error } = useGetKbArticle(slug ?? "");

  return (
    <PublicShell>
      <section className="max-w-3xl mx-auto px-6 py-20">
        <Link href="/kb" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-white mb-8 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Help Center
        </Link>

        {isLoading ? (
          <div className="text-sm text-muted-foreground font-mono">Loading...</div>
        ) : error || !article ? (
          <div className="border border-white/10 rounded p-10 text-center text-muted-foreground text-sm font-light">
            Article not found.
          </div>
        ) : (
          <article>
            <h1 className="text-3xl md:text-4xl font-normal text-white mb-6">{article.title}</h1>
            <div className="text-muted-foreground font-light leading-relaxed whitespace-pre-wrap">{article.body}</div>
          </article>
        )}
      </section>
    </PublicShell>
  );
}
