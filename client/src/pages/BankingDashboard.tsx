import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Wallet,
  TrendingUp,
  AlertCircle,
  ArrowUpRight,
  ArrowDownLeft,
  Shield,
  FileText,
  RefreshCw,
  ChevronRight,
  Banknote,
  Calendar,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, currency = "NGN") {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function LoanStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    APPLIED: { label: "Applied", variant: "secondary" },
    APPROVED: { label: "Approved", variant: "default" },
    DISBURSED: { label: "Disbursed", variant: "default" },
    OVERDUE: { label: "Overdue", variant: "destructive" },
    REPAID: { label: "Repaid", variant: "outline" },
    REJECTED: { label: "Rejected", variant: "destructive" },
  };
  const cfg = map[status] ?? { label: status, variant: "secondary" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

// ─── Crop Insurance Form ──────────────────────────────────────────────────────

function CropInsuranceForm({ onSuccess }: { onSuccess: () => void }) {
  const [form, setForm] = useState({
    cropType: "",
    seasonYear: new Date().getFullYear(),
    farmSizeHectares: "",
    estimatedYieldMt: "",
    estimatedValueNgn: "",
    coverageType: "MULTI_PERIL" as const,
    coveragePercent: 80,
    farmState: "",
    farmLga: "",
    irrigated: false,
    previousClaimsCount: 0,
    additionalNotes: "",
  });

  const apply = trpc.banking.applyForInsurance.useMutation({
    onSuccess: (data) => {
      toast.success("Insurance Application Submitted", { description: data.message });
      onSuccess();
    },
    onError: (err) => {
      toast.error("Error", { description: err.message });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    apply.mutate({
      cropType: form.cropType,
      seasonYear: form.seasonYear,
      farmSizeHectares: parseFloat(form.farmSizeHectares),
      estimatedYieldMt: parseFloat(form.estimatedYieldMt),
      estimatedValueNgn: parseFloat(form.estimatedValueNgn),
      coverageType: form.coverageType,
      coveragePercent: form.coveragePercent,
      farmState: form.farmState || undefined,
      farmLga: form.farmLga || undefined,
      irrigated: form.irrigated,
      previousClaimsCount: form.previousClaimsCount,
      additionalNotes: form.additionalNotes || undefined,
    });
  };

  // Premium estimate preview
  const baseRates: Record<string, number> = {
    YIELD_PROTECTION: 0.035,
    REVENUE_PROTECTION: 0.045,
    AREA_YIELD: 0.025,
    WEATHER_INDEX: 0.02,
    MULTI_PERIL: 0.055,
  };
  const estValue = parseFloat(form.estimatedValueNgn) || 0;
  const coverageAmount = estValue * (form.coveragePercent / 100);
  const premiumEstimate = coverageAmount * (baseRates[form.coverageType] ?? 0.04);
  const farmerPremium = premiumEstimate * 0.5; // 50% subsidy

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Crop Type *</Label>
          <Input
            placeholder="e.g. Ginger, Maize, Cocoa"
            value={form.cropType}
            onChange={(e) => setForm((f) => ({ ...f, cropType: e.target.value }))}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label>Season Year *</Label>
          <Input
            type="number"
            min={2020}
            max={2035}
            value={form.seasonYear}
            onChange={(e) => setForm((f) => ({ ...f, seasonYear: parseInt(e.target.value) }))}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label>Farm Size (hectares) *</Label>
          <Input
            type="number"
            step="0.1"
            min="0.1"
            placeholder="e.g. 2.5"
            value={form.farmSizeHectares}
            onChange={(e) => setForm((f) => ({ ...f, farmSizeHectares: e.target.value }))}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label>Estimated Yield (MT) *</Label>
          <Input
            type="number"
            step="0.1"
            min="0.1"
            placeholder="e.g. 5.0"
            value={form.estimatedYieldMt}
            onChange={(e) => setForm((f) => ({ ...f, estimatedYieldMt: e.target.value }))}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label>Estimated Value (₦) *</Label>
          <Input
            type="number"
            min="1000"
            placeholder="e.g. 1500000"
            value={form.estimatedValueNgn}
            onChange={(e) => setForm((f) => ({ ...f, estimatedValueNgn: e.target.value }))}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label>Coverage Type *</Label>
          <Select
            value={form.coverageType}
            onValueChange={(v) => setForm((f) => ({ ...f, coverageType: v as typeof form.coverageType }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="YIELD_PROTECTION">Yield Protection</SelectItem>
              <SelectItem value="REVENUE_PROTECTION">Revenue Protection</SelectItem>
              <SelectItem value="AREA_YIELD">Area Yield</SelectItem>
              <SelectItem value="WEATHER_INDEX">Weather Index</SelectItem>
              <SelectItem value="MULTI_PERIL">Multi-Peril (Recommended)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Coverage % (50–100)</Label>
          <Input
            type="number"
            min={50}
            max={100}
            value={form.coveragePercent}
            onChange={(e) => setForm((f) => ({ ...f, coveragePercent: parseInt(e.target.value) }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>State</Label>
          <Input
            placeholder="e.g. Kaduna"
            value={form.farmState}
            onChange={(e) => setForm((f) => ({ ...f, farmState: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>LGA</Label>
          <Input
            placeholder="e.g. Zaria"
            value={form.farmLga}
            onChange={(e) => setForm((f) => ({ ...f, farmLga: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Previous Claims</Label>
          <Input
            type="number"
            min={0}
            value={form.previousClaimsCount}
            onChange={(e) => setForm((f) => ({ ...f, previousClaimsCount: parseInt(e.target.value) }))}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Additional Notes</Label>
        <Textarea
          placeholder="Any additional information about your farm or crop..."
          value={form.additionalNotes}
          onChange={(e) => setForm((f) => ({ ...f, additionalNotes: e.target.value }))}
          rows={2}
        />
      </div>

      {/* Premium Preview */}
      {estValue > 0 && (
        <div className="rounded-lg bg-muted/50 p-4 space-y-2 text-sm">
          <p className="font-semibold text-foreground">Premium Estimate (NAIC Scheme)</p>
          <div className="grid grid-cols-2 gap-2 text-muted-foreground">
            <span>Coverage Amount:</span>
            <span className="text-right font-medium text-foreground">{fmt(coverageAmount)}</span>
            <span>Total Premium:</span>
            <span className="text-right">{fmt(premiumEstimate)}</span>
            <span>Government Subsidy (50%):</span>
            <span className="text-right text-green-600">-{fmt(premiumEstimate * 0.5)}</span>
            <span className="font-semibold text-foreground">Your Premium:</span>
            <span className="text-right font-bold text-foreground">{fmt(farmerPremium)}/season</span>
          </div>
        </div>
      )}

      <Button type="submit" className="w-full" disabled={apply.isPending}>
        {apply.isPending ? "Submitting..." : "Submit Insurance Application"}
      </Button>
    </form>
  );
}

// ─── Transaction History ──────────────────────────────────────────────────────

function TransactionHistory({ accountId }: { accountId: string }) {
  const [limit] = useState(20);
  const { data, isLoading } = trpc.banking.getTransactions.useQuery({
    accountId,
    limit,
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  const txns = data?.transactions ?? [];
  if (txns.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground">
        <FileText className="mx-auto mb-2 h-8 w-8 opacity-40" />
        <p>No transactions found</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {txns.map((tx) => (
        <div
          key={tx.id}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors"
        >
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              tx.type === "CREDIT"
                ? "bg-green-100 text-green-600 dark:bg-green-900/30"
                : "bg-red-100 text-red-600 dark:bg-red-900/30"
            }`}
          >
            {tx.type === "CREDIT" ? (
              <ArrowDownLeft className="h-4 w-4" />
            ) : (
              <ArrowUpRight className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{tx.narrative}</p>
            <p className="text-xs text-muted-foreground">{fmtDate(tx.valueDate)} · {tx.reference}</p>
          </div>
          <div className="text-right shrink-0">
            <p
              className={`text-sm font-semibold ${
                tx.type === "CREDIT" ? "text-green-600" : "text-red-600"
              }`}
            >
              {tx.type === "CREDIT" ? "+" : "-"}
              {fmt(tx.amount)}
            </p>
            <p className="text-xs text-muted-foreground">Bal: {fmt(tx.balanceAfter)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Repayment Schedule ───────────────────────────────────────────────────────

function RepaymentSchedule({ loanId }: { loanId: number }) {
  const { data: schedule, isLoading } = trpc.banking.getRepaymentSchedule.useQuery({ loanId });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!schedule || schedule.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4">No schedule available</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-muted-foreground text-xs">
            <th className="py-2 text-left">#</th>
            <th className="py-2 text-left">Due Date</th>
            <th className="py-2 text-right">Principal</th>
            <th className="py-2 text-right">Interest</th>
            <th className="py-2 text-right">Total</th>
            <th className="py-2 text-right">Balance</th>
            <th className="py-2 text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          {schedule.map((row) => (
            <tr key={row.installment} className="border-b last:border-0 hover:bg-muted/30">
              <td className="py-2 text-muted-foreground">{row.installment}</td>
              <td className="py-2">{fmtDate(row.dueDate)}</td>
              <td className="py-2 text-right">{fmt(row.principal)}</td>
              <td className="py-2 text-right text-muted-foreground">{fmt(row.interest)}</td>
              <td className="py-2 text-right font-medium">{fmt(row.total)}</td>
              <td className="py-2 text-right text-muted-foreground">{fmt(row.balance)}</td>
              <td className="py-2 text-center">
                {row.status === "OVERDUE" ? (
                  <span className="inline-flex items-center gap-1 text-xs text-red-600">
                    <XCircle className="h-3 w-3" /> Overdue
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" /> Pending
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BankingDashboard() {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedLoanId, setSelectedLoanId] = useState<number | null>(null);
  const [insuranceOpen, setInsuranceOpen] = useState(false);

  const utils = trpc.useUtils();

  const { data: dashboard, isLoading: dashLoading } = trpc.banking.getDashboard.useQuery();
  const { data: loans, isLoading: loansLoading } = trpc.banking.listLoans.useQuery({ limit: 20 });
  const { data: insuranceApps } = trpc.banking.listInsuranceApplications.useQuery({ limit: 10 });

  const activeAccount = selectedAccountId
    ? dashboard?.accounts.find((a) => a.id === selectedAccountId)
    : dashboard?.accounts[0];

  return (
    <div className="container py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Banking Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Manage your accounts, loans, insurance, and transactions
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={insuranceOpen} onOpenChange={setInsuranceOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Shield className="h-4 w-4" />
                Apply for Insurance
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Crop Insurance Application</DialogTitle>
              </DialogHeader>
              <CropInsuranceForm
                onSuccess={() => {
                  setInsuranceOpen(false);
                  utils.banking.listInsuranceApplications.invalidate();
                }}
              />
            </DialogContent>
          </Dialog>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => utils.banking.getDashboard.invalidate()}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {dashLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30">
                  <Wallet className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Balance</p>
                  <p className="text-xl font-bold">{fmt(dashboard?.totalBalance ?? 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30">
                  <Banknote className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Active Loans</p>
                  <p className="text-xl font-bold">{dashboard?.activeLoans.length ?? 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/30">
                  <Calendar className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Upcoming Repayments</p>
                  <p className="text-xl font-bold">{dashboard?.upcomingRepayments.length ?? 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/30">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Insurance Apps</p>
                  <p className="text-xl font-bold">{insuranceApps?.length ?? 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Tabs */}
      <Tabs defaultValue="accounts">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="loans">Loans</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="insurance">Insurance</TabsTrigger>
        </TabsList>

        {/* ── Accounts Tab ── */}
        <TabsContent value="accounts" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(dashboard?.accounts ?? []).map((acct) => (
              <Card
                key={acct.id}
                className={`cursor-pointer transition-all ${
                  activeAccount?.id === acct.id ? "ring-2 ring-primary" : ""
                }`}
                onClick={() => setSelectedAccountId(acct.id)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{acct.label}</CardTitle>
                    <Badge variant={acct.status === "ACTIVE" ? "default" : "secondary"}>
                      {acct.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{acct.id}</p>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Balance</span>
                      <span className="font-semibold">{fmt(acct.balance)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Available</span>
                      <span className="text-green-600 font-medium">{fmt(acct.availBalance)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Currency</span>
                      <span>{acct.currency}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Upcoming Repayments */}
          {(dashboard?.upcomingRepayments ?? []).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  Upcoming Repayments
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {dashboard!.upcomingRepayments.map((r) => (
                    <div
                      key={r.loanId}
                      className="flex items-center justify-between rounded-lg bg-amber-50 dark:bg-amber-900/10 px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium">Loan #{r.loanId} — {r.loanType}</p>
                        <p className="text-xs text-muted-foreground">Due: {fmtDate(r.dueDate?.toString())}</p>
                      </div>
                      <span className="font-bold text-amber-700 dark:text-amber-400">
                        {fmt(parseFloat(String(r.amount ?? 0)))}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Loans Tab ── */}
        <TabsContent value="loans" className="mt-4">
          {loansLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : (loans?.loans ?? []).length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Banknote className="mx-auto mb-3 h-10 w-10 opacity-30" />
              <p className="font-medium">No loans found</p>
              <p className="text-sm mt-1">Apply for an input financing loan to get started</p>
              <Button variant="outline" className="mt-4" asChild>
                <a href="/input-financing">Apply for Input Loan</a>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {loans!.loans.map((loan) => (
                <Card key={loan.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">Loan #{loan.id}</span>
                          <LoanStatusBadge status={loan.status} />
                        </div>
                        <p className="text-xs text-muted-foreground capitalize">
                          {loan.inputType.replace(/_/g, " ")} · {loan.tenorMonths} months
                        </p>
                        <div className="flex gap-4 text-xs mt-1">
                          <span>
                            Requested:{" "}
                            <strong>{fmt(parseFloat(String(loan.requestedValueNgn ?? 0)))}</strong>
                          </span>
                          {loan.disbursedValueNgn && (
                            <span>
                              Disbursed:{" "}
                              <strong className="text-green-600">
                                {fmt(parseFloat(String(loan.disbursedValueNgn)))}
                              </strong>
                            </span>
                          )}
                          {loan.repaidValueNgn && parseFloat(String(loan.repaidValueNgn)) > 0 && (
                            <span>
                              Repaid:{" "}
                              <strong className="text-blue-600">
                                {fmt(parseFloat(String(loan.repaidValueNgn)))}
                              </strong>
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 shrink-0"
                        onClick={() =>
                          setSelectedLoanId(selectedLoanId === loan.id ? null : loan.id)
                        }
                      >
                        Schedule
                        <ChevronRight
                          className={`h-4 w-4 transition-transform ${
                            selectedLoanId === loan.id ? "rotate-90" : ""
                          }`}
                        />
                      </Button>
                    </div>

                    {selectedLoanId === loan.id && (
                      <div className="mt-4 border-t pt-4">
                        <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                          Repayment Schedule
                        </p>
                        <RepaymentSchedule loanId={loan.id} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Transactions Tab ── */}
        <TabsContent value="transactions" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Transaction History</CardTitle>
                <div className="flex gap-2">
                  {(dashboard?.accounts ?? []).map((a) => (
                    <Button
                      key={a.id}
                      variant={activeAccount?.id === a.id ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedAccountId(a.id)}
                    >
                      {a.label}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {activeAccount ? (
                <TransactionHistory accountId={activeAccount.id} />
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Select an account to view transactions
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Insurance Tab ── */}
        <TabsContent value="insurance" className="mt-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Your crop insurance applications under the NAIC scheme (50% government subsidy)
              </p>
              <Dialog open={insuranceOpen} onOpenChange={setInsuranceOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-2">
                    <Shield className="h-4 w-4" />
                    New Application
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Crop Insurance Application</DialogTitle>
                  </DialogHeader>
                  <CropInsuranceForm
                    onSuccess={() => {
                      setInsuranceOpen(false);
                      utils.banking.listInsuranceApplications.invalidate();
                    }}
                  />
                </DialogContent>
              </Dialog>
            </div>

            {(insuranceApps ?? []).length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Shield className="mx-auto mb-3 h-10 w-10 opacity-30" />
                <p className="font-medium">No insurance applications</p>
                <p className="text-sm mt-1">
                  Protect your harvest with NEXCOM crop insurance
                </p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => setInsuranceOpen(true)}
                >
                  Apply Now
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {insuranceApps!.map((app: Record<string, unknown>, i) => (
                  <Card key={String(app.applicationRef ?? i)}>
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">
                              {String(app.applicationRef ?? "—")}
                            </span>
                            <Badge variant="secondary">{String(app.status ?? "SUBMITTED")}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {String(app.cropType ?? "—")} · Season {String(app.seasonYear ?? "—")} ·{" "}
                            {String(app.coverageType ?? "—").replace(/_/g, " ")}
                          </p>
                          <div className="flex gap-4 text-xs mt-1">
                            <span>
                              Coverage:{" "}
                              <strong>
                                {fmt(parseFloat(String(app.coverageAmount ?? 0)))}
                              </strong>
                            </span>
                            <span>
                              Your Premium:{" "}
                              <strong className="text-amber-600">
                                {fmt(parseFloat(String(app.farmerPremium ?? 0)))}
                              </strong>
                            </span>
                          </div>
                        </div>
                        <div className="text-right text-xs text-muted-foreground shrink-0">
                          <p>Submitted</p>
                          <p>{fmtDate(String(app.submittedAt ?? ""))}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
