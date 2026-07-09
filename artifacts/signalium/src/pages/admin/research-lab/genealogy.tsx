import { useState } from "react";
import { OpsShell } from "@/components/ops/ops-shell";
import { ResearchLabUnavailable, isResearchLabUnavailable } from "@/components/research-lab/unavailable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  useGetResearchLabGenealogyTree,
  useGetResearchLabModelGenealogy,
  useListResearchLabArtifactHistory,
} from "@workspace/api-client-react";
import { Network, GitCommitVertical, Boxes, Search } from "lucide-react";

function ModelDetail({ version }: { version: string }) {
  const genealogy = useGetResearchLabModelGenealogy(version, { query: { refetchInterval: 30_000 } as any });
  const artifacts = useListResearchLabArtifactHistory(version, { query: { refetchInterval: 30_000 } as any });

  return (
    <div className="space-y-4">
      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
          <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
            <GitCommitVertical className="w-4 h-4 text-cyan-400" /> Genealogy — {version}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {genealogy.error && isResearchLabUnavailable(genealogy.error) ? <ResearchLabUnavailable label="model genealogy" /> : (
            <pre className="text-xs font-mono text-cyan-100/70 whitespace-pre-wrap break-all">
              {JSON.stringify((genealogy.data as { genealogy?: unknown } | undefined)?.genealogy ?? "—", null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
      <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
        <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
          <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
            <Boxes className="w-4 h-4 text-cyan-400" /> Artifact History
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {artifacts.error && isResearchLabUnavailable(artifacts.error) ? <ResearchLabUnavailable label="artifact history" /> : (
            <div className="space-y-2">
              {(((artifacts.data as { artifacts?: unknown[] } | undefined)?.artifacts ?? []) as Array<Record<string, unknown>>).map((a, i) => (
                <div key={i} className="text-xs font-mono text-cyan-100/70">{JSON.stringify(a)}</div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminResearchLabGenealogy() {
  const [root, setRoot] = useState("");
  const [lookupVersion, setLookupVersion] = useState("");
  const [inputVersion, setInputVersion] = useState("");
  const tree = useGetResearchLabGenealogyTree({ root: root || undefined }, { query: { refetchInterval: 30_000 } as any });

  return (
    <OpsShell title="Research Lab — QDE Genealogy" description="Model lineage tree, parent models, datasets, feature versions, and artifact history.">
      <div className="space-y-4 sm:space-y-6">
        <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
            <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
              <Network className="w-4 h-4 text-cyan-400" /> Lineage Tree
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Root model version (optional)" value={root} onChange={(e) => setRoot(e.target.value)} className="max-w-xs" />
            </div>
            {tree.isLoading ? (
              <div className="text-cyan-500/50 text-sm py-4 text-center font-mono animate-pulse">[ LOADING TREE... ]</div>
            ) : tree.error && isResearchLabUnavailable(tree.error) ? (
              <ResearchLabUnavailable label="genealogy tree" />
            ) : (
              <pre className="text-xs font-mono text-cyan-100/70 whitespace-pre-wrap break-all">
                {JSON.stringify((tree.data as { tree?: unknown } | undefined)?.tree ?? "—", null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>

        <Card className="border-cyan-900/40 bg-card/50 backdrop-blur">
          <CardHeader className="pb-3 border-b border-cyan-900/20 bg-muted/10">
            <CardTitle className="text-sm flex items-center gap-2 text-cyan-50 font-mono uppercase tracking-wider">
              <Search className="w-4 h-4 text-cyan-400" /> Look up a Model Version
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Model version (e.g. v1.4.2)" value={inputVersion} onChange={(e) => setInputVersion(e.target.value)} className="max-w-xs" />
              <Button size="sm" onClick={() => setLookupVersion(inputVersion)} disabled={!inputVersion.trim()}>Look up</Button>
            </div>
            {lookupVersion ? <ModelDetail version={lookupVersion} /> : (
              <div className="text-cyan-500/50 text-xs font-mono uppercase tracking-wider">[ Enter a model version to view its genealogy ]</div>
            )}
          </CardContent>
        </Card>
      </div>
    </OpsShell>
  );
}
