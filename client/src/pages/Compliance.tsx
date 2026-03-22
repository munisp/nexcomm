/**
 * NEXCOM Exchange — Compliance
 * KYC/AML management, regulatory reports, and audit trail
 * All action buttons wired to real tRPC mutations.
 */
import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Shield, FileText, AlertTriangle, CheckCircle2, Clock, XCircle, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type KYCStatus = "APPROVED" | "PENDING" | "REJECTED" | "EXPIRED" | "UNDER_REVIEW";
type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface AMLAlert {
  id: string;
  numericId?: number;
  alertType: string;
  entity: string;
  amount: number;
  currency: string;
  date: string;
  riskLevel: RiskLevel;
  status: "OPEN" | "INVESTIGATING" | "CLEARED" | "ESCALATED";
  description: string;
}

interface RegulatoryReport {
  id: string;
  numericId?: number;
  reportType: string;
  period: string;
  submittedDate: string;
  dueDate: string;
  status: "SUBMITTED" | "PENDING" | "OVERDUE" | "GENERATING" | "READY";
  regulator: string;
  fileSize: string;
  downloadUrl?: string;
}

// ── Static fallback data (shown when DB is empty) ─────────────────────────────
const STATIC_AML_ALERTS: AMLAlert[] = [
  { id: "AML001", alertType: "Large Cash Transaction",   entity: "Emeka Nwosu",       amount: 48500000, currency: "NGN", date: "2026-03-02", riskLevel: "HIGH",     status: "INVESTIGATING", description: "Cash deposit exceeding ₦5M threshold without prior notice" },
  { id: "AML002", alertType: "Structuring",              entity: "Unknown Entity",    amount: 4800000,  currency: "NGN", date: "2026-03-01", riskLevel: "CRITICAL", status: "ESCALATED",     description: "Multiple transactions just below ₦5M threshold over 3 days" },
  { id: "AML003", alertType: "PEP Screening Hit",        entity: "Accra Cocoa Ltd.",  amount: 0,        currency: "USD", date: "2026-03-01", riskLevel: "HIGH",     status: "INVESTIGATING", description: "Director linked to politically exposed person database" },
  { id: "AML004", alertType: "Unusual Trading Pattern",  entity: "Seun Adeleke",      amount: 12400000, currency: "NGN", date: "2026-02-28", riskLevel: "MEDIUM",   status: "OPEN",          description: "Rapid buy-sell cycles in MAIZE contracts inconsistent with profile" },
  { id: "AML005", alertType: "Sanctions List Match",     entity: "Foreign Entity X",  amount: 0,        currency: "USD", date: "2026-02-27", riskLevel: "CRITICAL", status: "ESCALATED",     description: "Entity name partial match on OFAC SDN list" },
];

const STATIC_REPORTS: RegulatoryReport[] = [
  { id: "RPT001", reportType: "STR — Suspicious Transaction Report", period: "Feb 2026",  submittedDate: "2026-03-03", dueDate: "2026-03-05", status: "SUBMITTED", regulator: "NFIU",  fileSize: "248 KB" },
  { id: "RPT002", reportType: "CTR — Cash Transaction Report",       period: "Feb 2026",  submittedDate: "2026-03-03", dueDate: "2026-03-05", status: "SUBMITTED", regulator: "NFIU",  fileSize: "1.2 MB" },
  { id: "RPT003", reportType: "Monthly Trading Report",              period: "Feb 2026",  submittedDate: "2026-03-02", dueDate: "2026-03-10", status: "SUBMITTED", regulator: "SEC",   fileSize: "4.8 MB" },
  { id: "RPT004", reportType: "AML Compliance Report",               period: "Q4 2025",   submittedDate: "2026-01-15", dueDate: "2026-01-31", status: "SUBMITTED", regulator: "CBN",   fileSize: "2.4 MB" },
  { id: "RPT005", reportType: "KYC Status Report",                   period: "Mar 2026",  submittedDate: "",           dueDate: "2026-04-05", status: "PENDING",   regulator: "SEC",   fileSize: "—" },
  { id: "RPT006", reportType: "Position Limits Report",              period: "Mar 2026",  submittedDate: "",           dueDate: "2026-04-10", status: "PENDING",   regulator: "SEC",   fileSize: "—" },
  { id: "RPT007", reportType: "Annual Compliance Report",            period: "2025",      submittedDate: "",           dueDate: "2026-03-31", status: "OVERDUE",   regulator: "SEC",   fileSize: "—" },
];

