/**
 * Cooperative Admin Dashboard
 * Dedicated view for cooperative administrators showing:
 *  - Aggregate member KYC stats (total, pending, approved, rejected)
 *  - Paginated member list with status filters
 *  - Bulk upload history with per-upload breakdowns
 */
import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users,
  CheckCircle2,
  Clock,
  XCircle,
  Upload,
  Trash2,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  BarChart3,
  AlertCircle,
  Download,
  Sprout,
  Shield,
  ThumbsUp,
  ThumbsDown,
  Clock3,
  ClipboardList,
  User,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { PageSkeleton } from "@/components/PageSkeleton";

// ─── KYC status badge ─────────────────────────────────────────────────────────
function KycBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    PENDING:      { label: "Pending",      variant: "secondary" },
    UNDER_REVIEW: { label: "Under Review", variant: "secondary" },
    APPROVED:     { label: "Approved",     variant: "default" },
    REJECTED:     { label: "Rejected",     variant: "destructive" },
  };
  const { label, variant } = map[status] ?? { label: status, variant: "outline" };
  return <Badge variant={variant}>{label}</Badge>;
}

// ─── Upload status badge ──────────────────────────────────────────────────────
function UploadBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    COMPLETED:  { label: "Completed",  variant: "default" },
    PROCESSING: { label: "Processing", variant: "secondary" },
    PARTIAL:    { label: "Partial",    variant: "outline" },
    FAILED:     { label: "Failed",     variant: "destructive" },
  };
  const { label, variant } = map[status] ?? { label: status, variant: "outline" };
  return <Badge variant={variant}>{label}</Badge>;
}

