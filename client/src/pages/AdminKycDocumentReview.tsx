/**
 * AdminKycDocumentReview — Admin KYC Queue Review Page
 *
 * Features:
 *  - Paginated queue of all KYC submissions with status filter
 *  - Inline document viewer (image / PDF iframe) — no new tab needed
 *  - AI analysis scores (OCR confidence, authenticity, liveness)
 *  - Approve / Reject / Request More Info actions with notes
 *  - Real-time in-app notification sent to applicant on decision
 *  - Dual-auth enforcement (requireKycApprove middleware on backend)
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  CheckCircle2, XCircle, MessageSquareWarning, Eye, FileText,
  User, Calendar, Clock, Shield, AlertTriangle, RefreshCw,
  ChevronLeft, ChevronRight, Loader2, ExternalLink, Camera,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
type QueueStatus = "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "ALL";
type Decision = "APPROVED" | "REJECTED" | "UNDER_REVIEW";

interface KycQueueRecord {
  id: number;
  userId: number;
  status: string;
  reviewedBy: number | null;
  reviewNotes: string | null;
  documents: unknown;
  submittedAt: Date | string;
  reviewedAt: Date | string | null;
  userName: string | null;
  userEmail: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  PENDING:      "bg-yellow-100 text-yellow-800 border-yellow-300",
  UNDER_REVIEW: "bg-blue-100 text-blue-800 border-blue-300",
  APPROVED:     "bg-emerald-100 text-emerald-800 border-emerald-300",
  REJECTED:     "bg-red-100 text-red-800 border-red-300",
};

function statusBadge(status: string) {
  return (
    <Badge className={`border text-xs font-semibold ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700"}`}>
      {status.replace("_", " ")}
    </Badge>
  );
}

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function isPdf(url: string) {
  return url.toLowerCase().includes(".pdf") || url.toLowerCase().includes("application/pdf");
}

// ─── Inline Document Viewer ───────────────────────────────────────────────────
function DocumentViewer({ url, label }: { url: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setOpen(true)}>
        <Eye className="h-3.5 w-3.5" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl w-full h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 py-3 border-b flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4" />
              {label}
              <a href={url} target="_blank" rel="noopener noreferrer" className="ml-auto">
                <Button size="sm" variant="ghost" className="gap-1 text-xs h-7">
                  <ExternalLink className="h-3 w-3" /> Open in new tab
                </Button>
              </a>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            {isPdf(url) ? (
              <iframe src={url} className="w-full h-full border-0" title={label} />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gray-50 p-4">
                <img
                  src={url}
                  alt={label}
                  className="max-w-full max-h-full object-contain rounded shadow"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src =
                      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect fill='%23f3f4f6' width='200' height='200'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%236b7280' font-size='14'%3EImage unavailable%3C/text%3E%3C/svg%3E";
                  }}
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── AI Analysis Score Card ───────────────────────────────────────────────────
function ScoreBar({ label, value }: { label: string; value: number | null | undefined }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-medium text-foreground">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Decision Dialog ──────────────────────────────────────────────────────────
interface DecisionDialogProps {
  record: KycQueueRecord | null;
  onClose: () => void;
  onDecide: (kycQueueId: number, decision: Decision, notes: string) => void;
  isPending: boolean;
}

function DecisionDialog({ record, onClose, onDecide, isPending }: DecisionDialogProps) {
  const [decision, setDecision] = useState<Decision>("APPROVED");
  const [notes, setNotes] = useState("");

  if (!record) return null;

  const docs = record.documents as Record<string, string> | null;

  return (
    <Dialog open={!!record} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Review KYC Application #{record.id}
          </DialogTitle>
        </DialogHeader>

        {/* Applicant Info */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{record.userName ?? `User #${record.userId}`}</span>
            {record.userEmail && (
              <span className="text-muted-foreground text-xs">({record.userEmail})</span>
            )}
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Submitted: {fmtDate(record.submittedAt)}
            </span>
            <span>Current status: {statusBadge(record.status)}</span>
          </div>
        </div>

        {/* Documents */}
        {docs && Object.keys(docs).length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Submitted Documents</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(docs).map(([key, url]) => (
                typeof url === "string" && url.startsWith("http") ? (
                  <DocumentViewer key={key} url={url} label={key.replace(/_/g, " ")} />
                ) : null
              ))}
            </div>
          </div>
        )}

        <Separator />

        {/* Decision */}
        <div className="space-y-3">
          <p className="text-sm font-medium">Decision</p>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setDecision("APPROVED")}
              className={`flex flex-col items-center gap-1.5 rounded-lg border-2 p-3 text-xs font-medium transition-all ${
                decision === "APPROVED"
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-border hover:border-emerald-300"
              }`}
            >
              <CheckCircle2 className="h-5 w-5" />
              Approve
            </button>
            <button
              onClick={() => setDecision("UNDER_REVIEW")}
              className={`flex flex-col items-center gap-1.5 rounded-lg border-2 p-3 text-xs font-medium transition-all ${
                decision === "UNDER_REVIEW"
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-border hover:border-blue-300"
              }`}
            >
              <MessageSquareWarning className="h-5 w-5" />
              Request Info
            </button>
            <button
              onClick={() => setDecision("REJECTED")}
              className={`flex flex-col items-center gap-1.5 rounded-lg border-2 p-3 text-xs font-medium transition-all ${
                decision === "REJECTED"
                  ? "border-red-500 bg-red-50 text-red-700"
                  : "border-border hover:border-red-300"
              }`}
            >
              <XCircle className="h-5 w-5" />
              Reject
            </button>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {decision === "APPROVED" ? "Approval notes (optional)" :
               decision === "REJECTED" ? "Rejection reason (required)" :
               "Information requested (required)"}
            </label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                decision === "APPROVED"
                  ? "Any notes for the record…"
                  : decision === "REJECTED"
                  ? "Explain why the application is rejected so the user can resubmit…"
                  : "Specify exactly what additional documents or information is needed…"
              }
              className="text-sm min-h-[80px]"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => onDecide(record.id, decision, notes)}
            disabled={isPending || (decision !== "APPROVED" && !notes.trim())}
            className={
              decision === "APPROVED" ? "bg-emerald-600 hover:bg-emerald-700 text-white" :
              decision === "REJECTED" ? "bg-red-600 hover:bg-red-700 text-white" :
              "bg-blue-600 hover:bg-blue-700 text-white"
            }
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {decision === "APPROVED" ? "Approve Application" :
             decision === "REJECTED" ? "Reject Application" :
             "Request More Info"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
const PAGE_SIZE = 20;

export default function AdminKycDocumentReview() {
  const { user, loading: authLoading } = useAuth();
  const [statusFilter, setStatusFilter] = useState<QueueStatus>("PENDING");
  const [page, setPage] = useState(0);
  const [reviewTarget, setReviewTarget] = useState<KycQueueRecord | null>(null);
  const [adminSearch, setAdminSearch] = useState("");

  const utils = trpc.useUtils();

  const { data, isLoading, refetch } = trpc.kycAnalysis.adminListKycQueue.useQuery(
    { status: statusFilter, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
    { enabled: user?.role === "admin" }
  );

  const decideMutation = trpc.kycAnalysis.adminDecideKyc.useMutation({
    onSuccess: (updated) => {
      const upd = updated as { id?: number; status?: string };
      toast.success(`Application #${upd.id} — ${(upd.status ?? "").replace("_", " ")}`);
      setReviewTarget(null);
      utils.kycAnalysis.adminListKycQueue.invalidate();
    },
    onError: (err) => toast.error("Decision failed", { description: err.message }),
  });

  // Also load AI analysis results for the current page of user IDs
  const userIds = useMemo(
    () => (data?.records ?? []).map((r) => r.userId),
    [data]
  );
  const { data: aiResults } = trpc.kycAnalysis.adminList.useQuery(
    { limit: PAGE_SIZE, offset: 0 },
    { enabled: userIds.length > 0 }
  );

  // Load liveness sessions for current page users
  const { data: livenessSessions } = trpc.kycService.getLivenessSessions.useQuery(
    { userIds },
    { enabled: userIds.length > 0 }
  );
  type LivenessSession = NonNullable<typeof livenessSessions>[number];
  const livenessByUserId = useMemo(() => {
    const map: Record<number, LivenessSession> = {};
    (livenessSessions ?? []).forEach((s) => { if (s.userId != null) map[s.userId] = s; });
    return map;
  }, [livenessSessions]);

  type AiResult = NonNullable<typeof aiResults>[number];
  const aiByUserId = useMemo(() => {
    const map: Record<number, AiResult> = {};
    (aiResults ?? []).forEach((r) => { map[r.userId] = r; });
    return map;
  }, [aiResults]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Shield className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Please sign in to access this page.</p>
        <a href={getLoginUrl()}><Button>Sign In</Button></a>
      </div>
    );
  }

  if (user.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertTriangle className="h-12 w-12 text-yellow-500" />
        <p className="text-muted-foreground">Admin access required.</p>
      </div>
    );
  }

  const allRecords: KycQueueRecord[] = data?.records ?? [];
  const records = useMemo(() => {
    const q = adminSearch.trim().toLowerCase();
    if (!q) return allRecords;
    return allRecords.filter(r =>
      String(r.userName ?? "").toLowerCase().includes(q) ||
      String(r.userEmail ?? "").toLowerCase().includes(q) ||
      String(r.id ?? "").includes(q)
    );
  }, [allRecords, adminSearch]);
  const total = records.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="container py-6 space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            KYC Document Review
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review submitted KYC applications, inspect documents, and make approval decisions.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search by name or email..."
          value={adminSearch}
          onChange={(e) => { setAdminSearch(e.target.value); setPage(0); }}
          className="h-9 px-3 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-56"
        />
        <Select
          value={statusFilter}
          onValueChange={(v) => { setStatusFilter(v as QueueStatus); setPage(0); }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="UNDER_REVIEW">Under Review</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {total} application{total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Queue Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : records.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
            <CheckCircle2 className="h-12 w-12 text-emerald-400" />
            <p className="text-muted-foreground font-medium">No applications in this queue</p>
            <p className="text-xs text-muted-foreground">
              {statusFilter === "PENDING"
                ? "All pending applications have been reviewed."
                : "No applications match this filter."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {records.map((record) => {
            const ai = aiByUserId[record.userId];
            const ls = livenessByUserId[record.userId];
            const docs = record.documents as Record<string, string> | null;
            const docCount = docs ? Object.values(docs).filter((v) => typeof v === "string" && v.startsWith("http")).length : 0;

            return (
              <Card key={record.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Left: user info */}
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">
                          {record.userName ?? `User #${record.userId}`}
                        </span>
                        {record.userEmail && (
                          <span className="text-xs text-muted-foreground">{record.userEmail}</span>
                        )}
                        {statusBadge(record.status)}
                        <span className="text-xs text-muted-foreground ml-auto">
                          #{record.id}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Submitted {fmtDate(record.submittedAt)}
                        </span>
                        {record.reviewedAt && (
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Reviewed {fmtDate(record.reviewedAt)}
                          </span>
                        )}
                        <span>{docCount} document{docCount !== 1 ? "s" : ""} attached</span>
                      </div>

                      {/* AI scores */}
                      {ai && (
                        <div className="grid grid-cols-3 gap-3 pt-1">
                          <ScoreBar label="OCR Confidence" value={ai.ocrAvgConfidence ? Number(ai.ocrAvgConfidence) : null} />
                          <ScoreBar label="Doc Authenticity" value={ai.documentAuthenticityScore ? Number(ai.documentAuthenticityScore) : null} />
                          <ScoreBar label="Liveness Score" value={ai.selfieOverallScore ? Number(ai.selfieOverallScore) : null} />
                        </div>
                      )}
                      {/* Liveness session badge */}
                      {ls ? (
                        <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs rounded px-2 py-1.5 border ${
                          ls.overallResult === "PASS" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-700"
                        }`}>
                          <span className="flex items-center gap-1 font-medium">
                            {ls.overallResult === "PASS" ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                            Liveness {ls.overallResult === "PASS" ? "PASSED" : "FAILED"}
                          </span>
                          {ls.faceMatchScore != null && (
                            <span>Face match: {Math.round(Number(ls.faceMatchScore) * 100)}%</span>
                          )}
                          {ls.spoofType && ls.spoofType !== "UNKNOWN" && (
                            <span className="text-red-600 font-semibold">⚠ Spoof: {ls.spoofType}</span>
                          )}
                          <span className="text-muted-foreground ml-auto">{new Date(ls.updatedAt).toLocaleString()}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs text-amber-600">
                          <Camera className="w-3.5 h-3.5" />
                          No liveness session recorded
                        </div>
                      )}

                      {/* Review notes */}
                      {record.reviewNotes && (
                        <div className="rounded bg-muted/50 px-3 py-2 text-xs text-muted-foreground border-l-2 border-primary/30">
                          <span className="font-medium text-foreground">Notes: </span>
                          {record.reviewNotes}
                        </div>
                      )}

                      {/* Document quick-view buttons */}
                      {docs && Object.keys(docs).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {Object.entries(docs).map(([key, url]) =>
                            typeof url === "string" && url.startsWith("http") ? (
                              <DocumentViewer key={key} url={url} label={key.replace(/_/g, " ")} />
                            ) : null
                          )}
                        </div>
                      )}
                    </div>

                    {/* Right: action button */}
                    {(record.status === "PENDING" || record.status === "UNDER_REVIEW") && (
                      <Button
                        size="sm"
                        onClick={() => setReviewTarget(record)}
                        className="flex-shrink-0 gap-1.5"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Review
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Decision Dialog */}
      <DecisionDialog
        record={reviewTarget}
        onClose={() => setReviewTarget(null)}
        onDecide={(id, decision, notes) =>
          decideMutation.mutate({ kycQueueId: id, decision, reviewNotes: notes || undefined })
        }
        isPending={decideMutation.isPending}
      />
    </div>
  );
}