const KYC_STATUS_CONFIG: Record<KYCStatus, { label: string; className: string; icon: React.ElementType }> = {
  APPROVED:     { label: "Approved",     className: "badge-settled",   icon: CheckCircle2 },
  PENDING:      { label: "Pending",      className: "badge-active",    icon: Clock },
  REJECTED:     { label: "Rejected",     className: "badge-cancelled", icon: XCircle },
  EXPIRED:      { label: "Expired",      className: "badge-cancelled", icon: AlertTriangle },
  UNDER_REVIEW: { label: "Under Review", className: "badge-pending",   icon: Clock },
};

const RISK_CONFIG: Record<RiskLevel, string> = {
  LOW:      "text-positive",
  MEDIUM:   "text-yellow-400",
  HIGH:     "text-orange-400",
  CRITICAL: "text-negative",
};

const AML_STATUS_CONFIG: Record<string, string> = {
  OPEN:          "badge-active",
  INVESTIGATING: "badge-pending",
  CLEARED:       "badge-settled",
  ESCALATED:     "badge-cancelled",
};

// ── Report type mapping to regulatory router enum ─────────────────────────────
const REPORT_TYPE_MAP: Record<string, "CAMA_FILING" | "SEC_FILING" | "CBN_FILING"> = {
  "STR — Suspicious Transaction Report": "CBN_FILING",
  "CTR — Cash Transaction Report":       "CBN_FILING",
  "Monthly Trading Report":              "SEC_FILING",
  "AML Compliance Report":               "CBN_FILING",
  "KYC Status Report":                   "SEC_FILING",
  "Position Limits Report":              "SEC_FILING",
  "Annual Compliance Report":            "SEC_FILING",
};