// ─── Stats cards ─────────────────────────────────────────────────────────────
function StatsCards({ stats }: { stats: {
  totalUploads: number;
  totalMembers: number;
  pendingMembers: number;
  approvedMembers: number;
  rejectedMembers: number;
} }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <Card className="bg-muted/30">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Upload className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Uploads</span>
          </div>
          <p className="text-2xl font-bold">{stats.totalUploads}</p>
        </CardContent>
      </Card>
      <Card className="bg-muted/30">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Total Members</span>
          </div>
          <p className="text-2xl font-bold">{stats.totalMembers}</p>
        </CardContent>
      </Card>
      <Card className="bg-amber-500/10 border-amber-500/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="h-4 w-4 text-amber-500" />
            <span className="text-xs text-muted-foreground">Pending KYC</span>
          </div>
          <p className="text-2xl font-bold text-amber-500">{stats.pendingMembers}</p>
        </CardContent>
      </Card>
      <Card className="bg-emerald-500/10 border-emerald-500/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span className="text-xs text-muted-foreground">Approved</span>
          </div>
          <p className="text-2xl font-bold text-emerald-500">{stats.approvedMembers}</p>
        </CardContent>
      </Card>
      <Card className="bg-red-500/10 border-red-500/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="h-4 w-4 text-red-500" />
            <span className="text-xs text-muted-foreground">Rejected</span>
          </div>
          <p className="text-2xl font-bold text-red-500">{stats.rejectedMembers}</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Member list tab ──────────────────────────────────────────────────────────
function MemberListTab() {
  const [statusFilter, setStatusFilter] = useState<"PENDING" | "APPROVED" | "REJECTED" | "ALL">("ALL");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // Bulk reject state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkRejectDialogOpen, setBulkRejectDialogOpen] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState("");

  const utils = trpc.useUtils();

  const approveMutation = trpc.cooperative.approveMember.useMutation({
    onSuccess: () => {
      toast.success("Member approved — KYC status set to VERIFIED.");
      utils.cooperative.memberList.invalidate();
      utils.cooperative.myStats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const bulkRejectMutation = trpc.cooperative.bulkRejectSelected.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.rejected} member${data.rejected !== 1 ? "s" : ""} rejected${data.skipped > 0 ? ` (${data.skipped} skipped)` : ""}.`);
      setBulkRejectDialogOpen(false);
      setBulkRejectReason("");
      setSelectedIds(new Set());
      utils.cooperative.memberList.invalidate();
      utils.cooperative.myStats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const rejectMutation = trpc.cooperative.rejectMember.useMutation({
    onSuccess: () => {
      toast.success("Member rejected — notification sent.");
      setRejectDialogOpen(false);
      setRejectTargetId(null);
      setRejectReason("");
      utils.cooperative.memberList.invalidate();
      utils.cooperative.myStats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const { data, isLoading } = trpc.cooperative.memberList.useQuery({
    status: statusFilter,
    page,
    pageSize: PAGE_SIZE,
  });

  return (
    <>
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Select
            value={statusFilter}
            onValueChange={v => { setStatusFilter(v as typeof statusFilter); setPage(1); setSelectedIds(new Set()); }}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
            </SelectContent>
          </Select>
          {data && (
            <span className="text-sm text-muted-foreground">
              {data.total} member{data.total !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        {selectedIds.size > 0 && (
          <Button
            variant="destructive"
            size="sm"
            className="gap-1.5"
            onClick={() => setBulkRejectDialogOpen(true)}
          >
            <XCircle className="w-3.5 h-3.5" />
            Reject Selected ({selectedIds.size})
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-500 mr-2" />
          Loading members…
        </div>
      )}

      {!isLoading && data?.members.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
          <Users className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">No members found for this filter.</p>
        </div>
      )}

      {data && data.members.length > 0 && (
        <>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      className="rounded border-border"
                      checked={data.members.filter(m => ["PENDING", "UNDER_REVIEW"].includes(m.status)).length > 0 &&
                        data.members.filter(m => ["PENDING", "UNDER_REVIEW"].includes(m.status)).every(m => selectedIds.has(m.id))}
                      onChange={e => {
                        const eligibleIds = data.members
                          .filter(m => ["PENDING", "UNDER_REVIEW"].includes(m.status))
                          .map(m => m.id);
                        if (e.target.checked) {
                          setSelectedIds(prev => new Set([...prev, ...eligibleIds]));
                        } else {
                          setSelectedIds(prev => {
                            const next = new Set(prev);
                            eligibleIds.forEach(id => next.delete(id));
                            return next;
                          });
                        }
                      }}
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Phone</TableHead>
                  <TableHead className="hidden md:table-cell">State / LGA</TableHead>
                  <TableHead>KYC Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Submitted</TableHead>
                  <TableHead className="hidden lg:table-cell">Reviewed</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.members.map(m => (
                  <TableRow key={m.id} className={selectedIds.has(m.id) ? "bg-muted/40" : ""}>
                    <TableCell>
                      {["PENDING", "UNDER_REVIEW"].includes(m.status) && (
                        <input
                          type="checkbox"
                          className="rounded border-border"
                          checked={selectedIds.has(m.id)}
                          onChange={e => {
                            setSelectedIds(prev => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(m.id); else next.delete(m.id);
                              return next;
                            });
                          }}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{m.fullName}</p>
                        {m.userEmail && (
                          <p className="text-xs text-muted-foreground">{m.userEmail}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">
                      {m.phone ?? "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm">
                      {m.state ? `${m.state}${m.lga ? ` / ${m.lga}` : ""}` : "—"}
                    </TableCell>
                    <TableCell>
                      <KycBadge status={m.status} />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                      {new Date(m.submittedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                      {m.reviewedAt ? new Date(m.reviewedAt).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell>
                      {["PENDING", "UNDER_REVIEW"].includes(m.status) && (
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                            disabled={approveMutation.isPending}
                            onClick={() => approveMutation.mutate({ kycQueueId: m.id })}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 text-xs"
                            onClick={() => { setRejectTargetId(m.id); setRejectDialogOpen(true); }}
                          >
                            Reject
                          </Button>
                        </div>
                      )}
                      {m.status === "APPROVED" && (
                        <span className="text-xs text-green-500 font-medium">Approved</span>
                      )}
                      {m.status === "REJECTED" && (
                        <span className="text-xs text-destructive font-medium">Rejected</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Page {data.page} of {data.totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
         </>
      )}
    </div>

    {/* Bulk reject dialog */}
    {bulkRejectDialogOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-background rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
          <h3 className="font-semibold text-lg">Bulk Reject {selectedIds.size} Member{selectedIds.size !== 1 ? "s" : ""}</h3>
          <p className="text-sm text-muted-foreground">Provide a shared rejection reason. This will be sent to all selected members.</p>
          <textarea
            className="w-full border border-border rounded-lg p-3 text-sm bg-background resize-none"
            rows={4}
            placeholder="Reason for rejection (min 10 characters)…"
            value={bulkRejectReason}
            onChange={e => setBulkRejectReason(e.target.value)}
          />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => { setBulkRejectDialogOpen(false); setBulkRejectReason(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={bulkRejectReason.length < 10 || bulkRejectMutation.isPending}
              onClick={() => bulkRejectMutation.mutate({ kycQueueIds: Array.from(selectedIds), reason: bulkRejectReason })}
            >
              {bulkRejectMutation.isPending ? "Rejecting…" : `Reject ${selectedIds.size} Member${selectedIds.size !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </div>
      </div>
    )}

    {/* Reject reason dialog */}
    {rejectDialogOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-background rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
          <h3 className="font-semibold text-lg">Reject KYC Application</h3>
          <p className="text-sm text-muted-foreground">Provide a reason for rejection. This will be sent to the member.</p>
          <textarea
            className="w-full border border-border rounded-lg p-3 text-sm bg-background resize-none"
            rows={4}
            placeholder="Reason for rejection (min 10 characters)…"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
          />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => { setRejectDialogOpen(false); setRejectReason(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={rejectReason.length < 10 || rejectMutation.isPending}
              onClick={() => rejectTargetId && rejectMutation.mutate({ kycQueueId: rejectTargetId, reason: rejectReason })}
            >
              {rejectMutation.isPending ? "Rejecting…" : "Confirm Rejection"}
            </Button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// ─── Upload history tabb ───────────────────────────────────────────────────────
function UploadHistoryTab() {
  const [offset, setOffset] = useState(0);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const LIMIT = 10;
  const utils = trpc.useUtils();

  const retryMutation = trpc.cooperative.retryUpload.useMutation({
    onSuccess: (result) => {
      toast.success(`Retry complete: ${result.successRows} succeeded, ${result.failedRows} failed`);
      utils.cooperative.uploadHistory.invalidate();
      setRetryingId(null);
    },
    onError: (err) => {
      toast.error(err.message);
      setRetryingId(null);
    },
  });

  const { data, isLoading } = trpc.cooperative.uploadHistory.useQuery({
    limit: LIMIT,
    offset,
  });

  return (
    <div className="space-y-4">
      {isLoading && (
        <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-500 mr-2" />
          Loading uploads…
        </div>
      )}

      {!isLoading && data?.uploads.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
          <FileSpreadsheet className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">No bulk uploads yet.</p>
          <Button variant="outline" asChild>
            <Link href="/onboarding">Upload CSV</Link>
          </Button>
        </div>
      )}

      {data && data.uploads.length > 0 && (
        <>
          <div className="space-y-3">
            {data.uploads.map(u => (
              <Card key={u.id} className="hover:bg-muted/20 transition-colors">
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                        <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{u.fileName}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(u.createdAt).toLocaleString()}
                          {u.completedAt && ` · Completed ${new Date(u.completedAt).toLocaleString()}`}
                        </p>
                      </div>
                    </div>
                    <UploadBadge status={u.status} />
                  </div>

                  {/* Per-upload member breakdown */}
                  <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                    <div className="rounded bg-muted/40 p-2">
                      <p className="text-lg font-bold">{u.totalRows}</p>
                      <p className="text-xs text-muted-foreground">Total</p>
                    </div>
                    <div className="rounded bg-emerald-500/10 p-2">
                      <p className="text-lg font-bold text-emerald-500">{u.approvedCount}</p>
                      <p className="text-xs text-muted-foreground">Approved</p>
                    </div>
                    <div className="rounded bg-amber-500/10 p-2">
                      <p className="text-lg font-bold text-amber-500">{u.pendingCount}</p>
                      <p className="text-xs text-muted-foreground">Pending</p>
                    </div>
                    <div className="rounded bg-red-500/10 p-2">
                      <p className="text-lg font-bold text-red-500">{u.rejectedCount}</p>
                      <p className="text-xs text-muted-foreground">Rejected</p>
                    </div>
                  </div>

                  {/* Progress bar */}
                  {u.totalRows > 0 && (
                    <div className="mt-2">
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 transition-all"
                          style={{ width: `${Math.round((u.approvedCount / u.totalRows) * 100)}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 text-right">
                        {Math.round((u.approvedCount / u.totalRows) * 100)}% approved
                      </p>
                    </div>
                  )}

                  {/* Review link */}
                  <div className="mt-2 flex gap-2 flex-wrap">
                    {u.pendingCount > 0 && (
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/admin/bulk-kyc?uploadId=${u.id}`}>
                          Review {u.pendingCount} pending
                        </Link>
                      </Button>
                    )}
                    {['FAILED', 'PARTIAL'].includes(u.status) && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={retryingId === u.id || retryMutation.isPending}
                        onClick={() => {
                          setRetryingId(u.id);
                          retryMutation.mutate({ uploadId: u.id });
                        }}
                        className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                      >
                        {retryingId === u.id ? (
                          <><span className="animate-spin mr-1">↻</span> Retrying…</>
                        ) : (
                          <>↻ Retry Failed Rows</>
                        )}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {data.total} upload{data.total !== 1 ? "s" : ""} total
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(o => Math.max(0, o - LIMIT))}
              >
                <ChevronLeft className="h-4 w-4" />
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + LIMIT >= data.total}
                onClick={() => setOffset(o => o + LIMIT)}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Bulk Crop Listing Tab ───────────────────────────────────────────────────
function BulkCropListingTab() {
  const utils = trpc.useUtils();
  const { data: historyData } = trpc.cooperative.uploadHistory.useQuery({ limit: 50, offset: 0 });
  const uploads = historyData?.uploads ?? [];
  const completedUploads = uploads.filter(u => u.status === "COMPLETED" || u.status === "PARTIAL");

  const [selectedUploadId, setSelectedUploadId] = useState<number | "">("");
  const [historyUploadId, setHistoryUploadId] = useState<number | undefined>(undefined);
  const [historyOffset, setHistoryOffset] = useState(0);
  const HISTORY_LIMIT = 20;

  const { data: listingHistory, isLoading: historyLoading } = trpc.cooperative.listBulkCropListings.useQuery(
    { uploadId: historyUploadId, limit: HISTORY_LIMIT, offset: historyOffset },
  );

  const [form, setForm] = useState({
    cropType: "",
    variety: "",
    quantityKgPerMember: "",
    askingPricePerKg: "",
    expectedHarvestDate: "",
    description: "",
  });

  const [cancelConfirmId, setCancelConfirmId] = useState<number | null>(null);
  const [reactivateConfirmId, setReactivateConfirmId] = useState<number | null>(null);

  const cancelMutation = trpc.cooperative.cancelBulkListing.useMutation({
    onSuccess: () => {
      toast.success("Listing withdrawn successfully");
      setCancelConfirmId(null);
      utils.cooperative.listBulkCropListings.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const reactivateMutation = trpc.cooperative.reactivateBulkListing.useMutation({
    onSuccess: () => {
      toast.success("Listing re-activated successfully");
      setReactivateConfirmId(null);
      utils.cooperative.listBulkCropListings.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const bulkListMutation = trpc.cooperative.bulkCropListing.useMutation({
    onSuccess: (res) => {
      toast.success(`Created ${res.created} listings (${res.skipped} skipped — no farm or KYC not approved)`);
      utils.cooperative.uploadHistory.invalidate();
      utils.cooperative.listBulkCropListings.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedUploadId) { toast.error("Select an upload batch"); return; }
    if (!form.cropType || !form.quantityKgPerMember || !form.askingPricePerKg || !form.expectedHarvestDate) {
      toast.error("Please fill in all required fields"); return;
    }
    bulkListMutation.mutate({
      uploadId: Number(selectedUploadId),
      cropType: form.cropType,
      variety: form.variety || undefined,
      quantityKgPerMember: Number(form.quantityKgPerMember),
      askingPricePerKg: Number(form.askingPricePerKg),
      expectedHarvestDate: form.expectedHarvestDate,
      description: form.description || undefined,
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sprout className="h-4 w-4 text-emerald-500" />
            Create Bulk Crop Listings
          </CardTitle>
          <CardDescription>
            Create crop listings on behalf of all approved members in a cooperative upload batch.
            Each approved member with a registered farm will get one listing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Upload Batch <span className="text-red-500">*</span></Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selectedUploadId}
                onChange={e => setSelectedUploadId(e.target.value === "" ? "" : Number(e.target.value))}
              >
                <option value="">Select a completed upload batch…</option>
                {completedUploads.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.fileName} — {u.approvedCount} approved members ({new Date(u.createdAt).toLocaleDateString()})
                  </option>
                ))}
              </select>
              {completedUploads.length === 0 && (
                <p className="text-xs text-muted-foreground">No completed upload batches found. Upload and approve members first.</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Crop Type <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="e.g. Maize, Soybean, Rice"
                  value={form.cropType}
                  onChange={e => setForm(f => ({ ...f, cropType: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Variety (optional)</Label>
                <Input
                  placeholder="e.g. Yellow Maize, Ofada Rice"
                  value={form.variety}
                  onChange={e => setForm(f => ({ ...f, variety: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Quantity per Member (kg) <span className="text-red-500">*</span></Label>
                <Input
                  type="number"
                  min="1"
                  step="0.01"
                  placeholder="e.g. 500"
                  value={form.quantityKgPerMember}
                  onChange={e => setForm(f => ({ ...f, quantityKgPerMember: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Asking Price per kg (NGN) <span className="text-red-500">*</span></Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="e.g. 450.00"
                  value={form.askingPricePerKg}
                  onChange={e => setForm(f => ({ ...f, askingPricePerKg: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Expected Harvest Date <span className="text-red-500">*</span></Label>
                <Input
                  type="date"
                  value={form.expectedHarvestDate}
                  onChange={e => setForm(f => ({ ...f, expectedHarvestDate: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Description (optional)</Label>
              <Textarea
                placeholder="Additional details about this cooperative listing…"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
              />
            </div>

            <Button
              type="submit"
              disabled={bulkListMutation.isPending || !selectedUploadId}
              className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500"
            >
              {bulkListMutation.isPending ? "Creating Listings…" : "Create Bulk Listings"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* ── Bulk Listing History ── */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                Bulk Listing History
              </CardTitle>
              <CardDescription className="mt-0.5">
                All crop listings created via cooperative bulk action.
              </CardDescription>
            </div>
            <select
              className="rounded-md border border-input bg-background px-2 py-1.5 text-xs w-full sm:w-auto"
              value={historyUploadId ?? ""}
              onChange={e => {
                setHistoryUploadId(e.target.value === "" ? undefined : Number(e.target.value));
                setHistoryOffset(0);
              }}
            >
              <option value="">All batches</option>
              {completedUploads.map(u => (
                <option key={u.id} value={u.id}>{u.fileName}</option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {historyLoading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-500 mr-2" />
              Loading history…
            </div>
          )}
          {!historyLoading && (listingHistory?.listings.length ?? 0) === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
              <Sprout className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No bulk listings created yet.</p>
            </div>
          )}
          {!historyLoading && (listingHistory?.listings.length ?? 0) > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Crop</th>
                      <th className="px-4 py-2.5 text-right font-medium text-muted-foreground text-xs">Qty (kg)</th>
                      <th className="px-4 py-2.5 text-right font-medium text-muted-foreground text-xs">Price/kg</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Harvest Date</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Status</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Created</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listingHistory!.listings.map(l => (
                      <tr key={l.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5">
                          <p className="font-medium">{l.cropType}</p>
                          {l.variety && <p className="text-xs text-muted-foreground">{l.variety}</p>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {Number(l.quantityKg).toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {l.currency} {Number(l.askingPricePerKg).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">
                          {l.expectedHarvestDate ? new Date(l.expectedHarvestDate).toLocaleDateString() : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            l.status === "ACTIVE" ? "bg-emerald-500/15 text-emerald-400" :
                            l.status === "SOLD" ? "bg-blue-500/15 text-blue-400" :
                            l.status === "EXPIRED" ? "bg-amber-500/15 text-amber-400" :
                            "bg-muted text-muted-foreground"
                          }`}>{l.status}</span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {new Date(l.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2.5">
                          {l.status === "ACTIVE" && (
                            cancelConfirmId === l.id ? (
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-6 text-xs px-2"
                                  disabled={cancelMutation.isPending}
                                  onClick={() => cancelMutation.mutate({ listingId: l.id })}
                                >
                                  {cancelMutation.isPending ? "…" : "Confirm"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-xs px-2"
                                  onClick={() => setCancelConfirmId(null)}
                                >
                                  No
                                </Button>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs px-2 text-destructive hover:text-destructive"
                                onClick={() => setCancelConfirmId(l.id)}
                              >
                                Withdraw
                              </Button>
                            )
                          )}
                          {l.status === "WITHDRAWN" && (
                            reactivateConfirmId === l.id ? (
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="default"
                                  className="h-6 text-xs px-2 bg-emerald-600 hover:bg-emerald-700"
                                  disabled={reactivateMutation.isPending}
                                  onClick={() => reactivateMutation.mutate({ listingId: l.id })}
                                >
                                  {reactivateMutation.isPending ? "…" : "Confirm"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-xs px-2"
                                  onClick={() => setReactivateConfirmId(null)}
                                >
                                  No
                                </Button>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs px-2 text-emerald-600 hover:text-emerald-500"
                                onClick={() => setReactivateConfirmId(l.id)}
                              >
                                Re-activate
                              </Button>
                            )
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  {listingHistory!.total} listing{listingHistory!.total !== 1 ? "s" : ""} total
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline" size="sm"
                    disabled={historyOffset === 0}
                    onClick={() => setHistoryOffset(o => Math.max(0, o - HISTORY_LIMIT))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Prev
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    disabled={historyOffset + HISTORY_LIMIT >= listingHistory!.total}
                    onClick={() => setHistoryOffset(o => o + HISTORY_LIMIT)}
                  >
                    Next <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Dual-Authorization tab ──────────────────────────────────────────────────
function DualAuthTab() {
  const utils = trpc.useUtils();
  const [view, setView] = useState<"all" | "mine" | "pending_countersign">("pending_countersign");
  const [counterSignNotes, setCounterSignNotes] = useState<Record<number, string>>({});

  const { data, isLoading } = trpc.cooperative.listBulkListingApprovals.useQuery({ view, page: 1, pageSize: 50 });

  const countersignMutation = trpc.cooperative.countersignBulkListing.useMutation({
    onSuccess: (updated) => {
      toast.success(updated.status === "COUNTERSIGNED" ? "Bulk listing countersigned and executed!" : "Bulk listing request rejected.");
      utils.cooperative.listBulkListingApprovals.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  function statusBadge(status: string) {
    const map: Record<string, { label: string; className: string }> = {
      PENDING:       { label: "Pending",       className: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
      COUNTERSIGNED: { label: "Approved",      className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
      REJECTED:      { label: "Rejected",      className: "bg-red-500/20 text-red-400 border-red-500/30" },
      EXPIRED:       { label: "Expired",       className: "bg-muted/40 text-muted-foreground border-border" },
    };
    const { label, className } = map[status] ?? { label: status, className: "bg-muted/40 text-muted-foreground border-border" };
    return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${className}`}>{label}</span>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground flex-1">
          Bulk listings above the threshold (50+ members or ₦10M+ value) require a second admin to countersign before execution.
        </p>
        <div className="flex gap-1">
          {(["pending_countersign", "mine", "all"] as const).map(v => (
            <Button
              key={v}
              size="sm"
              variant={view === v ? "default" : "outline"}
              onClick={() => setView(v)}
              className="text-xs"
            >
              {v === "pending_countersign" ? "Needs My Signature" : v === "mine" ? "My Requests" : "All"}
            </Button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-500 mr-2" />
          Loading approvals…
        </div>
      )}

      {!isLoading && (!data || data.approvals.length === 0) && (
        <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
          <Shield className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">
            {view === "pending_countersign" ? "No pending approvals awaiting your signature." :
             view === "mine" ? "You have not submitted any dual-auth requests." :
             "No dual-auth records found."}
          </p>
        </div>
      )}

      {data && data.approvals.length > 0 && (
        <div className="space-y-3">
          {data.approvals.map(a => (
            <Card key={a.id} className="border-border">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-sm">{a.cropType}</p>
                    <p className="text-xs text-muted-foreground">
                      Upload #{a.uploadId} · {a.memberCount} members · {a.totalQuantityKg.toLocaleString()} kg · ₦{a.pricePerKg.toLocaleString()}/kg
                    </p>
                    {a.description && <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>}
                  </div>
                  <div className="flex-shrink-0">{statusBadge(a.status)}</div>
                </div>

                {a.initiatorNotes && (
                  <div className="bg-muted/20 rounded p-2 text-xs text-muted-foreground">
                    <span className="font-medium">Initiator notes:</span> {a.initiatorNotes}
                  </div>
                )}

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" />
                  <span>Expires {new Date(a.expiresAt).toLocaleString()}</span>
                </div>

                {a.status === "PENDING" && (
                  <div className="space-y-2 pt-1 border-t border-border">
                    <Textarea
                      placeholder="Optional countersigner notes…"
                      value={counterSignNotes[a.id] ?? ""}
                      onChange={e => setCounterSignNotes(prev => ({ ...prev, [a.id]: e.target.value }))}
                      className="text-xs min-h-[60px]"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white"
                        disabled={countersignMutation.isPending}
                        onClick={() => countersignMutation.mutate({
                          approvalId: a.id,
                          decision: "COUNTERSIGNED",
                          counterSignerNotes: counterSignNotes[a.id] || undefined,
                        })}
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                        Countersign & Execute
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="gap-1.5"
                        disabled={countersignMutation.isPending}
                        onClick={() => countersignMutation.mutate({
                          approvalId: a.id,
                          decision: "REJECTED",
                          counterSignerNotes: counterSignNotes[a.id] || undefined,
                        })}
                      >
                        <ThumbsDown className="h-3.5 w-3.5" />
                        Reject
                      </Button>
                    </div>
                  </div>
                )}

                {a.counterSignerNotes && a.status !== "PENDING" && (
                  <div className="bg-muted/20 rounded p-2 text-xs text-muted-foreground">
                    <span className="font-medium">Countersigner notes:</span> {a.counterSignerNotes}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Dual-Auth Audit Trail tab ───────────────────────────────────────────────
function DualAuthAuditTab() {
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 30;
  const { data, isLoading } = trpc.kycAnalysis.listDualAuthAuditTrail.useQuery(
    { page, pageSize: PAGE_SIZE },
  );

  const records = data?.entries ?? [];
  const total = data?.total ?? 0;

  const statusColor: Record<string, string> = {
    PENDING:    "text-amber-500",
    APPROVED:   "text-emerald-500",
    REJECTED:   "text-red-500",
    EXPIRED:    "text-muted-foreground",
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" />
          Dual-Authorization Audit Trail
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Read-only log of all dual-auth approval requests — who requested, who countersigned, and the outcome.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-500 mr-2" />
          Loading audit trail…
        </div>
      )}

      {!isLoading && records.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
          <ClipboardList className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground text-sm">No dual-auth records found.</p>
        </div>
      )}

      {!isLoading && records.length > 0 && (
        <>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request ID</TableHead>
                  <TableHead>Requester</TableHead>
                  <TableHead>Countersigner</TableHead>
                  <TableHead>Listings</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Requested At</TableHead>
                  <TableHead>Resolved At</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">#{r.id}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <User className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs">{r.initiatorName ?? `#${r.cooperativeUserId}`}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {r.counterSignerId ? (
                        <div className="flex items-center gap-1.5">
                          <User className="h-3 w-3 text-emerald-500" />
                          <span className="text-xs">{r.counterSignerName ?? `#${r.counterSignerId}`}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{r.memberCount ?? 0} members</TableCell>
                    <TableCell>
                      <span className={`text-xs font-semibold ${statusColor[r.status] ?? "text-muted-foreground"}`}>
                        {r.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.updatedAt
                        ? new Date(r.updatedAt).toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell className="max-w-[160px]">
                      <p className="text-xs text-muted-foreground truncate" title={r.initiatorNotes ?? r.counterSignerNotes ?? ""}>
                        {r.initiatorNotes || r.counterSignerNotes || "—"}
                      </p>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {Math.ceil(total / PAGE_SIZE)}
              </span>
              <Button variant="outline" size="sm" disabled={page >= Math.ceil(total / PAGE_SIZE)} onClick={() => setPage(p => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Recent activity tab ───────────────────────────────────────────────────────
function RecentActivityTab({ activity }: { activity: Array<{
  uploadId: number;
  fileName: string;
  uploadedAt: Date;
  totalRows: number;
  successRows: number;
  failedRows: number;
  status: string;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
}> }) {
  if (activity.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
        <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-muted-foreground">No recent activity.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activity.map(a => (
        <div
          key={a.uploadId}
          className="flex items-center gap-4 rounded-lg border border-border p-3 hover:bg-muted/20 transition-colors"
        >
          <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
            <Upload className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{a.fileName}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(a.uploadedAt).toLocaleDateString()} · {a.totalRows} rows
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 text-xs">
            <span className="text-emerald-500 font-semibold">{a.approvedCount}✓</span>
            <span className="text-amber-500">{a.pendingCount}⏳</span>
            {a.rejectedCount > 0 && (
              <span className="text-red-500">{a.rejectedCount}✗</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function CooperativeDashboard() {
  const { isAuthenticated, loading, user } = useAuth();

  const { data: stats, isLoading: statsLoading } = trpc.cooperative.myStats.useQuery(
    undefined,
    { enabled: isAuthenticated && user?.role === "admin" },
  );

  const [isExporting, setIsExporting] = useState(false);

  async function handleExportCsv() {
    setIsExporting(true);
    try {
      const res = await fetch("/api/cooperative/export-members", {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Export failed" }));
        toast.error(err.error ?? "Export failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nexcom-members-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Member list exported successfully");
    } catch {
      toast.error("Failed to export member list");
    } finally {
      setIsExporting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
        <Users className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Sign in to access the Cooperative Dashboard</h2>
        <Button asChild>
          <a href={getLoginUrl()}>Sign In</a>
        </Button>
      </div>
    );
  }

  if (user?.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
        <AlertCircle className="h-12 w-12 text-amber-500" />
        <h2 className="text-xl font-semibold">Admin Access Required</h2>
        <p className="text-muted-foreground max-w-sm">
          The Cooperative Dashboard is only accessible to NEXCOM administrators.
        </p>
        <Button variant="outline" asChild>
          <Link href="/">Go to Dashboard</Link>
        </Button>
      </div>
    );
  }

  if (statsLoading) return <PageSkeleton cards={4} tableRows={6} tableCols={4} showChart />;
  return (
    <div className="space-y-6 p-4 lg:p-6 max-w-6xl mx-auto">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-emerald-500" />
            Cooperative Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Aggregate KYC stats, member list, and bulk upload history
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={isExporting}
            className="gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            {isExporting ? "Exporting…" : "Export CSV"}
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/bulk-kyc">Bulk KYC Admin</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/onboarding">New Upload</Link>
          </Button>
        </div>
      </div>

      {/* ── Stats ── */}
      {statsLoading && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4 h-20 bg-muted/20 rounded" />
            </Card>
          ))}
        </div>
      )}
      {stats && <StatsCards stats={stats} />}

      {/* ── Tabs ── */}
      <Tabs defaultValue="members">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="members" className="flex items-center gap-1.5">
            <Users className="h-4 w-4" />
            Members
          </TabsTrigger>
          <TabsTrigger value="uploads" className="flex items-center gap-1.5">
            <FileSpreadsheet className="h-4 w-4" />
            Upload History
          </TabsTrigger>
          <TabsTrigger value="bulk-listing" className="flex items-center gap-1.5">
            <Sprout className="h-4 w-4" />
            Bulk Listing
          </TabsTrigger>
          <TabsTrigger value="dual-auth" className="flex items-center gap-1.5">
            <Shield className="h-4 w-4" />
            Dual-Auth
          </TabsTrigger>
          <TabsTrigger value="dual-auth-audit" className="flex items-center gap-1.5">
            <ClipboardList className="h-4 w-4" />
            Audit Trail
          </TabsTrigger>
          <TabsTrigger value="activity" className="flex items-center gap-1.5">
            <BarChart3 className="h-4 w-4" />
            Recent Activity
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-4">
          <MemberListTab />
        </TabsContent>

        <TabsContent value="uploads" className="mt-4">
          <UploadHistoryTab />
        </TabsContent>

        <TabsContent value="bulk-listing" className="mt-4">
          <BulkCropListingTab />
        </TabsContent>

        <TabsContent value="dual-auth" className="mt-4">
          <DualAuthTab />
        </TabsContent>
        <TabsContent value="dual-auth-audit" className="mt-4">
          <DualAuthAuditTab />
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          <RecentActivityTab activity={stats?.recentActivity ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
