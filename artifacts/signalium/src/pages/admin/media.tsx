import { useState } from "react";
import {
  useListMediaAssets,
  useCreateMediaAsset,
  useDeleteMediaAsset,
  MediaAssetCategory,
} from "@workspace/api-client-react";
import type { MediaAsset } from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { useToast } from "@/hooks/use-toast";
import { Upload, Trash2, Copy, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CATEGORIES = Object.values(MediaAssetCategory);

function assetUrl(objectPath: string): string {
  return `/api/storage${objectPath}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AssetCard({ asset, onDelete }: { asset: MediaAsset; onDelete: (id: number) => void }) {
  const { toast } = useToast();
  const url = assetUrl(asset.objectPath);
  const isImage = asset.contentType.startsWith("image/");

  function copyUrl() {
    navigator.clipboard.writeText(`${window.location.origin}${url}`);
    toast({ title: "URL copied to clipboard" });
  }

  return (
    <div className="border border-border rounded-sm bg-card overflow-hidden flex flex-col">
      <div className="aspect-video bg-secondary/40 flex items-center justify-center overflow-hidden">
        {isImage ? (
          <img src={url} alt={asset.altText ?? asset.fileName} className="w-full h-full object-contain" />
        ) : (
          <ImageIcon className="w-8 h-8 text-muted-foreground" />
        )}
      </div>
      <div className="p-3 flex flex-col gap-2">
        <div className="text-xs font-mono truncate" title={asset.fileName}>{asset.fileName}</div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono">
          <span className="uppercase">{asset.category}</span>
          <span>{formatBytes(asset.size)}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="rounded-sm text-xs flex-1 gap-1.5" onClick={copyUrl}>
            <Copy className="w-3 h-3" /> Copy URL
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive h-8 w-8 p-0 rounded-sm shrink-0" onClick={() => onDelete(asset.id)}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AdminMedia() {
  const { toast } = useToast();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [uploadCategory, setUploadCategory] = useState<string>(MediaAssetCategory.other);

  const { data: assets = [], refetch } = useListMediaAssets(
    categoryFilter === "all" ? undefined : { category: categoryFilter as MediaAssetCategory },
  );
  const createAsset = useCreateMediaAsset();
  const deleteAsset = useDeleteMediaAsset();
  const { uploadFile, isUploading } = useUpload({
    onError: (err) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const uploaded = await uploadFile(file);
    if (!uploaded) return;

    try {
      await createAsset.mutateAsync({
        data: {
          objectPath: uploaded.objectPath,
          fileName: file.name,
          contentType: uploaded.metadata.contentType,
          size: uploaded.metadata.size,
          category: uploadCategory as MediaAssetCategory,
        },
      });
      toast({ title: "Media asset uploaded" });
      refetch();
    } catch (err) {
      toast({
        title: "Failed to register asset",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteAsset.mutateAsync({ id });
      toast({ title: "Asset deleted" });
      refetch();
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="border-b border-border px-8 py-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight">Media Library</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage favicons, logos, and other assets backed by object storage.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={uploadCategory} onValueChange={setUploadCategory}>
            <SelectTrigger className="rounded-sm font-mono text-xs w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button asChild className="gap-2 font-mono text-xs rounded-sm cursor-pointer" disabled={isUploading}>
            <label>
              <Upload className="w-4 h-4" /> {isUploading ? "Uploading..." : "Upload"}
              <input type="file" className="hidden" onChange={handleFileChange} disabled={isUploading} />
            </label>
          </Button>
        </div>
      </div>

      <div className="p-8 flex flex-col gap-6">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Filter</span>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="rounded-sm font-mono text-xs w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {assets.length === 0 ? (
          <div className="border border-border rounded-sm p-12 text-center text-muted-foreground font-mono text-xs">
            No media assets yet. Upload one to get started.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {assets.map((asset) => (
              <AssetCard key={asset.id} asset={asset} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
