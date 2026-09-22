/**
 * NEXCOM Exchange — Admin KYB Review Panel (FIX-KYB)
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin-only queue for corporate (KYB) verification:
 *  - Summary stats + status/risk filters
 *  - Detail drawer: business info, CAC checklist, directors, UBOs (with ≥25%
 *    flags), screening results (OpenSanctions match scores, adverse media,
 *    UBO risk), document links, audit trail
 *  - Actions: approve / reject / escalate to EDD / suspend (post-approval)
 *
 * Fail-closed: applications in SCREENING with no completed screening show a
 * "screening pending" banner and cannot be approved (server enforces too).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
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
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  ShieldCheck,
  ShieldAlert,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Eye,
  RefreshCw,
  Building2,
  Ban,
  ExternalLink,
} from "lucide-react";

type KybStatus = "DRAFT" | "SUBMITTED" | "SCREENING" | "UNDER_REVIEW" | "EDD_REQUIRED" | "APPROVED" | "REJECTED" | "SUSPENDED";
type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "PROHIBITED";
type FilterStatus = KybStatus | "ALL";

const STATUS_CONFIG: Record<KybStatus, { label: string; color: string }> = {
  DRAFT:        { label: "Draft",        color: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
  SUBMITTED:    { label: "Submitted",    color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  SCREENING:    { label: "Screening",    color: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  UNDER_REVIEW: { label: "Under Review", color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  EDD_REQUIRED: { label: "EDD Required", color: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  APPROVED:     { label: "Approved",     color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  REJECTED:     { label: "Rejected",     color: "bg-red-500/15 text-red-400 border-red-500/30" },
  SUSPENDED:    { label: "Suspended",    color: "bg-red-500/15 text-red-400 border-red-500/30" },
};

const RISK_CONFIG: Record<RiskLevel, { color: string }> = {
  LOW:        { color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  MEDIUM:     { color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  HIGH:       { color: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  PROHIBITED: { color: "bg-red-500/15 text-red-400 border-red-500/30" },
};

const DOC_LABELS: Record<string, string> = {
  cacCertificateUrl: "CAC Certificate",
  memartUrl: "MEMART",
  statusReportUrl: "CAC Status Report",
  boardResolutionUrl: "Board Resolution",
  proofOfAddressUrl: "Proof of Address",
};

export default function AdminKybReview() {
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("ALL");
  const [riskFilter, setRiskFilter] = useState<RiskLevel | "ALL">("ALL");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [suspendReason, setSuspendReason] = useState("");

  const listQuery = trpc.kyb.adminListKybApplications.useQuery({
    status: statusFilter === "ALL" ? undefined : statusFilter,
    riskLevel: riskFilter === "ALL" ? undefined : riskFilter,
    limit: 50,
    offset: 0,
  });
  const detailQuery = trpc.kyb.adminGetKybApplication.useQuery(
    { applicationId: selectedId! },
    { enabled: selectedId !== null },
  );

  const reviewMutation = trpc.kyb.adminReviewKyb.useMutation();
  const eddMutation = trpc.kyb.escalateToEdd.useMutation();
  const suspendMutation = trpc.kyb.adminSuspendKyb.useMutation();
  const screeningMutation = trpc.kyb.requestScreening.useMutation();

  const refetchAll = () => { listQuery.refetch(); if (selectedId) detailQuery.refetch(); };

  async function decide(decision: "APPROVED" | "REJECTED" | "EDD_REQUIRED") {
    if (!selectedId) return;
    try {
      await reviewMutation.mutateAsync({
        applicationId: selectedId,
        decision,
        notes: notes || undefined,
        rejectionReason: decision === "REJECTED" ? rejectionReason || notes : undefined,
      });
      toast.success(`Application ${decision.replace(/_/g, " ")}`);
      setNotes(""); setRejectionReason("");
      refetchAll();
    } catch (e: any) {
      toast.error(e?.message ?? "Review failed");
    }
  }

  async function suspend() {
    if (!selectedId) return;
    if (suspendReason.trim().length < 5) { toast.error("Suspension reason (min 5 chars) is required"); return; }
    try {
      await suspendMutation.mutateAsync({ applicationId: selectedId, reason: suspendReason.trim() });
      toast.success("Application suspended and corporate tier revoked");
      setSuspendReason("");
      refetchAll();
    } catch (e: any) {
      toast.error(e?.message ?? "Suspension failed");
    }
  }

  async function retryScreening() {
    try {
      const res = await screeningMutation.mutateAsync();
      if (res.screeningCompleted) toast.success(`Screening complete — risk ${res.riskLevel}`);
      else toast.info("Screening service still unavailable");
      refetchAll();
    } catch (e: any) {
      toast.error(e?.message ?? "Screening request failed");
    }
  }

  if (listQuery.isLoading) {
    return <><PageSkeleton /></>;
  }

  const stats = listQuery.data?.stats;
  const detail = detailQuery.data;
  const app = detail?.application;
  const screening = (app?.screeningResult as any)?.screening;
  const cacVerification = (app?.screeningResult as any)?.cacVerification;
  const uboWarnings: string[] = (app?.screeningResult as any)?.uboWarnings ?? [];

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Building2 className="w-7 h-7 text-emerald-400" />
            <div>
              <h1 className="text-2xl font-bold">KYB Review Queue</h1>
              <p className="text-sm text-muted-foreground">Corporate verification — CAC, UBO and sanctions screening</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => listQuery.refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            {[
              { label: "Submitted", value: stats.submitted, icon: <Clock className="w-4 h-4 text-blue-400" /> },
              { label: "Screening", value: stats.screening, icon: <RefreshCw className="w-4 h-4 text-purple-400" /> },
              { label: "Under Review", value: stats.underReview, icon: <Eye className="w-4 h-4 text-yellow-400" /> },
              { label: "EDD", value: stats.eddRequired, icon: <AlertTriangle className="w-4 h-4 text-orange-400" /> },
              { label: "Approved", value: stats.approved, icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" /> },
              { label: "Rejected", value: stats.rejected, icon: <XCircle className="w-4 h-4 text-red-400" /> },
              { label: "Suspended", value: stats.suspended, icon: <Ban className="w-4 h-4 text-red-400" /> },
              { label: "High Risk", value: stats.highRisk, icon: <ShieldAlert className="w-4 h-4 text-orange-400" /> },
            ].map((s) => (
              <div key={s.label} className="bg-card border rounded-lg p-3 flex items-center gap-2">
                {s.icon}
                <div>
                  <div className="text-lg font-semibold leading-none">{s.value ?? 0}</div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as FilterStatus)}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {(Object.keys(STATUS_CONFIG) as KybStatus[]).map((s) => (
                <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={riskFilter} onValueChange={(v) => setRiskFilter(v as RiskLevel | "ALL")}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Risk" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All risk levels</SelectItem>
              {(Object.keys(RISK_CONFIG) as RiskLevel[]).map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Queue table */}
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3">Business</th>
                <th className="text-left p-3">CAC No.</th>
                <th className="text-left p-3">Applicant</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Risk</th>
                <th className="text-left p-3">Submitted</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {(listQuery.data?.applications ?? []).map((a) => (
                <tr key={a.id} className="border-t hover:bg-muted/30">
                  <td className="p-3">
                    <div className="font-medium">{a.businessName}</div>
                    <div className="text-xs text-muted-foreground">{a.businessType}</div>
                  </td>
                  <td className="p-3 font-mono text-xs">{a.cacRcNumber}</td>
                  <td className="p-3">
                    <div className="text-xs">{a.userName ?? `User #${a.userId}`}</div>
                    <div className="text-xs text-muted-foreground">{a.userEmail}</div>
                  </td>
                  <td className="p-3">
                    <Badge className={STATUS_CONFIG[a.status as KybStatus]?.color}>
                      {STATUS_CONFIG[a.status as KybStatus]?.label ?? a.status}
                    </Badge>
                    {a.status === "SCREENING" && !a.screeningCompletedAt && (
                      <div className="text-xs text-yellow-500 mt-1">screening pending</div>
                    )}
                  </td>
                  <td className="p-3">
                    {a.riskLevel
                      ? <Badge className={RISK_CONFIG[a.riskLevel as RiskLevel]?.color}>{a.riskLevel}</Badge>
                      : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleDateString()}</td>
                  <td className="p-3">
                    <Button size="sm" variant="outline" onClick={() => { setSelectedId(a.id); setNotes(""); setRejectionReason(""); setSuspendReason(""); }}>
                      <Eye className="w-4 h-4 mr-1" /> Review
                    </Button>
                  </td>
                </tr>
              ))}
              {(listQuery.data?.applications ?? []).length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No KYB applications match the filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Detail drawer */}
        <Dialog open={selectedId !== null} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                {app?.businessName ?? "KYB Application"}
                {app && <Badge className={STATUS_CONFIG[app.status as KybStatus]?.color}>{STATUS_CONFIG[app.status as KybStatus]?.label}</Badge>}
                {app?.riskLevel && <Badge className={RISK_CONFIG[app.riskLevel as RiskLevel]?.color}>{app.riskLevel}</Badge>}
              </DialogTitle>
            </DialogHeader>

            {detailQuery.isLoading && <div className="p-8 text-center text-muted-foreground">Loading…</div>}

            {app && (
              <div className="space-y-5 text-sm">
                {detail!.screeningPending && (
                  <div className="flex items-start justify-between gap-2 text-yellow-700 dark:text-yellow-300 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>Screening pending — the screening service has not returned a result. Approval is blocked (fail-closed).</span>
                    </div>
                    <Button size="sm" variant="outline" disabled={screeningMutation.isPending} onClick={retryScreening}>
                      {screeningMutation.isPending ? "Running…" : "Retry screening"}
                    </Button>
                  </div>
                )}

                {/* Business info */}
                <section>
                  <h3 className="font-semibold mb-2">Business</h3>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-muted-foreground">
                    <span>Type: <span className="text-foreground">{app.businessType}</span></span>
                    <span>CAC: <span className="text-foreground font-mono">{app.cacRcNumber}</span></span>
                    <span>TIN: <span className="text-foreground">{app.tinNumber ?? "—"}</span></span>
                    <span>Incorporated: <span className="text-foreground">{app.incorporationDate ? new Date(app.incorporationDate).toLocaleDateString() : "—"}</span></span>
                    <span className="col-span-2">Address: <span className="text-foreground">{app.registeredAddress}</span></span>
                    <span>Email: <span className="text-foreground">{app.contactEmail}</span></span>
                    <span>Phone: <span className="text-foreground">{app.contactPhone}</span></span>
                    {app.expectedMonthlyVolume && (
                      <span>Expected volume: <span className="text-foreground">₦{Number(app.expectedMonthlyVolume).toLocaleString()}/mo</span></span>
                    )}
                    {detail!.applicant && (
                      <span>Applicant: <span className="text-foreground">{detail!.applicant.name ?? `#${detail!.applicant.id}`} ({detail!.applicant.email})</span></span>
                    )}
                  </div>
                </section>

                {/* CAC verification checklist */}
                {cacVerification && (
                  <section>
                    <h3 className="font-semibold mb-2">CAC Verification ({cacVerification.provider}: {cacVerification.status.replace(/_/g, " ")})</h3>
                    {cacVerification.notes && <p className="text-xs text-muted-foreground mb-2">{cacVerification.notes}</p>}
                    <ul className="space-y-1">
                      {(cacVerification.checklist ?? []).map((c: any) => (
                        <li key={c.key} className="flex items-start gap-2">
                          {c.passed === true ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5" /> :
                           c.passed === false ? <XCircle className="w-4 h-4 text-red-500 mt-0.5" /> :
                           <Clock className="w-4 h-4 text-yellow-500 mt-0.5" />}
                          <div>
                            <div>{c.label}</div>
                            {c.detail && <div className="text-xs text-muted-foreground">{c.detail}</div>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {/* UBO warnings */}
                {uboWarnings.length > 0 && (
                  <section className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3">
                    <h3 className="font-semibold mb-1 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-orange-500" /> UBO warnings</h3>
                    <ul className="list-disc list-inside text-xs space-y-1">{uboWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  </section>
                )}

                {/* Directors */}
                <section>
                  <h3 className="font-semibold mb-2">Directors ({detail!.directors.length})</h3>
                  <div className="space-y-1">
                    {detail!.directors.map((d) => (
                      <div key={d.id} className="flex justify-between border rounded p-2">
                        <span>{d.fullName} <span className="text-xs text-muted-foreground">— {d.role}</span></span>
                        <span className="text-xs text-muted-foreground">{d.verificationStatus}</span>
                      </div>
                    ))}
                  </div>
                </section>

                {/* UBOs */}
                <section>
                  <h3 className="font-semibold mb-2">Beneficial Owners ({detail!.beneficialOwners.length})</h3>
                  <div className="space-y-1">
                    {detail!.beneficialOwners.map((o) => (
                      <div key={o.id} className="flex justify-between items-center border rounded p-2">
                        <span>
                          {o.fullName}
                          {o.isUbo && <Badge className="ml-2 bg-emerald-500/15 text-emerald-500 border-emerald-500/30">UBO ≥25%</Badge>}
                          {o.isPep && <Badge className="ml-2 bg-orange-500/15 text-orange-500 border-orange-500/30">PEP</Badge>}
                        </span>
                        <span className="text-xs">{Number(o.ownershipPercent)}% · {o.nationality}</span>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Screening results */}
                {screening && (
                  <section>
                    <h3 className="font-semibold mb-2 flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4" /> Screening — {screening.screeningSource} · recommendation:
                      <Badge className={
                        screening.recommendation === "APPROVE" ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" :
                        screening.recommendation === "REJECT" ? "bg-red-500/15 text-red-500 border-red-500/30" :
                        "bg-yellow-500/15 text-yellow-500 border-yellow-500/30"
                      }>{screening.recommendation}</Badge>
                    </h3>
                    <div className="grid grid-cols-4 gap-2 mb-2 text-xs">
                      {Object.entries(screening.checks ?? {}).map(([k, v]) => (
                        <div key={k} className={`border rounded p-2 text-center ${v ? "border-emerald-500/30" : "border-red-500/30"}`}>
                          {v ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto mb-1" /> : <XCircle className="w-4 h-4 text-red-500 mx-auto mb-1" />}
                          {k}
                        </div>
                      ))}
                    </div>
                    <div className="text-xs mb-2">Risk score: <strong>{(screening.riskScore * 100).toFixed(0)}%</strong></div>
                    {(screening.riskFactors ?? []).length > 0 && (
                      <ul className="list-disc list-inside text-xs text-muted-foreground mb-2">
                        {screening.riskFactors.map((f: string, i: number) => <li key={i}>{f}</li>)}
                      </ul>
                    )}
                    <h4 className="text-xs font-semibold mb-1">Sanctions / PEP matches (OpenSanctions scores)</h4>
                    <div className="space-y-1">
                      {(screening.matches ?? []).map((m: any, i: number) => (
                        <div key={i} className={`flex justify-between border rounded p-2 text-xs ${m.matched ? "border-red-500/40 bg-red-500/5" : ""}`}>
                          <span>{m.party}: {m.name}</span>
                          <span className={m.matched ? "text-red-500 font-semibold" : "text-muted-foreground"}>
                            score {(m.score ?? 0).toFixed(2)} {m.matched ? "MATCH" : "clear"}
                            {m.topics?.length ? ` · ${m.topics.join(", ")}` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Documents */}
                <section>
                  <h3 className="font-semibold mb-2">Documents</h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(app.documents ?? {}).filter(([, v]) => !!v).map(([k, v]) => (
                      <a key={k} href={v as string} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 border rounded px-2 py-1 text-xs hover:bg-muted">
                        <ExternalLink className="w-3 h-3" /> {DOC_LABELS[k] ?? k}
                      </a>
                    ))}
                    {Object.values(app.documents ?? {}).filter(Boolean).length === 0 && (
                      <span className="text-xs text-muted-foreground">No documents uploaded.</span>
                    )}
                  </div>
                </section>

                {/* Audit trail */}
                <section>
                  <h3 className="font-semibold mb-2">Audit trail</h3>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {detail!.auditTrail.map((t) => (
                      <div key={t.id} className="text-xs flex justify-between border rounded p-2">
                        <span>{t.action.replace(/_/g, " ")}{t.notes ? ` — ${t.notes}` : ""}</span>
                        <span className="text-muted-foreground">{new Date(t.createdAt).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Actions */}
                <section className="space-y-3 border-t pt-4">
                  <Textarea placeholder="Review notes (required for rejection)…" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  {app.status !== "APPROVED" && app.status !== "SUSPENDED" && (
                    <DialogFooter className="gap-2 sm:justify-end">
                      <Button variant="outline" disabled={reviewMutation.isPending}
                        onClick={() => decide("EDD_REQUIRED")}>
                        <AlertTriangle className="w-4 h-4 mr-1" /> Require EDD
                      </Button>
                      <Button variant="destructive" disabled={reviewMutation.isPending}
                        onClick={() => decide("REJECTED")}>
                        <XCircle className="w-4 h-4 mr-1" /> Reject
                      </Button>
                      <Button className="bg-emerald-600 hover:bg-emerald-500" disabled={reviewMutation.isPending || detail!.screeningPending}
                        onClick={() => decide("APPROVED")}>
                        <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                      </Button>
                    </DialogFooter>
                  )}
                  {app.status === "APPROVED" && (
                    <div className="flex items-center gap-2">
                      <Input placeholder="Suspension reason (e.g. new adverse media hit)…" value={suspendReason}
                        onChange={(e) => setSuspendReason(e.target.value)} />
                      <Button variant="destructive" disabled={suspendMutation.isPending} onClick={suspend}>
                        <Ban className="w-4 h-4 mr-1" /> Suspend
                      </Button>
                    </div>
                  )}
                </section>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
