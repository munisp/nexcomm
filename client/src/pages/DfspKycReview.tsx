/**
 * DFSP KYC Review Admin Panel
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin-only page for reviewing DFSP KYC/AML onboarding applications.
 * Features:
 *  - Summary stats (pending / approved / rejected / EDD required / high risk)
 *  - Filterable table of all DFSP KYC applications
 *  - Slide-out detail panel with full KYC data + approve/reject/EDD actions
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Clock,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Eye,
  RefreshCw,
  Users,
} from "lucide-react";

type KycStatus = "PENDING" | "APPROVED" | "REJECTED" | "EDD_REQUIRED";
type FilterStatus = KycStatus | "ALL";

const STATUS_CONFIG: Record<KycStatus, { label: string; color: string; icon: React.ReactNode }> = {
  PENDING:      { label: "Pending",      color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30", icon: <Clock className="w-3 h-3" /> },
  APPROVED:     { label: "Approved",     color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: <CheckCircle2 className="w-3 h-3" /> },
  REJECTED:     { label: "Rejected",     color: "bg-red-500/15 text-red-400 border-red-500/30", icon: <XCircle className="w-3 h-3" /> },
  EDD_REQUIRED: { label: "EDD Required", color: "bg-orange-500/15 text-orange-400 border-orange-500/30", icon: <AlertTriangle className="w-3 h-3" /> },
};

const RISK_CONFIG: Record<string, { color: string }> = {
  LOW:    { color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  MEDIUM: { color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  HIGH:   { color: "bg-red-500/15 text-red-400 border-red-500/30" },
};

type KycRecord = {
  id: number;
  fspId: string;
  legalEntityName: string;
  registrationNumber: string;
  taxId: string | null;
  regulatoryBody: string;
  licenseNumber: string;
  amlRiskLevel: string;
  pepExposure: boolean;
  sanctionsScreeningPassed: boolean;
  beneficialOwners: string;
  complianceOfficerName: string;
  complianceOfficerEmail: string;
  documentsProvided: string[] | null;
  acknowledgedAmlPolicy: boolean;
  acknowledgedDataProcessing: boolean;
  status: KycStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export default function DfspKycReview() {
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("ALL");
  const [search, setSearch] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<KycRecord | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewAction, setReviewAction] = useState<"APPROVED" | "REJECTED" | "EDD_REQUIRED" | null>(null);

  const utils = trpc.useUtils();

  const { data: stats, isLoading: statsLoading } = trpc.dfspKyc.kycStats.useQuery();
  const { data: records = [], isLoading: recordsLoading, refetch } = trpc.dfspKyc.listKycRecords.useQuery({
    status: filterStatus,
    search: search || undefined,
    limit: 100,
    offset: 0,
  });

  const reviewMutation = trpc.dfspKyc.reviewKyc.useMutation({
    onSuccess: (data) => {
      toast.success(`DFSP ${data.fspId} marked as ${data.status}.`);
      utils.dfspKyc.listKycRecords.invalidate();
      utils.dfspKyc.kycStats.invalidate();
      setReviewDialogOpen(false);
      setSelectedRecord(null);
      setReviewNotes("");
      setReviewAction(null);
    },
    onError: (err) => {
      toast.error(`Review failed: ${err.message}`);
    },
  });

  const handleReview = (record: KycRecord, action: "APPROVED" | "REJECTED" | "EDD_REQUIRED") => {
    setSelectedRecord(record);
    setReviewAction(action);
    setReviewNotes("");
    setReviewDialogOpen(true);
  };

  const submitReview = () => {
    if (!selectedRecord || !reviewAction) return;
    reviewMutation.mutate({
      fspId: selectedRecord.fspId,
      status: reviewAction,
      reviewNotes: reviewNotes || undefined,
    });
  };

  const actionConfig = {
    APPROVED:     { label: "Approve",          color: "bg-emerald-600 hover:bg-emerald-700 text-white" },
    REJECTED:     { label: "Reject",           color: "bg-red-600 hover:bg-red-700 text-white" },
    EDD_REQUIRED: { label: "Flag for EDD",     color: "bg-orange-600 hover:bg-orange-700 text-white" },
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <ShieldCheck className="w-7 h-7 text-primary" />
              DFSP KYC Review
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Review and approve DFSP onboarding KYC/AML compliance applications
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>

        {/* Stats Cards */}
        {!statsLoading && stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              { label: "Total",       value: stats.total,       icon: <Users className="w-4 h-4" />,          color: "text-foreground" },
              { label: "Pending",     value: stats.pending,     icon: <Clock className="w-4 h-4" />,          color: "text-yellow-400" },
              { label: "Approved",    value: stats.approved,    icon: <CheckCircle2 className="w-4 h-4" />,   color: "text-emerald-400" },
              { label: "Rejected",    value: stats.rejected,    icon: <XCircle className="w-4 h-4" />,        color: "text-red-400" },
              { label: "EDD Req.",    value: stats.eddRequired, icon: <AlertTriangle className="w-4 h-4" />,  color: "text-orange-400" },
              { label: "High Risk",   value: stats.highRisk,    icon: <ShieldAlert className="w-4 h-4" />,    color: "text-red-400" },
              { label: "Medium Risk", value: stats.mediumRisk,  icon: <ShieldX className="w-4 h-4" />,        color: "text-yellow-400" },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-border bg-card p-3 text-center">
                <div className={`flex items-center justify-center gap-1 text-xs text-muted-foreground mb-1`}>
                  {s.icon}
                  {s.label}
                </div>
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by FSP ID, entity name, or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as FilterStatus)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
              <SelectItem value="EDD_REQUIRED">EDD Required</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  {["FSP ID", "Legal Entity", "AML Risk", "PEP", "Sanctions", "Status", "Submitted", "Actions"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recordsLoading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      Loading KYC records...
                    </td>
                  </tr>
                ) : records.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      No KYC records found
                    </td>
                  </tr>
                ) : (
                  (records as KycRecord[]).map((record) => {
                    const statusCfg = STATUS_CONFIG[record.status];
                    const riskCfg = RISK_CONFIG[record.amlRiskLevel] ?? RISK_CONFIG.LOW;
                    return (
                      <tr key={record.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-primary">{record.fspId}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{record.legalEntityName}</div>
                          <div className="text-xs text-muted-foreground">{record.registrationNumber}</div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`text-xs ${riskCfg.color}`}>
                            {record.amlRiskLevel}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          {record.pepExposure ? (
                            <span className="text-red-400 text-xs font-medium">YES</span>
                          ) : (
                            <span className="text-emerald-400 text-xs">No</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {record.sanctionsScreeningPassed ? (
                            <span className="text-emerald-400 text-xs">Passed</span>
                          ) : (
                            <span className="text-red-400 text-xs font-medium">Failed</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`text-xs flex items-center gap-1 w-fit ${statusCfg.color}`}>
                            {statusCfg.icon}
                            {statusCfg.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {new Date(record.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs gap-1"
                              onClick={() => setSelectedRecord(record)}
                            >
                              <Eye className="w-3 h-3" />
                              View
                            </Button>
                            {record.status === "PENDING" || record.status === "EDD_REQUIRED" ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-emerald-400 hover:text-emerald-300"
                                  onClick={() => handleReview(record, "APPROVED")}
                                >
                                  Approve
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-red-400 hover:text-red-300"
                                  onClick={() => handleReview(record, "REJECTED")}
                                >
                                  Reject
                                </Button>
                                {record.status !== "EDD_REQUIRED" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs text-orange-400 hover:text-orange-300"
                                    onClick={() => handleReview(record, "EDD_REQUIRED")}
                                  >
                                    EDD
                                  </Button>
                                )}
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detail Panel (modal) */}
        {selectedRecord && !reviewDialogOpen && (
          <Dialog open={!!selectedRecord} onOpenChange={() => setSelectedRecord(null)}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-primary" />
                  KYC Record — {selectedRecord.fspId}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <Section title="Legal Entity">
                  <Row label="Entity Name" value={selectedRecord.legalEntityName} />
                  <Row label="Registration No." value={selectedRecord.registrationNumber} />
                  {selectedRecord.taxId && <Row label="Tax ID" value={selectedRecord.taxId} />}
                  <Row label="Regulatory Body" value={selectedRecord.regulatoryBody} />
                  <Row label="License Number" value={selectedRecord.licenseNumber} />
                </Section>
                <Section title="AML / Risk">
                  <Row label="AML Risk Level" value={
                    <Badge variant="outline" className={`text-xs ${(RISK_CONFIG[selectedRecord.amlRiskLevel] ?? RISK_CONFIG.LOW).color}`}>
                      {selectedRecord.amlRiskLevel}
                    </Badge>
                  } />
                  <Row label="PEP Exposure" value={selectedRecord.pepExposure ? "YES — Enhanced scrutiny required" : "No"} />
                  <Row label="Sanctions Screening" value={selectedRecord.sanctionsScreeningPassed ? "Passed" : "FAILED"} />
                  <Row label="Beneficial Owners" value={<pre className="whitespace-pre-wrap text-xs bg-muted rounded p-2">{selectedRecord.beneficialOwners}</pre>} />
                </Section>
                <Section title="Compliance Officer">
                  <Row label="Name" value={selectedRecord.complianceOfficerName} />
                  <Row label="Email" value={selectedRecord.complianceOfficerEmail} />
                </Section>
                <Section title="Documents Provided">
                  <div className="flex flex-wrap gap-2">
                    {(selectedRecord.documentsProvided ?? []).map((doc) => (
                      <Badge key={doc} variant="secondary" className="text-xs">{doc}</Badge>
                    ))}
                    {(selectedRecord.documentsProvided ?? []).length === 0 && (
                      <span className="text-muted-foreground text-xs">None submitted</span>
                    )}
                  </div>
                </Section>
                <Section title="Acknowledgements">
                  <Row label="AML Policy" value={selectedRecord.acknowledgedAmlPolicy ? "✓ Acknowledged" : "✗ Not acknowledged"} />
                  <Row label="Data Processing" value={selectedRecord.acknowledgedDataProcessing ? "✓ Acknowledged" : "✗ Not acknowledged"} />
                </Section>
                {selectedRecord.reviewNotes && (
                  <Section title="Review Notes">
                    <p className="text-muted-foreground">{selectedRecord.reviewNotes}</p>
                    {selectedRecord.reviewedBy && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Reviewed by {selectedRecord.reviewedBy} on {selectedRecord.reviewedAt ? new Date(selectedRecord.reviewedAt).toLocaleString() : "—"}
                      </p>
                    )}
                  </Section>
                )}
              </div>
              <DialogFooter className="flex gap-2 pt-2">
                {(selectedRecord.status === "PENDING" || selectedRecord.status === "EDD_REQUIRED") && (
                  <>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => handleReview(selectedRecord, "APPROVED")}>
                      Approve
                    </Button>
                    {selectedRecord.status !== "EDD_REQUIRED" && (
                      <Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-white" onClick={() => handleReview(selectedRecord, "EDD_REQUIRED")}>
                        Flag for EDD
                      </Button>
                    )}
                    <Button size="sm" variant="destructive" onClick={() => handleReview(selectedRecord, "REJECTED")}>
                      Reject
                    </Button>
                  </>
                )}
                <Button size="sm" variant="outline" onClick={() => setSelectedRecord(null)}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* Review Confirmation Dialog */}
        <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {reviewAction && actionConfig[reviewAction]?.label} — {selectedRecord?.fspId}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {reviewAction === "APPROVED" && "You are approving this DFSP for onboarding. They will be able to participate in the Mojaloop network."}
                {reviewAction === "REJECTED" && "You are rejecting this DFSP application. Please provide a reason in the notes below."}
                {reviewAction === "EDD_REQUIRED" && "You are flagging this DFSP for Enhanced Due Diligence. They will be notified to provide additional documentation."}
              </p>
              <Textarea
                placeholder="Review notes (optional for approval, recommended for rejection/EDD)..."
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                rows={4}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReviewDialogOpen(false)}>Cancel</Button>
              <Button
                className={reviewAction ? actionConfig[reviewAction].color : ""}
                onClick={submitReview}
                disabled={reviewMutation.isPending}
              >
                {reviewMutation.isPending ? "Submitting..." : (reviewAction ? actionConfig[reviewAction].label : "Submit")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

// ── Helper sub-components ──────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 border-b border-border pb-1">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-40 shrink-0">{label}:</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