export default function Compliance() {
  const [tab, setTab] = useState("kyc");
  const [kycFilter, setKycFilter] = useState<KYCStatus | "ALL">("ALL");

  // KYC decide dialog state
  const [kycDecideDialog, setKycDecideDialog] = useState<{ id: number; name: string; decision: "APPROVED" | "REJECTED" } | null>(null);
  const [kycNotes, setKycNotes] = useState("");

  // AML review dialog state
  const [amlReviewDialog, setAmlReviewDialog] = useState<{ id: number; status: "ESCALATED" | "CLEARED"; alertType: string } | null>(null);
  const [amlNotes, setAmlNotes] = useState("");

  // Generate report dialog state
  const [generateDialog, setGenerateDialog] = useState<{ reportType: string } | null>(null);
  const [generatePeriodStart, setGeneratePeriodStart] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); d.setDate(1); return d.toISOString().slice(0, 10);
  });
  const [generatePeriodEnd, setGeneratePeriodEnd] = useState(() => {
    const d = new Date(); d.setDate(0); return d.toISOString().slice(0, 10);
  });

  // ── tRPC queries ──────────────────────────────────────────────────────────
  const utils = trpc.useUtils();

  const { data: amlFlagsData, refetch: refetchAml } = trpc.aml.adminListFlags.useQuery(
    { limit: 50, offset: 0 }, { retry: false }
  );
  const { data: analyticsSummary } = trpc.analytics.summary.useQuery();
  const { data: kycQueueData, refetch: refetchKyc } = trpc.kycAnalysis.adminListKycQueue.useQuery(
    { status: "ALL", limit: 50, offset: 0 }, { retry: false }
  );
  const { data: reportsData, refetch: refetchReports } = trpc.regulatoryReporting.adminListReports.useQuery(
    { limit: 50, offset: 0 }, { retry: false }
  );

  // ── tRPC mutations ────────────────────────────────────────────────────────
  const decideKyc = trpc.kycAnalysis.adminDecideKyc.useMutation({
    onSuccess: (data) => {
      toast.success(`KYC ${data.status === "APPROVED" ? "approved" : "rejected"} successfully`);
      refetchKyc();
      setKycDecideDialog(null);
      setKycNotes("");
    },
    onError: (err) => toast.error(err.message),
  });

  const reviewAml = trpc.aml.adminReviewFlag.useMutation({
    onSuccess: (data) => {
      toast.success(`AML alert ${data.status === "CLEARED" ? "cleared" : "escalated"} successfully`);
      refetchAml();
      setAmlReviewDialog(null);
      setAmlNotes("");
    },
    onError: (err) => toast.error(err.message),
  });

  const generateReport = trpc.regulatoryReporting.adminGenerateReport.useMutation({
    onSuccess: () => {
      toast.success("Report generation started — check back in a few seconds");
      refetchReports();
      setGenerateDialog(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const [downloadReportId, setDownloadReportId] = useState<number | null>(null);
  const { data: downloadReportData } = trpc.regulatoryReporting.adminDownloadReport.useQuery(
    { reportId: downloadReportId! },
    { enabled: downloadReportId !== null, retry: false }
  );
  // Trigger download when data arrives
  useEffect(() => {
    if (!downloadReportData || downloadReportId === null) return;
    if (downloadReportData.content) {
      const blob = new Blob([downloadReportData.content], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report-${downloadReportId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Report downloaded");
    }
    setDownloadReportId(null);
  }, [downloadReportData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived data ──────────────────────────────────────────────────────────
  const liveKycRecords = useMemo(() => {
    if (!kycQueueData?.records || kycQueueData.records.length === 0) return null;
    return kycQueueData.records;
  }, [kycQueueData]);

  const liveAmlAlerts = useMemo(() => {
    if (!amlFlagsData?.flags || amlFlagsData.flags.length === 0) return STATIC_AML_ALERTS;
    return amlFlagsData.flags.map(f => ({
      id: String(f.id),
      numericId: f.id,
      alertType: f.transactionType ?? "AML Flag",
      entity: `User #${f.userId}`,
      amount: Number(f.amount ?? 0),
      currency: f.currency ?? "NGN",
      date: f.createdAt ? new Date(f.createdAt).toISOString().slice(0, 10) : "",
      riskLevel: (f.severity ?? "MEDIUM") as RiskLevel,
      status: (f.status === "PENDING" ? "OPEN" : f.status === "UNDER_REVIEW" ? "INVESTIGATING" : f.status === "CLEARED" ? "CLEARED" : "ESCALATED") as AMLAlert["status"],
      description: f.flagReason ?? "",
    }));
  }, [amlFlagsData]);

  const liveReports = useMemo(() => {
    if (!reportsData || !Array.isArray(reportsData) || reportsData.length === 0) return STATIC_REPORTS;
    return (reportsData as Array<{ id: number; reportType: string; periodStart: Date; periodEnd: Date; status: string; rowCount: number | null; fileSize: number | null; createdAt: Date }>).map(r => ({
      id: String(r.id),
      numericId: r.id,
      reportType: r.reportType,
      period: `${new Date(r.periodStart).toLocaleDateString("en-US", { month: "short", year: "numeric" })} – ${new Date(r.periodEnd).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`,
      submittedDate: r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : "",
      dueDate: "",
      status: (r.status === "READY" ? "SUBMITTED" : r.status === "GENERATING" ? "PENDING" : "PENDING") as RegulatoryReport["status"],
      regulator: r.reportType.includes("CBN") ? "CBN" : r.reportType.includes("SEC") ? "SEC" : "NFIU",
      fileSize: r.rowCount ? `${r.rowCount} rows` : "—",
    }));
  }, [reportsData]);

  const filteredKYC = liveKycRecords
    ? liveKycRecords.filter(k => kycFilter === "ALL" || k.status === kycFilter)
    : [];
  const pendingKYC = analyticsSummary ? analyticsSummary.pendingKyc : (kycQueueData?.records?.filter(k => k.status === "PENDING" || k.status === "UNDER_REVIEW").length ?? 0);
  const openAlerts = liveAmlAlerts.filter(a => a.status === "OPEN" || a.status === "INVESTIGATING" || a.status === "ESCALATED").length;
  const overdueReports = liveReports.filter(r => r.status === "OVERDUE").length;
  const approvedKYC = kycQueueData?.records?.filter(k => k.status === "APPROVED").length ?? 0;

  return (
    <div className="page-container space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2" style={{ fontFamily: "'DM Serif Display', serif" }}>
          <Shield className="w-6 h-6 text-primary" />
          Compliance
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">KYC/AML management, regulatory reporting, and audit trail</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Pending KYC",     value: pendingKYC,  icon: Clock,         color: "text-yellow-400" },
          { label: "Open AML Alerts", value: openAlerts,  icon: AlertTriangle, color: "text-negative" },
          { label: "Overdue Reports", value: overdueReports, icon: FileText,   color: overdueReports > 0 ? "text-negative" : "text-positive" },
          { label: "Approved KYC",    value: approvedKYC, icon: CheckCircle2,  color: "text-positive" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="stat-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{label}</span>
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="kyc">KYC Management</TabsTrigger>
          <TabsTrigger value="aml">AML Alerts ({openAlerts})</TabsTrigger>
          <TabsTrigger value="reports">Regulatory Reports</TabsTrigger>
        </TabsList>

        {/* KYC Tab */}
        <TabsContent value="kyc" className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <Select value={kycFilter} onValueChange={v => setKycFilter(v as KYCStatus | "ALL")}>
              <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="UNDER_REVIEW">Under Review</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
                <SelectItem value="EXPIRED">Expired</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{filteredKYC.length} records</span>
              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => refetchKyc()}>
                <RefreshCw className="w-3 h-3" />Refresh
              </Button>
            </div>
          </div>

          {filteredKYC.length === 0 ? (
            <div className="rounded-xl border border-border p-8 text-center text-muted-foreground text-sm">
              No KYC records found. Stakeholders who submit onboarding applications will appear here.
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="border-b border-border bg-secondary/50">
                      {["ID","Name","Email","Submitted","Status","Actions"].map(h => (
                        <th key={h} className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredKYC.map(k => {
                      const sc = KYC_STATUS_CONFIG[k.status as KYCStatus] ?? KYC_STATUS_CONFIG["PENDING"];
                      const StatusIcon = sc.icon;
                      return (
                        <tr key={k.id} className="hover:bg-secondary/30 transition-colors">
                          <td className="px-3 py-3 font-mono text-xs text-muted-foreground">#{k.id}</td>
                          <td className="px-3 py-3 font-semibold text-foreground text-sm">{k.userName ?? `User #${k.userId}`}</td>
                          <td className="px-3 py-3 text-xs text-muted-foreground">{k.userEmail ?? "—"}</td>
                          <td className="px-3 py-3 text-xs text-muted-foreground">{new Date(k.submittedAt).toLocaleDateString()}</td>
                          <td className="px-3 py-3">
                            <Badge className={"text-[10px] gap-1 " + sc.className}>
                              <StatusIcon className="w-3 h-3" />{sc.label}
                            </Badge>
                          </td>
                          <td className="px-3 py-3">
                            {(k.status === "PENDING" || k.status === "UNDER_REVIEW") && (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  className="h-7 text-xs bg-positive hover:bg-positive/90 text-white"
                                  disabled={decideKyc.isPending}
                                  onClick={() => setKycDecideDialog({ id: k.id, name: k.userName ?? `User #${k.userId}`, decision: "APPROVED" })}
                                >Approve</Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs text-negative border-negative/30 hover:bg-negative/10"
                                  disabled={decideKyc.isPending}
                                  onClick={() => setKycDecideDialog({ id: k.id, name: k.userName ?? `User #${k.userId}`, decision: "REJECTED" })}
                                >Reject</Button>
                              </div>
                            )}
                            {k.status === "APPROVED" && <span className="text-xs text-positive">✓ Approved</span>}
                            {k.status === "REJECTED" && <span className="text-xs text-negative">✗ Rejected</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>

        {/* AML Tab */}
        <TabsContent value="aml" className="mt-4">
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b border-border bg-secondary/50">
                    {["ID","Alert Type","Entity","Amount","Date","Risk","Status","Description","Actions"].map(h => (
                      <th key={h} className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {liveAmlAlerts.map(a => (
                    <tr key={a.id} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{a.id}</td>
                      <td className="px-3 py-3 text-sm font-semibold text-foreground">{a.alertType}</td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">{a.entity}</td>
                      <td className="px-3 py-3 font-mono text-xs">
                        {a.amount > 0 ? `${a.currency === "NGN" ? "₦" : "$"}${a.amount.toLocaleString()}` : "—"}
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">{a.date}</td>
                      <td className="px-3 py-3">
                        <span className={`text-xs font-semibold ${RISK_CONFIG[a.riskLevel]}`}>{a.riskLevel}</span>
                      </td>
                      <td className="px-3 py-3">
                        <Badge className={"text-[10px] " + AML_STATUS_CONFIG[a.status]}>{a.status}</Badge>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground max-w-[200px] truncate">{a.description}</td>
                      <td className="px-3 py-3">
                        {a.numericId && (a.status === "OPEN" || a.status === "INVESTIGATING") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={reviewAml.isPending}
                            onClick={() => setAmlReviewDialog({ id: a.numericId!, status: "ESCALATED", alertType: a.alertType })}
                          >Escalate</Button>
                        )}
                        {a.numericId && a.status === "ESCALATED" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-positive border-positive/30 hover:bg-positive/10"
                            disabled={reviewAml.isPending}
                            onClick={() => setAmlReviewDialog({ id: a.numericId!, status: "CLEARED", alertType: a.alertType })}
                          >Clear</Button>
                        )}
                        {!a.numericId && (
                          <span className="text-xs text-muted-foreground italic">Static data</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* Reports Tab */}
        <TabsContent value="reports" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => refetchReports()}>
              <RefreshCw className="w-3 h-3" />Refresh
            </Button>
          </div>
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  {["Report Type","Period","Regulator","Due Date","Submitted","File Size","Status",""].map(h => (
                    <th key={h} className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {liveReports.map(r => (
                  <tr key={r.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-3 py-3 font-semibold text-foreground text-sm">{r.reportType}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{r.period}</td>
                    <td className="px-3 py-3 text-xs font-semibold text-primary">{r.regulator}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{r.dueDate || "—"}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{r.submittedDate || "—"}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{r.fileSize}</td>
                    <td className="px-3 py-3">
                      <Badge className={`text-[10px] ${r.status === "SUBMITTED" || r.status === "READY" ? "badge-settled" : r.status === "OVERDUE" ? "badge-cancelled" : r.status === "GENERATING" ? "badge-pending" : "badge-pending"}`}>
                        {r.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      {(r.status === "SUBMITTED" || r.status === "READY") ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
          disabled={downloadReportId === r.numericId}
              onClick={() => r.numericId && setDownloadReportId(r.numericId)}
                        ><Download className="w-3 h-3" />Download</Button>
                      ) : (
                        <Button
                          size="sm"
                          className="h-7 text-xs bg-primary hover:bg-primary/90 text-white"
                          disabled={generateReport.isPending}
                          onClick={() => setGenerateDialog({ reportType: r.reportType })}
                        >Generate</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      {/* KYC Decision Dialog */}
      <Dialog open={!!kycDecideDialog} onOpenChange={open => { if (!open) { setKycDecideDialog(null); setKycNotes(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{kycDecideDialog?.decision === "APPROVED" ? "Approve" : "Reject"} KYC Application</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {kycDecideDialog?.decision === "APPROVED"
                ? `Approve KYC application for ${kycDecideDialog?.name}?`
                : `Reject KYC application for ${kycDecideDialog?.name}? Please provide a reason.`}
            </p>
            <Textarea
              placeholder="Review notes (optional for approval, recommended for rejection)"
              value={kycNotes}
              onChange={e => setKycNotes(e.target.value)}
              className="min-h-[80px]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setKycDecideDialog(null); setKycNotes(""); }}>Cancel</Button>
            <Button
              className={kycDecideDialog?.decision === "APPROVED" ? "bg-positive hover:bg-positive/90 text-white" : "bg-negative hover:bg-negative/90 text-white"}
              disabled={decideKyc.isPending}
              onClick={() => {
                if (!kycDecideDialog) return;
                decideKyc.mutate({ kycQueueId: kycDecideDialog.id, decision: kycDecideDialog.decision, reviewNotes: kycNotes || undefined });
              }}
            >
              {decideKyc.isPending ? "Processing…" : kycDecideDialog?.decision === "APPROVED" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AML Review Dialog */}
      <Dialog open={!!amlReviewDialog} onOpenChange={open => { if (!open) { setAmlReviewDialog(null); setAmlNotes(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{amlReviewDialog?.status === "ESCALATED" ? "Escalate" : "Clear"} AML Alert</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {amlReviewDialog?.status === "ESCALATED"
                ? `Escalate alert "${amlReviewDialog?.alertType}" to senior compliance officer?`
                : `Mark alert "${amlReviewDialog?.alertType}" as cleared?`}
            </p>
            <Textarea
              placeholder="Review notes (optional)"
              value={amlNotes}
              onChange={e => setAmlNotes(e.target.value)}
              className="min-h-[80px]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAmlReviewDialog(null); setAmlNotes(""); }}>Cancel</Button>
            <Button
              className={amlReviewDialog?.status === "ESCALATED" ? "bg-orange-500 hover:bg-orange-600 text-white" : "bg-positive hover:bg-positive/90 text-white"}
              disabled={reviewAml.isPending}
              onClick={() => {
                if (!amlReviewDialog) return;
                reviewAml.mutate({ flagId: amlReviewDialog.id, status: amlReviewDialog.status, reviewNotes: amlNotes || undefined });
              }}
            >
              {reviewAml.isPending ? "Processing…" : amlReviewDialog?.status === "ESCALATED" ? "Escalate" : "Clear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generate Report Dialog */}
      <Dialog open={!!generateDialog} onOpenChange={open => { if (!open) setGenerateDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generate Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">{generateDialog?.reportType}</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Period Start</label>
                <input
                  type="date"
                  value={generatePeriodStart}
                  onChange={e => setGeneratePeriodStart(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Period End</label>
                <input
                  type="date"
                  value={generatePeriodEnd}
                  onChange={e => setGeneratePeriodEnd(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateDialog(null)}>Cancel</Button>
            <Button
              className="bg-primary hover:bg-primary/90 text-white"
              disabled={generateReport.isPending}
              onClick={() => {
                if (!generateDialog) return;
                const reportTypeEnum = REPORT_TYPE_MAP[generateDialog.reportType] ?? "SEC_FILING";
                generateReport.mutate({
                  reportType: reportTypeEnum,
                  periodStart: new Date(generatePeriodStart),
                  periodEnd: new Date(generatePeriodEnd),
                  format: "CSV",
                });
              }}
            >
              {generateReport.isPending ? "Generating…" : "Generate Report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
