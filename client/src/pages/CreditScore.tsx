/**
 * NEXCOM Exchange — Credit Score & Collateral Registry
 * Displays the user's credit score, score history, collateral items,
 * repayment schedules, and crop insurance policies.
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  Shield, Package, Calendar, AlertCircle, CheckCircle2, Clock,
  Leaf, DollarSign, TrendingUp, FileText, Plus, RefreshCw, ChevronRight, ChevronLeft, Banknote
} from "lucide-react";

// ── Score colour helpers ──────────────────────────────────────────────────────
function scoreColor(score: number) {
  if (score >= 750) return "text-emerald-400";
  if (score >= 650) return "text-yellow-400";
  if (score >= 550) return "text-orange-400";
  return "text-red-400";
}
function scoreLabel(score: number) {
  if (score >= 750) return "Excellent";
  if (score >= 650) return "Good";
  if (score >= 550) return "Fair";
  return "Poor";
}
function scoreBadgeVariant(score: number): "default" | "secondary" | "destructive" | "outline" {
  if (score >= 750) return "default";
  if (score >= 650) return "secondary";
  return "destructive";
}

// ── Collateral status badge ───────────────────────────────────────────────────
function collateralBadge(status: string) {
  const map: Record<string, string> = {
    REGISTERED: "bg-blue-500/20 text-blue-300",
    PLEDGED: "bg-purple-500/20 text-purple-300",
    RELEASED: "bg-gray-500/20 text-muted-foreground",
    LIQUIDATED: "bg-red-500/20 text-red-300",
    EXPIRED: "bg-orange-500/20 text-orange-300",
  };
  return map[status] ?? "bg-gray-500/20 text-muted-foreground";
}

// ── Instalment status icon ────────────────────────────────────────────────────
function instalmentIcon(status: string) {
  if (status === "PAID") return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (status === "OVERDUE") return <AlertCircle className="h-4 w-4 text-red-400" />;
  return <Clock className="h-4 w-4 text-yellow-400" />;
}

// ── Register Collateral Dialog ────────────────────────────────────────────────
function RegisterCollateralDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    type: "WAREHOUSE_RECEIPT" as const,
    description: "",
    valuationNgn: "",
    registryRef: "",
    notes: "",
  });

  const registerMut = trpc.credit.registerCollateral.useMutation({
    onSuccess: () => {
      toast.success("Collateral registered successfully");
      setOpen(false);
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="h-4 w-4" /> Register Collateral
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Register New Collateral</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1">
            <Label>Asset Type</Label>
            <Select value={form.type} onValueChange={(v) => setForm(f => ({ ...f, type: v as typeof form.type }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="WAREHOUSE_RECEIPT">Warehouse Receipt</SelectItem>
                <SelectItem value="LAND_TITLE">Land Title</SelectItem>
                <SelectItem value="VEHICLE">Vehicle</SelectItem>
                <SelectItem value="EQUIPMENT">Equipment</SelectItem>
                <SelectItem value="LIVESTOCK">Livestock</SelectItem>
                <SelectItem value="CROP_STANDING">Standing Crop</SelectItem>
                <SelectItem value="BANK_GUARANTEE">Bank Guarantee</SelectItem>
                <SelectItem value="CASH_DEPOSIT">Cash Deposit</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Registry Reference</Label>
            <Input placeholder="e.g. REG-2026-001234" value={form.registryRef}
              onChange={e => setForm(f => ({ ...f, registryRef: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Description (min 10 chars)</Label>
            <Input placeholder="Detailed description of the asset" value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Estimated Value (NGN)</Label>
            <Input type="number" placeholder="0.00" value={form.valuationNgn}
              onChange={e => setForm(f => ({ ...f, valuationNgn: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Notes (optional)</Label>
            <Input placeholder="Additional notes" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <Button className="w-full" disabled={registerMut.isPending}
            onClick={() => registerMut.mutate({
              type: form.type,
              description: form.description,
              valuationNgn: Number(form.valuationNgn),
              registryRef: form.registryRef,
              notes: form.notes || undefined,
            })}>
            {registerMut.isPending ? "Registering…" : "Register Collateral"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Loan Application Wizard ──────────────────────────────────────────────────
const LOAN_PURPOSES = [
  "CROP_INPUTS", "EQUIPMENT_PURCHASE", "IRRIGATION", "STORAGE_FACILITY",
  "LIVESTOCK", "PROCESSING", "WORKING_CAPITAL", "OTHER"
];

function LoanApplicationWizard({ onSuccess }: { onSuccess: () => void }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    requestedValueNgn: "",
    purpose: "CROP_INPUTS",
    tenorMonths: "12",
    collateralRef: "",
    businessDesc: "",
    expectedRevenue: "",
    repaymentSource: "",
  });

  const applyMut = trpc.inputFinancing.applyForLoan.useMutation({
    onSuccess: () => {
      toast.success("Loan application submitted successfully! We will review it within 2 business days.");
      onSuccess();
      setStep(1);
      setForm({ requestedValueNgn: "", purpose: "CROP_INPUTS", tenorMonths: "12", collateralRef: "", businessDesc: "", expectedRevenue: "", repaymentSource: "" });
    },
    onError: (e) => toast.error(e.message),
  });

  const steps = [
    { title: "Loan Details", icon: DollarSign },
    { title: "Business Info", icon: FileText },
    { title: "Review & Submit", icon: CheckCircle2 },
  ];

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-4">
        <CardTitle className="text-base flex items-center gap-2">
          <Banknote className="h-5 w-5 text-primary" /> Apply for Input Financing
        </CardTitle>
        <CardDescription>Multi-step loan application — funds disbursed within 5 business days upon approval</CardDescription>
        {/* Step indicator */}
        <div className="flex items-center gap-2 pt-2">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-colors ${
                step > i + 1 ? "bg-emerald-500 text-white" : step === i + 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}>{step > i + 1 ? <CheckCircle2 className="h-4 w-4" /> : i + 1}</div>
              <span className={`text-xs ${step === i + 1 ? "text-foreground font-medium" : "text-muted-foreground"}`}>{s.title}</span>
              {i < steps.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
            </div>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Loan Amount (NGN) *</Label>
                <Input type="number" placeholder="e.g. 500000" value={form.requestedValueNgn}
                  onChange={e => setForm(f => ({ ...f, requestedValueNgn: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Tenor (months) *</Label>
                <Select value={form.tenorMonths} onValueChange={v => setForm(f => ({ ...f, tenorMonths: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[3, 6, 9, 12, 18, 24, 36].map(m => (
                      <SelectItem key={m} value={String(m)}>{m} months</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Loan Purpose *</Label>
              <Select value={form.purpose} onValueChange={v => setForm(f => ({ ...f, purpose: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LOAN_PURPOSES.map(p => (
                    <SelectItem key={p} value={p}>{p.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Collateral Reference (optional)</Label>
              <Input placeholder="e.g. REG-2026-001234" value={form.collateralRef}
                onChange={e => setForm(f => ({ ...f, collateralRef: e.target.value }))} />
              <p className="text-xs text-muted-foreground">Link a registered collateral asset to strengthen your application</p>
            </div>
            <Button className="w-full" onClick={() => setStep(2)} disabled={!form.requestedValueNgn || !form.purpose}>
              Continue <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Business Description *</Label>
              <Textarea placeholder="Describe your farming/trading business, crops grown, market access, etc." value={form.businessDesc}
                onChange={e => setForm(f => ({ ...f, businessDesc: e.target.value }))} rows={3} />
            </div>
            <div className="space-y-1">
              <Label>Expected Revenue (NGN)</Label>
              <Input type="number" placeholder="Projected income for the loan period" value={form.expectedRevenue}
                onChange={e => setForm(f => ({ ...f, expectedRevenue: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Repayment Source *</Label>
              <Input placeholder="e.g. Maize harvest proceeds, warehouse receipt sale" value={form.repaymentSource}
                onChange={e => setForm(f => ({ ...f, repaymentSource: e.target.value }))} />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button className="flex-1" onClick={() => setStep(3)} disabled={!form.businessDesc || !form.repaymentSource}>
                Review <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="bg-muted/30 rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Application Summary</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Amount:</span> <span className="font-medium">NGN {Number(form.requestedValueNgn).toLocaleString()}</span></div>
                <div><span className="text-muted-foreground">Tenor:</span> <span className="font-medium">{form.tenorMonths} months</span></div>
                <div><span className="text-muted-foreground">Purpose:</span> <span className="font-medium">{form.purpose.replace(/_/g, " ")}</span></div>
                {form.collateralRef && <div><span className="text-muted-foreground">Collateral:</span> <span className="font-medium">{form.collateralRef}</span></div>}
                <div className="col-span-2"><span className="text-muted-foreground">Repayment:</span> <span className="font-medium">{form.repaymentSource}</span></div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              By submitting, you confirm that all information is accurate. False declarations may result in application rejection and account suspension.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(2)}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button className="flex-1" disabled={applyMut.isPending}
                onClick={() => applyMut.mutate({
                  inputType: "CASH",
                  inputDescription: `${form.purpose.replace(/_/g, " ")} — ${form.businessDesc}`.slice(0, 500),
                  requestedValueNgn: form.requestedValueNgn,
                  tenorMonths: Number(form.tenorMonths),
                  notes: form.repaymentSource ? `Repayment source: ${form.repaymentSource}` : undefined,
                })}>
                {applyMut.isPending ? "Submitting…" : "Submit Application"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CreditScore() {
  const utils = trpc.useUtils();

  const { data: scoreData, isLoading: scoreLoading } = trpc.credit.getMyScore.useQuery();
  const { data: historyData } = trpc.credit.getScoreHistory.useQuery({ limit: 12 });
  const { data: collateralData, refetch: refetchCollateral } = trpc.credit.listMyCollateral.useQuery({ limit: 20 });
  const { data: insuranceData } = trpc.credit.listMyInsurancePolicies.useQuery({ limit: 10 });

  const markPaidMut = trpc.credit.markInstallmentPaid.useMutation({
    onSuccess: () => {
      toast.success("Instalment payment recorded");
      utils.credit.getRepaymentSchedule.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const score = scoreData?.score ?? 0;
  const scorePercent = Math.min(100, Math.max(0, ((score - 300) / (900 - 300)) * 100));

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Credit Score & Collateral</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Your credit profile, registered assets, and repayment history
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-2"
            onClick={() => utils.credit.getMyScore.invalidate()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>

        {/* Score Card + Factors */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="md:col-span-1 bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Shield className="h-4 w-4" /> Credit Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              {scoreLoading ? (
                <div className="h-24 flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
              ) : scoreData ? (
                <div className="space-y-3">
                  <div className={`text-5xl font-bold ${scoreColor(score)}`}>{score}</div>
                  <div className="flex items-center gap-2">
                    <Badge variant={scoreBadgeVariant(score)}>{scoreLabel(score)}</Badge>
                    <span className="text-xs text-muted-foreground">{scoreData.band}</span>
                  </div>
                  <Progress value={scorePercent} className="h-2" />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>300 (Poor)</span>
                    <span>900 (Excellent)</span>
                  </div>
                  {scoreData.maxLoanNgn && (
                    <div className="pt-1 border-t border-border">
                      <p className="text-xs text-muted-foreground">Max Loan Eligible</p>
                      <p className="text-sm font-semibold text-foreground">
                        NGN {Number(scoreData.maxLoanNgn).toLocaleString()}
                      </p>
                    </div>
                  )}
                  {scoreData.interestRatePct && (
                    <div>
                      <p className="text-xs text-muted-foreground">Indicative Rate</p>
                      <p className="text-sm font-semibold text-foreground">{scoreData.interestRatePct}% p.a.</p>
                    </div>
                  )}
                  {scoreData.validUntil && (
                    <p className="text-xs text-muted-foreground">
                      Valid until {new Date(scoreData.validUntil).toLocaleDateString()}
                    </p>
                  )}
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  <Shield className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No credit score yet</p>
                  <p className="text-xs mt-1">Complete your KYC and first transaction to build your score</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Score factors */}
          <Card className="md:col-span-2 bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Score Factors</CardTitle>
            </CardHeader>
            <CardContent>
              {scoreData?.factors && typeof scoreData.factors === "object" ? (
                <div className="space-y-3">
                  {Object.entries(scoreData.factors as Record<string, number>).map(([key, val]) => (
                    <div key={key} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="capitalize text-foreground">{key.replace(/_/g, " ")}</span>
                        <span className={val >= 70 ? "text-emerald-400" : val >= 40 ? "text-yellow-400" : "text-red-400"}>
                          {val}/100
                        </span>
                      </div>
                      <Progress value={val} className="h-1.5" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: "Payment History", icon: CheckCircle2, desc: "On-time repayments" },
                    { label: "Credit Utilisation", icon: DollarSign, desc: "Outstanding vs limit" },
                    { label: "Trade Activity", icon: TrendingUp, desc: "Exchange transactions" },
                    { label: "Collateral Value", icon: Package, desc: "Registered assets" },
                  ].map(f => (
                    <div key={f.label} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                      <f.icon className="h-5 w-5 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-foreground">{f.label}</p>
                        <p className="text-xs text-muted-foreground">{f.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Score History Bar Chart */}
        {historyData && historyData.length > 0 && (
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Score History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-1 h-24">
                {[...historyData].reverse().map((h: { score: number; createdAt: string | Date }, i: number) => {
                  const pct = Math.min(100, Math.max(5, ((h.score - 300) / 600) * 100));
                  const isLast = i === historyData.length - 1;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1"
                      title={`${h.score} — ${new Date(h.createdAt).toLocaleDateString()}`}>
                      <div
                        className={`w-full rounded-t transition-all ${isLast ? "bg-primary" : "bg-muted"}`}
                        style={{ height: `${pct}%` }}
                      />
                      {isLast && <span className="text-xs text-primary font-bold">{h.score}</span>}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-2">Last {historyData.length} score updates (oldest → newest)</p>
            </CardContent>
          </Card>
        )}

        {/* Tabs: Collateral | Repayment | Insurance | Apply */}
        <Tabs defaultValue="collateral">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="collateral">Collateral Registry</TabsTrigger>
            <TabsTrigger value="repayment">Repayment Schedule</TabsTrigger>
            <TabsTrigger value="insurance">Crop Insurance</TabsTrigger>
            <TabsTrigger value="apply">Apply for Loan</TabsTrigger>
          </TabsList>

          {/* ── Collateral Tab ── */}
          <TabsContent value="collateral" className="mt-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Registered Collateral</CardTitle>
                  <CardDescription>Assets pledged or available for financing</CardDescription>
                </div>
                <RegisterCollateralDialog onSuccess={() => refetchCollateral()} />
              </CardHeader>
              <CardContent>
                {collateralData && (collateralData as Array<{ id: number; type: string; registryRef: string; description: string; valuationNgn: string; status: string; createdAt: string | Date }>).length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Asset Type</TableHead>
                        <TableHead>Registry Ref</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Valuation (NGN)</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Registered</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(collateralData as Array<{ id: number; type: string; registryRef: string; description: string; valuationNgn: string; status: string; createdAt: string | Date }>).map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Package className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm">{item.type.replace(/_/g, " ")}</span>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{item.registryRef}</TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                            {item.description}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {Number(item.valuationNgn).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${collateralBadge(item.status)}`}>
                              {item.status}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(item.createdAt).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Package className="h-12 w-12 mx-auto mb-3 opacity-20" />
                    <p className="text-sm font-medium">No collateral registered</p>
                    <p className="text-xs mt-1">Register assets to improve your credit profile and access financing</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Repayment Tab ── */}
          <TabsContent value="repayment" className="mt-4">
            <RepaymentTab markPaidMut={markPaidMut} />
          </TabsContent>

          {/* ── Loan Application Tab ── */}
          <TabsContent value="apply" className="mt-4">
            <LoanApplicationWizard onSuccess={() => {
              utils.credit.getMyScore.invalidate();
              utils.inputFinancing.myLoans.invalidate();
            }} />
          </TabsContent>

          {/* ── Insurance Tab ── */}
          <TabsContent value="insurance" className="mt-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Crop Insurance Policies</CardTitle>
                <CardDescription>Active and historical crop insurance coverage</CardDescription>
              </CardHeader>
              <CardContent>
                {insuranceData && (insuranceData as Array<{ id: number; policyRef: string; cropType: string; coverageType: string; sumInsuredNgn: string; premiumNgn: string; status: string; endDate?: string | Date | null }>).length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Policy Ref</TableHead>
                        <TableHead>Crop Type</TableHead>
                        <TableHead>Coverage Type</TableHead>
                        <TableHead className="text-right">Sum Insured (NGN)</TableHead>
                        <TableHead className="text-right">Premium (NGN)</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Expires</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(insuranceData as Array<{ id: number; policyRef: string; cropType: string; coverageType: string; sumInsuredNgn: string; premiumNgn: string; status: string; endDate?: string | Date | null }>).map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-xs">{p.policyRef}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Leaf className="h-4 w-4 text-emerald-400" />
                              <span className="text-sm capitalize">{p.cropType}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {p.coverageType.replace(/_/g, " ")}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {Number(p.sumInsuredNgn).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {Number(p.premiumNgn).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <Badge variant={p.status === "ACTIVE" ? "default" : "secondary"}>
                              {p.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {p.endDate ? new Date(p.endDate).toLocaleDateString() : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Leaf className="h-12 w-12 mx-auto mb-3 opacity-20" />
                    <p className="text-sm font-medium">No insurance policies</p>
                    <p className="text-xs mt-1">Apply for crop insurance through the Banking Dashboard</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

// ── Repayment Tab Sub-Component ───────────────────────────────────────────────
function RepaymentTab({
  markPaidMut,
}: {
  markPaidMut: ReturnType<typeof trpc.credit.markInstallmentPaid.useMutation>;
}) {
  const [loanId, setLoanId] = useState<number | null>(null);
  const { data: scheduleData } = trpc.credit.getRepaymentSchedule.useQuery(
    { loanId: loanId! },
    { enabled: loanId !== null }
  );

  type Instalment = {
    id: number;
    installmentNo: number;
    dueDate: string | Date;
    principalNgn: string;
    interestNgn: string;
    totalNgn: string;
    paidNgn: string | null;
    status: string;
    paidAt?: string | Date | null;
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Repayment Schedule</CardTitle>
        <CardDescription>View instalment schedule for a specific loan</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-3 items-center">
          <Input
            type="number"
            placeholder="Enter Loan ID"
            className="max-w-[200px]"
            onChange={e => setLoanId(e.target.value ? Number(e.target.value) : null)}
          />
          <span className="text-xs text-muted-foreground">Enter the loan ID from your loan agreement</span>
        </div>
        {scheduleData && (scheduleData as Instalment[]).length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead className="text-right">Principal</TableHead>
                <TableHead className="text-right">Interest</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(scheduleData as Instalment[]).map((inst) => (
                <TableRow key={inst.id}>
                  <TableCell className="text-muted-foreground">{inst.installmentNo}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{new Date(inst.dueDate).toLocaleDateString()}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{Number(inst.principalNgn).toLocaleString()}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{Number(inst.interestNgn).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-medium">{Number(inst.totalNgn).toLocaleString()}</TableCell>
                  <TableCell className="text-right text-emerald-400">{Number(inst.paidNgn ?? 0).toLocaleString()}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {instalmentIcon(inst.status)}
                      <span className="text-sm">{inst.status}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {(inst.status === "SCHEDULED" || inst.status === "DUE" || inst.status === "OVERDUE") && (
                      <Button size="sm" variant="outline"
                        disabled={markPaidMut.isPending}
                        onClick={() => markPaidMut.mutate({
                          id: inst.id,
                          paidNgn: Number(inst.totalNgn),
                          paymentRef: `PAY-${inst.id}-${Date.now()}`,
                        })}>
                        Mark Paid
                      </Button>
                    )}
                    {inst.paidAt && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(inst.paidAt).toLocaleDateString()}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : loanId ? (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-2 opacity-20" />
            <p className="text-sm">No repayment schedule found for loan #{loanId}</p>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Calendar className="h-10 w-10 mx-auto mb-2 opacity-20" />
            <p className="text-sm">Enter a loan ID to view its repayment schedule</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
