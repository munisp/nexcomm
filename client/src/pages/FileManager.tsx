/**
 * FileManager — secure file storage and management
 * Upload files to MinIO/S3, list, download (presigned URL), and delete.
 *
 * API shapes (from fileManagerRouter):
 *   requestUpload  → { fileName, mimeType, sizeBytes, folder? } → { uploadUrl, fileKey }
 *   confirmUpload  → { fileKey, fileName, mimeType, sizeBytes, folder? } → record
 *   list           → { folder?, page?, pageSize? } → { items, total, page, pageSize }
 *   getDownloadUrl → { fileId: number } → { url, fileName, mimeType }  [query]
 *   delete         → { fileId: number } → { success }
 */
import { useState, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Upload,
  FolderOpen,
  Download,
  Trash2,
  FileText,
  Image,
  Film,
  Music,
  Archive,
  File,
  RefreshCw,
  CloudUpload,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function FileIcon({ mimeType }: { mimeType: string | null }) {
  if (!mimeType) return <File className="h-4 w-4 text-muted-foreground" />;
  if (mimeType.startsWith("image/")) return <Image className="h-4 w-4 text-blue-500" />;
  if (mimeType.startsWith("video/")) return <Film className="h-4 w-4 text-purple-500" />;
  if (mimeType.startsWith("audio/")) return <Music className="h-4 w-4 text-green-500" />;
  if (mimeType.includes("pdf")) return <FileText className="h-4 w-4 text-red-500" />;
  if (mimeType.includes("zip") || mimeType.includes("tar") || mimeType.includes("gzip"))
    return <Archive className="h-4 w-4 text-yellow-500" />;
  return <FileText className="h-4 w-4 text-muted-foreground" />;
}

// ── Upload progress item ──────────────────────────────────────────────────────
type UploadItem = {
  id: string;
  name: string;
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
};

// ── Main page ─────────────────────────────────────────────────────────────────
export default function FileManager() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const utils = trpc.useUtils();

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: listData, isLoading } = trpc.fileManager.list.useQuery({
    page: 1,
    pageSize: 50,
  });
  const files = listData?.items ?? [];

  // ── Mutations ────────────────────────────────────────────────────────────────
  const requestUpload = trpc.fileManager.requestUpload.useMutation();
  const confirmUpload = trpc.fileManager.confirmUpload.useMutation({
    onSuccess: () => utils.fileManager.list.invalidate(),
  });
  const deleteFile = trpc.fileManager.delete.useMutation({
    onSuccess: () => {
      toast.success("File deleted.");
      utils.fileManager.list.invalidate();
    },
    onError: (err) => toast.error(`Delete failed: ${err.message}`),
  });

  // getDownloadUrl is a query, so we call it imperatively via utils
  const handleDownload = async (fileId: number, filename: string) => {
    setDownloadingId(fileId);
    try {
      const result = await utils.fileManager.getDownloadUrl.fetch({ fileId });
      const a = document.createElement("a");
      a.href = result.url;
      a.download = filename;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err: any) {
      toast.error(`Download failed: ${err.message}`);
    } finally {
      setDownloadingId(null);
    }
  };

  // ── Upload logic ─────────────────────────────────────────────────────────────
  const uploadFiles = useCallback(
    async (fileList: FileList) => {
      const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
      const newItems: UploadItem[] = Array.from(fileList).map((f) => ({
        id: `${f.name}-${Date.now()}-${Math.random()}`,
        name: f.name,
        progress: 0,
        status: "uploading" as const,
      }));
      setUploads((prev) => [...prev, ...newItems]);

      await Promise.all(
        Array.from(fileList).map(async (file, idx) => {
          const itemId = newItems[idx].id;

          if (file.size > MAX_SIZE) {
            setUploads((prev) =>
              prev.map((u) =>
                u.id === itemId ? { ...u, status: "error", error: "File exceeds 50 MB" } : u
              )
            );
            toast.error(`${file.name} exceeds the 50 MB limit.`);
            return;
          }

          try {
            // Step 1: get presigned PUT URL from backend
            const { uploadUrl, fileKey } = await requestUpload.mutateAsync({
              fileName: file.name,
              mimeType: file.type || "application/octet-stream",
              sizeBytes: file.size,
            });

            // Step 2: PUT directly to MinIO/S3
            const xhr = new XMLHttpRequest();
            await new Promise<void>((resolve, reject) => {
              xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                  const pct = Math.round((e.loaded / e.total) * 90);
                  setUploads((prev) =>
                    prev.map((u) => (u.id === itemId ? { ...u, progress: pct } : u))
                  );
                }
              };
              xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)));
              xhr.onerror = () => reject(new Error("Network error"));
              xhr.open("PUT", uploadUrl);
              xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
              xhr.send(file);
            });

            // Step 3: confirm upload in DB
            await confirmUpload.mutateAsync({
              fileKey,
              fileName: file.name,
              mimeType: file.type || "application/octet-stream",
              sizeBytes: file.size,
            });

            setUploads((prev) =>
              prev.map((u) => (u.id === itemId ? { ...u, progress: 100, status: "done" } : u))
            );
            toast.success(`${file.name} uploaded.`);
          } catch (err: any) {
            setUploads((prev) =>
              prev.map((u) =>
                u.id === itemId ? { ...u, status: "error", error: err.message } : u
              )
            );
            toast.error(`Failed to upload ${file.name}: ${err.message}`);
          }
        })
      );

      // Clear done items after 3s
      setTimeout(() => {
        setUploads((prev) => prev.filter((u) => u.status !== "done"));
      }, 3000);
    },
    [requestUpload, confirmUpload]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) uploadFiles(e.target.files);
    e.target.value = "";
  };

  // Drag-and-drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  };

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-primary/10 p-2">
            <FolderOpen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">My Files</h1>
            <p className="text-sm text-muted-foreground">
              Securely store and manage your documents in MinIO/S3
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => utils.fileManager.list.invalidate()}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
            <Upload className="h-3.5 w-3.5" />
            Upload Files
          </Button>
        </div>
      </div>

      {/* ── Drop zone ──────────────────────────────────────────────────────── */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/30"
        }`}
      >
        <CloudUpload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm font-medium">Drop files here or click to browse</p>
        <p className="text-xs text-muted-foreground mt-1">
          Any file type — max 50 MB per file
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />
      </div>

      {/* ── Upload progress ─────────────────────────────────────────────────── */}
      {uploads.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Uploading…</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {uploads.map((u) => (
              <div key={u.id} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate max-w-xs font-medium">{u.name}</span>
                  {u.status === "error" ? (
                    <Badge variant="destructive" className="text-xs">{u.error ?? "Error"}</Badge>
                  ) : u.status === "done" ? (
                    <Badge variant="default" className="text-xs">Done</Badge>
                  ) : (
                    <span className="text-muted-foreground">{u.progress}%</span>
                  )}
                </div>
                <Progress
                  value={u.progress}
                  className={`h-1.5 ${u.status === "error" ? "bg-destructive/20" : ""}`}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── File list ──────────────────────────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Stored Files
            {listData && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {listData.total}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : files.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <FolderOpen className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No files uploaded yet.</p>
              <p className="text-xs mt-1">Upload your first file using the drop zone above.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell>
                        <FileIcon mimeType={f.mimeType} />
                      </TableCell>
                      <TableCell className="font-medium max-w-xs truncate">
                        {f.fileName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs font-mono">
                          {f.mimeType?.split("/")[1] ?? "unknown"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {formatBytes(f.sizeBytes ?? 0)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(f.uploadedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Download"
                            disabled={downloadingId === f.id}
                            onClick={() => handleDownload(f.id, f.fileName)}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            title="Delete"
                            onClick={() => setDeleteTarget({ id: f.id, name: f.fileName })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Delete confirmation dialog ──────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> will be permanently removed from storage.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) deleteFile.mutate({ fileId: deleteTarget.id });
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
