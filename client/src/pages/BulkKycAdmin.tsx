/**
 * NEXCOM Exchange — Bulk KYC Admin Dashboard
 *
 * Admin-only page listing all cooperative bulk KYC uploads.
 * Features:
 *  - Upload list with status badges, row counts, uploader info
 *  - Status filter tabs (All / Processing / Completed / Partial / Failed)
 *  - Drill-down Sheet drawer showing member applications per upload
 *  - Per-member approve / reject / under-review actions (reuses adminReview)
 *  - Error log accordion per upload
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Users, FileText, CheckCircle2, XCircle, Clock, AlertCircle,
  RefreshCw, ChevronDown, ChevronRight, Eye, Shield,
} from "lucide-react";
import { getLoginUrl } from "@/const";
import { PageSkeleton } from "@/components/PageSkeleton";

// ─── Types ────────────────────────────────────────────────────────────────────
type UploadStatus = "PROCESSING" | "COMPLETED" | "PARTIAL" | "FAILED";
type MemberStatus = "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";

const STATUS_CONFIG: Record<UploadStatus, { label: string; color: string; dot: string }> = {
  PROCESSING: { label: "Processing", color: "text-blue-400 border-blue-400/30 bg-blue-500/10", dot: "bg-blue-400" },
  COMPLETED:  { label: "Completed",  color: "text-emerald-400 border-emerald-400/30 bg-emerald-500/10", dot: "bg-emerald-400" },
  PARTIAL:    { label: "Partial",    color: "text-amber-400 border-amber-400/30 bg-amber-500/10", dot: "bg-amber-400" },
  FAILED:     { label: "Failed",     color: "text-red-400 border-red-400/30 bg-red-500/10", dot: "bg-red-400" },
};

const MEMBER_STATUS_CONFIG: Record<MemberStatus, { label: string; color: string; icon: React.FC<{ className?: string }> }> = {
  PENDING:      { label: "Pending",      color: "text-yellow-400", icon: Clock },
  UNDER_REVIEW: { label: "Under Review", color: "text-blue-400",   icon: Eye },
  APPROVED:     { label: "Approved",     color: "text-emerald-400", icon: CheckCircle2 },
  REJECTED:     { label: "Rejected",     color: "text-red-400",    icon: XCircle },
};

// ─── Member Row ───────────────────────────────────────────────────────────────
function MemberRow({
  member,
  onDecision,
  isPending,
}: {
  member: {
    id: number;
    status: string;
    userName: string | null;
    userEmail: string | null;
    submittedAt: Date;
    reviewNotes: string | null;
    documents: unknown;
  };
  onDecision: (id: number, decision: "APPROVED" | "REJECTED" | "UNDER_REVIEW") => void;
  isPending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = MEMBER_STATUS_CONFIG[member.status as MemberStatus] ?? MEMBER_STATUS_CONFIG.PENDING;
  const StatusIcon = cfg.icon;

  // Extract name from documents JSON if userName is null (bulk upload users share the admin account)
  let displayName = member.userName ?? "—";
  let displayEmail = member.userEmail ?? "—";
  try {
    const docs = typeof member.documents === "string" ? JSON.parse(member.documents) : member.documents;
    if (docs?.personalInfo) {
      displayName = `${docs.personalInfo.firstName ?? ""} ${docs.personalInfo.lastName ?? ""}`.trim() || displayName;
      displayEmail = docs.personalInfo.email || displayEmail;
    }
  } catch { /* ignore */ }

  return (
    <div className="border border-white/10 rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/3 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <StatusIcon className={`w-4 h-4 flex-shrink-0 ${cfg.color}`} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white truncate">{displayName}</div>
          <div className="text-xs text-muted-foreground truncate">{displayEmail}</div>
        </div>
        <Badge variant="outline" className={`text-xs ${cfg.color}`}>{cfg.label}</Badge>
        <span className="text-xs text-gray-600">{new Date(member.submittedAt).toLocaleDateString()}</span>
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
      </div>

      {expanded && (
        <div className="border-t border-white/10 px-4 py-3 bg-white/2 space-y-3">
          {member.reviewNotes && (
            <p className="text-xs text-muted-foreground italic">Notes: {member.reviewNotes}</p>
          )}
          {member.status !== "APPROVED" && member.status !== "REJECTED" && (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => onDecision(member.id, "APPROVED")}
                disabled={isPending}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs h-7 px-3"
              >
                <CheckCircle2 className="w-3 h-3 mr-1" /> Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onDecision(member.id, "UNDER_REVIEW")}
                disabled={isPending}
                className="border-blue-400/30 text-blue-400 hover:bg-blue-500/10 text-xs h-7 px-3 bg-transparent"
              >
                <Eye className="w-3 h-3 mr-1" /> Review
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onDecision(member.id, "REJECTED")}
                disabled={isPending}
                className="border-red-400/30 text-red-400 hover:bg-red-500/10 text-xs h-7 px-3 bg-transparent"
              >
                <XCircle className="w-3 h-3 mr-1" /> Reject
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function BulkKycAdmin() {
  const { user, loading, isAuthenticated } = useAuth();
  const [statusFilter, setStatusFilter] = useState<UploadStatus | "ALL">("ALL");
  const [selectedUploadId, setSelectedUploadId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const utils = trpc.useUtils();

  const { data: uploads = [], isLoading: uploadsLoading, refetch } = trpc.onboarding.adminListBulkUploads.useQuery(
    { limit: 50, status: statusFilter === "ALL" ? undefined : statusFilter },
    { enabled: isAuthenticated && user?.role === "admin" }
  );

  const { data: memberData, isLoading: membersLoading } = trpc.onboarding.adminGetBulkUploadMembers.useQuery(
    { uploadId: selectedUploadId! },
    { enabled: !!selectedUploadId && drawerOpen }
  );

  const [rejectDialog, setRejectDialog] = useState<{ open: boolean; applicationId: number | null; notes: string }>({
    open: false, applicationId: null, notes: "",
  });

  const batchApproveMutation = trpc.onboarding.approveBatchPending.useMutation({
    onSuccess: (data) => {
      toast.success(`Batch approved ${data.approved} pending application${data.approved !== 1 ? "s" : ""} — farmers notified`);
      utils.onboarding.adminListBulkUploads.invalidate();
      utils.onboarding.adminGetBulkUploadMembers.invalidate();
    },
    onError: (err) => toast.error("Batch approve failed", { description: err.message }),
  });

  const reviewMutation = trpc.onboarding.adminReviewBulkMember.useMutation({
    onSuccess: (data) => {
      toast.success(
        `Application #${data.applicationId} ${data.status === "APPROVED" ? "approved \u2713" : "rejected"} \u2014 farmer notified`
      );
      utils.onboarding.adminGetBulkUploadMembers.invalidate({ uploadId: selectedUploadId! });
      utils.onboarding.adminListBulkUploads.invalidate();
      setRejectDialog({ open: false, applicationId: null, notes: "" });
    },
    onError: (err) => toast.error("Review failed", { description: err.message }),
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0f0a] flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#0a0f0a] flex items-center justify-center p-4">
        <div className="text-center">
          <Shield className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Sign In Required</h2>
          <a href={getLoginUrl()} className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-lg font-semibold transition-colors">
            Sign In <ChevronRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    );
  }

  if (user?.role !== "admin") {
    return (
      <div className="min-h-screen bg-[#0a0f0a] flex items-center justify-center p-4">
        <div className="text-center">
          <Shield className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Admin Access Required</h2>
          <p className="text-muted-foreground">This page is restricted to platform administrators.</p>
        </div>
      </div>
    );
  }

  const openDrawer = (uploadId: number) => {
    setSelectedUploadId(uploadId);
    setDrawerOpen(true);
  };

  return (
    <div className="min-h-screen bg-[#0a0f0a] text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#0d1410] px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-amber-400" />
              Cooperative Bulk KYC — Admin Dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Review and manage all cooperative bulk KYC uploads</p>
          </div>
          <div className="flex items-center gap-2">
            {selectedUploadId && (
              <Button
                size="sm"
                onClick={() => batchApproveMutation.mutate({ uploadId: selectedUploadId })}
                disabled={batchApproveMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2"
              >
                {batchApproveMutation.isPending ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                Approve All Pending
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="border-white/20 text-muted-foreground hover:text-white bg-transparent gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(["ALL", "COMPLETED", "PARTIAL", "FAILED"] as const).map(s => {
            const count = s === "ALL" ? uploads.length : uploads.filter(u => u.status === s).length;
            const cfg = s === "ALL" ? null : STATUS_CONFIG[s];
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-xl border px-4 py-3 text-left transition-all ${
                  statusFilter === s
                    ? "border-emerald-500/50 bg-emerald-500/10"
                    : "border-white/10 bg-white/5 hover:bg-white/8"
                }`}
              >
                <div className="text-2xl font-bold text-white">{count}</div>
                <div className={`text-xs mt-0.5 ${cfg ? cfg.color.split(" ")[0] : "text-muted-foreground"}`}>
                  {s === "ALL" ? "Total Uploads" : cfg!.label}
                </div>
              </button>
            );
          })}
        </div>

        {/* Filter */}
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v as UploadStatus | "ALL")}>
            <SelectTrigger className="w-44 bg-white/5 border-white/10 text-white text-sm h-8">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent className="bg-[#0d1410] border-white/10 text-white">
              <SelectItem value="ALL">All Statuses</SelectItem>
              <SelectItem value="PROCESSING">Processing</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
              <SelectItem value="PARTIAL">Partial</SelectItem>
              <SelectItem value="FAILED">Failed</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">{uploads.length} upload{uploads.length !== 1 ? "s" : ""}</span>
        </div>

        {/* Upload list */}
        {uploadsLoading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="w-6 h-6 text-emerald-400 animate-spin" />
          </div>
        ) : uploads.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No bulk uploads found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {uploads.map(upload => {
              const cfg = STATUS_CONFIG[upload.status as UploadStatus] ?? STATUS_CONFIG.PROCESSING;
              const successPct = upload.totalRows > 0
                ? Math.round((upload.successRows / upload.totalRows) * 100)
                : 0;
              return (
                <div
                  key={upload.id}
                  className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/7 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                        <span className="text-sm font-semibold text-white truncate">{upload.fileName}</span>
                        <Badge variant="outline" className={`text-xs ${cfg.color}`}>{cfg.label}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        <div>Uploaded by: <span className="text-muted-foreground">{upload.uploaderName ?? "Unknown"}</span> ({upload.uploaderEmail ?? "—"})</div>
                        <div>{new Date(upload.createdAt).toLocaleString()}</div>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openDrawer(upload.id)}
                      className="border-white/20 text-muted-foreground hover:text-white bg-transparent gap-1.5 text-xs flex-shrink-0"
                    >
                      <Eye className="w-3.5 h-3.5" /> View Members
                    </Button>
                  </div>

                  {/* Progress bar */}
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>{upload.successRows} / {upload.totalRows} processed</span>
                      <span>{successPct}%</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          upload.failedRows > 0 ? "bg-amber-500" : "bg-emerald-500"
                        }`}
                        style={{ width: `${successPct}%` }}
                      />
                    </div>
                    {upload.failedRows > 0 && (
                      <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> {upload.failedRows} row{upload.failedRows !== 1 ? "s" : ""} failed
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Member Drill-down Drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-xl bg-[#0d1410] border-white/10 text-white overflow-y-auto"
        >
          <SheetHeader className="mb-4">
            <SheetTitle className="text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-amber-400" />
              Member Applications
            </SheetTitle>
            <SheetDescription className="text-muted-foreground">
              {memberData?.upload?.fileName ?? "Loading…"} — {memberData?.members.length ?? 0} member{(memberData?.members.length ?? 0) !== 1 ? "s" : ""}
            </SheetDescription>
          </SheetHeader>

          {membersLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 text-emerald-400 animate-spin" />
            </div>
          ) : !memberData || memberData.members.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No member applications found for this upload</p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Summary badges */}
              <div className="flex gap-2 flex-wrap mb-4">
                {(["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"] as MemberStatus[]).map(s => {
                  const count = memberData.members.filter(m => m.status === s).length;
                  if (count === 0) return null;
                  const cfg = MEMBER_STATUS_CONFIG[s];
  if (uploadsLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={5} />;
                  return (
                    <Badge key={s} variant="outline" className={`text-xs ${cfg.color}`}>
                      {count} {cfg.label}
                    </Badge>
                  );
                })}
              </div>

              {memberData.members.map(member => (
                <MemberRow
                  key={member.id}
                  member={{
                    ...member,
                    submittedAt: member.submittedAt instanceof Date ? member.submittedAt : new Date(member.submittedAt),
                  }}
                  onDecision={(id, decision) => {
                    if (decision === "REJECTED") {
                      setRejectDialog({ open: true, applicationId: id, notes: "" });
                    } else {
                      reviewMutation.mutate({ applicationId: id, action: "APPROVE" });
                    }
                  }}
                  isPending={reviewMutation.isPending}
                />
              ))}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Reject with notes dialog */}
      <Dialog
        open={rejectDialog.open}
        onOpenChange={(open) => !open && setRejectDialog({ open: false, applicationId: null, notes: "" })}
      >
        <DialogContent className="bg-[#0d1410] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-400" /> Reject KYC Application
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Application #{rejectDialog.applicationId} \u2014 provide a reason so the farmer can resubmit.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Textarea
              placeholder="Reason for rejection (e.g. BVN mismatch, incomplete address)\u2026"
              value={rejectDialog.notes}
              onChange={(e) => setRejectDialog(prev => ({ ...prev, notes: e.target.value }))}
              className="bg-white/5 border-white/10 text-white placeholder:text-muted-foreground resize-none"
              rows={4}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setRejectDialog({ open: false, applicationId: null, notes: "" })}
              className="border-white/20 text-muted-foreground bg-transparent hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!rejectDialog.applicationId) return;
                reviewMutation.mutate({
                  applicationId: rejectDialog.applicationId,
                  action: "REJECT",
                  notes: rejectDialog.notes || undefined,
                });
              }}
              disabled={reviewMutation.isPending}
              className="bg-red-600 hover:bg-red-500 text-white"
            >
              {reviewMutation.isPending ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <><XCircle className="w-4 h-4 mr-1" /> Confirm Rejection</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
