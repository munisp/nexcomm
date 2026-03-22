/**
 * Settlement Dispute Resolution Page
 * ────────────────────────────────────
 * Shows:
 *  • User's own disputes with status badges and timeline
 *  • "Raise Dispute" button that opens a form to dispute a settlement
 *  • Dispute detail drawer with full audit trail
 *  • Admin panel: all disputes with assign + resolve actions
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Clock, XCircle, Plus, ChevronLeft, ChevronRight, Paperclip, Upload, FileText, ExternalLink } from "lucide-react";

// ─── helpers ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
  OPEN: { label: "Open", variant: "default", icon: <AlertCircle className="w-3 h-3" /> },
  UNDER_REVIEW: { label: "Under Review", variant: "secondary", icon: <Clock className="w-3 h-3" /> },
  RESOLVED_SETTLED: { label: "Resolved — Settled", variant: "default", icon: <CheckCircle2 className="w-3 h-3" /> },
  RESOLVED_FAILED: { label: "Resolved — Failed", variant: "destructive", icon: <XCircle className="w-3 h-3" /> },
  WITHDRAWN: { label: "Withdrawn", variant: "outline", icon: <XCircle className="w-3 h-3" /> },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, variant: "outline" as const, icon: null };
  return (
    <Badge variant={cfg.variant} className="gap-1 text-xs">
      {cfg.icon}
      {cfg.label}
    </Badge>
  );
}

// ─── component ───────────────────────────────────────────────────────────────

export default function Disputes() {
  const { user, loading: authLoading } = useAuth();
  const utils = trpc.useUtils();

  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "OPEN" | "UNDER_REVIEW" | "RESOLVED_SETTLED" | "RESOLVED_FAILED" | "WITHDRAWN">("ALL");
  const [raiseDialogOpen, setRaiseDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [selectedDisputeId, setSelectedDisputeId] = useState<number | null>(null);

  // Raise form state
  const [settlementIdInput, setSettlementIdInput] = useState("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");

  // Resolve form state
  const [resolution, setResolution] = useState<"SETTLED" | "FAILED">("SETTLED");
  const [resolutionNotes, setResolutionNotes] = useState("");

  // Evidence upload state
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);

  const isAdmin = user?.role === "admin";

  // Queries
  const { data: myDisputes, isLoading: myLoading } = trpc.disputes.myList.useQuery(
    { status: statusFilter, limit: 10, offset: page * 10 },
    { enabled: !!user },
  );
  const { data: adminDisputes, isLoading: adminLoading } = trpc.disputes.adminList.useQuery(
    { status: statusFilter, limit: 10, offset: page * 10 },
    { enabled: !!user && isAdmin },
  );
  const { data: detailData } = trpc.disputes.getDetail.useQuery(
    { disputeId: selectedDisputeId! },
    { enabled: !!selectedDisputeId && detailDialogOpen },
  );

  // Mutations
  const raiseMutation = trpc.disputes.raise.useMutation({
    onSuccess: () => {
      toast.success("Dispute raised — our team will review within 2 business days.");
      setRaiseDialogOpen(false);
      setSettlementIdInput("");
      setReason("");
      setEvidence("");
      utils.disputes.myList.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const withdrawMutation = trpc.disputes.withdraw.useMutation({
    onSuccess: () => {
      toast.success("Dispute withdrawn.");
      utils.disputes.myList.invalidate();
      setDetailDialogOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const resolveMutation = trpc.disputes.adminResolve.useMutation({
    onSuccess: (data) => {
      toast.success(`Dispute resolved as ${data.newStatus.replace("RESOLVED_", "")}.`);
      setResolveDialogOpen(false);
      setResolutionNotes("");
      utils.disputes.adminList.invalidate();
      utils.disputes.myList.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const addEvidenceMutation = trpc.disputes.addEvidence.useMutation({
    onSuccess: () => {
      toast.success("Evidence file attached to dispute.");
      setEvidenceFile(null);
      utils.disputes.getDetail.invalidate({ disputeId: selectedDisputeId! });
    },
    onError: (err) => toast.error(err.message),
  });

  const { data: evidenceList } = trpc.disputes.listEvidence.useQuery(
    { disputeId: selectedDisputeId! },
    { enabled: !!selectedDisputeId && detailDialogOpen },
  );

  async function handleEvidenceUpload() {
    if (!evidenceFile || !selectedDisputeId) return;
    setUploadingEvidence(true);
    try {
      const formData = new FormData();
      formData.append("file", evidenceFile);
      const res = await fetch(`/api/disputes/${selectedDisputeId}/evidence`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error ?? "Upload failed");
      }
      const meta = await res.json();
      await addEvidenceMutation.mutateAsync({
        disputeId: selectedDisputeId,
        fileKey: meta.fileKey,
        fileUrl: meta.fileUrl,
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        fileSize: meta.fileSize,
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingEvidence(false);
    }
  }

  const assignMutation = trpc.disputes.adminAssign.useMutation({
    onSuccess: () => {
      toast.success("Dispute assigned and moved to Under Review.");
      utils.disputes.adminList.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (authLoading) return <DashboardLayout><div className="p-8 text-muted-foreground">Loading…</div></DashboardLayout>;
  if (!user) {
    window.location.href = getLoginUrl();
    return null;
  }

  const disputes = isAdmin ? (adminDisputes?.disputes ?? []) : (myDisputes?.disputes ?? []);
  const total = isAdmin ? (adminDisputes?.total ?? 0) : (myDisputes?.total ?? 0);
  const totalPages = Math.ceil(total / 10);
  const isLoading = isAdmin ? adminLoading : myLoading;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Settlement Disputes</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {isAdmin ? "Review and resolve all settlement disputes" : "Raise and track disputes on your settlements"}
            </p>
          </div>
          {!isAdmin && (
            <Button onClick={() => setRaiseDialogOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              Raise Dispute
            </Button>
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as typeof statusFilter); setPage(0); }}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              <SelectItem value="OPEN">Open</SelectItem>
              <SelectItem value="UNDER_REVIEW">Under Review</SelectItem>
              <SelectItem value="RESOLVED_SETTLED">Resolved — Settled</SelectItem>
              <SelectItem value="RESOLVED_FAILED">Resolved — Failed</SelectItem>
              <SelectItem value="WITHDRAWN">Withdrawn</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{total} dispute{total !== 1 ? "s" : ""}</span>
        </div>

        {/* Disputes Table */}
        <Card>
          <CardContent className="pt-4">
            {isLoading ? (
              <p className="text-muted-foreground text-sm py-8 text-center">Loading…</p>
            ) : disputes.length === 0 ? (
              <p className="text-muted-foreground text-sm py-12 text-center">
                {statusFilter === "ALL" ? "No disputes found." : `No ${statusFilter.replace("_", " ").toLowerCase()} disputes.`}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left pb-3 font-medium">ID</th>
                      <th className="text-left pb-3 font-medium">Settlement</th>
                      <th className="text-left pb-3 font-medium">Status</th>
                      <th className="text-left pb-3 font-medium">Reason</th>
                      <th className="text-left pb-3 font-medium">Raised</th>
                      <th className="pb-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {disputes.map((d) => (
                      <tr key={d.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">#{d.id}</td>
                        <td className="py-3 pr-4 font-medium">Settlement #{d.settlementId}</td>
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <StatusBadge status={d.status} />
                            {(d as { slaDeadline?: string | Date | null; slaBreached?: boolean }).slaDeadline &&
                              !['RESOLVED_SETTLED','RESOLVED_FAILED','WITHDRAWN'].includes(d.status) &&
                              (new Date((d as { slaDeadline: string | Date }).slaDeadline) < new Date()) && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                                ⚠ SLA Overdue
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 pr-4 max-w-[240px] truncate text-muted-foreground">{d.reason}</td>
                        <td className="py-3 pr-4 text-muted-foreground text-xs">
                          <div>{new Date(d.createdAt).toLocaleDateString()}</div>
                          {(d as { slaDeadline?: string | Date | null }).slaDeadline && (
                            <div className="text-xs text-slate-500 mt-0.5">
                              SLA: {new Date((d as { slaDeadline: string | Date }).slaDeadline).toLocaleDateString()}
                            </div>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          <div className="flex items-center gap-2 justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => { setSelectedDisputeId(d.id); setDetailDialogOpen(true); }}
                            >
                              View
                            </Button>
                            {isAdmin && ["OPEN", "UNDER_REVIEW"].includes(d.status) && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  disabled={assignMutation.isPending}
                                  onClick={() => assignMutation.mutate({ disputeId: d.id, assigneeId: user.id })}
                                >
                                  Assign to Me
                                </Button>
                                <Button
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => { setSelectedDisputeId(d.id); setResolveDialogOpen(true); }}
                                >
                                  Resolve
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-4">
                <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</span>
                <Button variant="ghost" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Raise Dispute Dialog */}
      <Dialog open={raiseDialogOpen} onOpenChange={setRaiseDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Raise a Settlement Dispute</DialogTitle>
            <DialogDescription>
              Provide the settlement ID and a detailed reason. Our team will review within 2 business days.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Settlement ID</Label>
              <Input
                type="number"
                value={settlementIdInput}
                onChange={e => setSettlementIdInput(e.target.value)}
                placeholder="e.g. 12345"
              />
            </div>
            <div className="space-y-2">
              <Label>Reason <span className="text-destructive">*</span></Label>
              <Textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Describe the issue with this settlement in detail…"
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label>Supporting Evidence (optional)</Label>
              <Textarea
                value={evidence}
                onChange={e => setEvidence(e.target.value)}
                placeholder="Paste any relevant transaction references, screenshots descriptions, or documentation…"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRaiseDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!settlementIdInput || reason.length < 10 || raiseMutation.isPending}
              onClick={() => raiseMutation.mutate({
                settlementId: parseInt(settlementIdInput),
                reason,
                evidence: evidence || undefined,
              })}
            >
              {raiseMutation.isPending ? "Submitting…" : "Submit Dispute"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Dispute #{selectedDisputeId}</DialogTitle>
          </DialogHeader>
          {detailData ? (
            <Tabs defaultValue="details">
              <TabsList>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="audit">Audit Trail ({detailData.auditEntries.length})</TabsTrigger>
              <TabsTrigger value="evidence">Evidence ({evidenceList?.length ?? 0})</TabsTrigger>
              </TabsList>
              <TabsContent value="details" className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Settlement</p>
                    <p className="font-medium">#{detailData.dispute.settlementId}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Status</p>
                    <StatusBadge status={detailData.dispute.status} />
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Raised</p>
                    <p className="font-medium">{new Date(detailData.dispute.createdAt).toLocaleString()}</p>
                  </div>
                  {detailData.dispute.resolvedAt && (
                    <div>
                      <p className="text-muted-foreground text-xs">Resolved</p>
                      <p className="font-medium">{new Date(detailData.dispute.resolvedAt).toLocaleString()}</p>
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Reason</p>
                  <p className="text-sm bg-muted/30 rounded p-3">{detailData.dispute.reason}</p>
                </div>
                {detailData.dispute.evidence && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">Evidence</p>
                    <p className="text-sm bg-muted/30 rounded p-3">{detailData.dispute.evidence}</p>
                  </div>
                )}
                {detailData.dispute.resolutionNotes && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">Resolution Notes</p>
                    <p className="text-sm bg-muted/30 rounded p-3">{detailData.dispute.resolutionNotes}</p>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="evidence" className="space-y-4 pt-2">
                {/* Upload new evidence */}
                {["OPEN", "UNDER_REVIEW"].includes(detailData.dispute.status) && (
                  <div className="border rounded-lg p-4 space-y-3">
                    <p className="text-sm font-medium">Attach Evidence File</p>
                    <p className="text-xs text-muted-foreground">Accepted: PDF, JPEG, PNG, WEBP, DOCX — max 10 MB</p>
                    <div className="flex items-center gap-3">
                      <label className="flex-1 cursor-pointer">
                        <div className="flex items-center gap-2 border rounded px-3 py-2 text-sm text-muted-foreground hover:bg-muted/30 transition-colors">
                          <Paperclip className="w-4 h-4" />
                          {evidenceFile ? evidenceFile.name : "Choose file…"}
                        </div>
                        <input
                          type="file"
                          className="hidden"
                          accept=".pdf,.jpg,.jpeg,.png,.webp,.docx"
                          onChange={e => setEvidenceFile(e.target.files?.[0] ?? null)}
                        />
                      </label>
                      <Button
                        size="sm"
                        disabled={!evidenceFile || uploadingEvidence || addEvidenceMutation.isPending}
                        onClick={handleEvidenceUpload}
                        className="gap-1.5"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        {uploadingEvidence ? "Uploading…" : "Upload"}
                      </Button>
                    </div>
                  </div>
                )}
                {/* Evidence list */}
                {!evidenceList || evidenceList.length === 0 ? (
                  <p className="text-muted-foreground text-sm py-4 text-center">No evidence files attached yet.</p>
                ) : (
                  <div className="space-y-2">
                    {evidenceList.map(ev => (
                      <div key={ev.id} className="flex items-center gap-3 p-3 border rounded-lg">
                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{ev.fileName}</p>
                          <p className="text-xs text-muted-foreground">
                            {(ev.fileSize / 1024).toFixed(1)} KB · {ev.mimeType} · {new Date(ev.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <a
                          href={ev.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0"
                        >
                          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs">
                            <ExternalLink className="w-3 h-3" /> View
                          </Button>
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="audit" className="pt-2">
                <div className="space-y-3">
                  {detailData.auditEntries.map((entry) => (
                    <div key={entry.id} className="flex gap-3 text-sm">
                      <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                      <div>
                        <p className="font-medium">{entry.action}</p>
                        {entry.fromStatus && entry.toStatus && (
                          <p className="text-xs text-muted-foreground">{entry.fromStatus} → {entry.toStatus}</p>
                        )}
                        {entry.notes && <p className="text-xs text-muted-foreground mt-0.5">{entry.notes}</p>}
                        <p className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            <p className="text-muted-foreground text-sm py-4">Loading…</p>
          )}
          <DialogFooter>
            {detailData && ["OPEN", "UNDER_REVIEW"].includes(detailData.dispute.status) && !isAdmin && (
              <Button
                variant="outline"
                disabled={withdrawMutation.isPending}
                onClick={() => withdrawMutation.mutate({ disputeId: selectedDisputeId! })}
              >
                {withdrawMutation.isPending ? "Withdrawing…" : "Withdraw Dispute"}
              </Button>
            )}
            <Button variant="outline" onClick={() => setDetailDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin Resolve Dialog */}
      <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resolve Dispute #{selectedDisputeId}</DialogTitle>
            <DialogDescription>
              Choose a resolution and provide detailed notes. This action will update the settlement status and notify the member.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Resolution</Label>
              <Select value={resolution} onValueChange={(v) => setResolution(v as "SETTLED" | "FAILED")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SETTLED">Resolved — Mark as SETTLED (in favour of member)</SelectItem>
                  <SelectItem value="FAILED">Resolved — Uphold FAILED (original status stands)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Resolution Notes <span className="text-destructive">*</span></Label>
              <Textarea
                value={resolutionNotes}
                onChange={e => setResolutionNotes(e.target.value)}
                placeholder="Explain the resolution decision in detail…"
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={resolutionNotes.length < 10 || resolveMutation.isPending}
              onClick={() => {
                if (selectedDisputeId) {
                  resolveMutation.mutate({ disputeId: selectedDisputeId, resolution, resolutionNotes });
                }
              }}
            >
              {resolveMutation.isPending ? "Resolving…" : "Confirm Resolution"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
