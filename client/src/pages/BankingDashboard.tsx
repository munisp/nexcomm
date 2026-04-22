import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
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
import { PageSkeleton } from "@/components/PageSkeleton";
  Wallet,
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
  PlusCircle,
  TrendingUp,
  Award,
  BarChart3,
  Users,
  AlertTriangle,
  DollarSign,
  Search,
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

// ─── Loan Application Form ────────────────────────────────────────────────────

function LoanApplicationForm({ onSuccess }: { onSuccess: () => void }) {
  const [form, setForm] = useState({
    inputType: "SEEDS" as "SEEDS" | "FERTILIZER" | "PESTICIDE" | "HERBICIDE" | "EQUIPMENT" | "IRRIGATION" | "STORAGE" | "CASH",
    inputDescription: "",
    requestedValueNgn: "",
    tenorMonths: 6,
    repaymentMethod: "HARVEST_DEDUCTION" as "HARVEST_DEDUCTION" | "MONTHLY" | "LUMP_SUM",
    notes: "",
  });

  const applyLoan = trpc.banking.applyLoan.useMutation({
    onSuccess: (data) => {
      toast.success("Loan Application Submitted", {
        description: `Your loan application #${data.loanId} has been received and is under review.`,
      });
      onSuccess();
    },
    onError: (err) => {
      toast.error("Application Failed", { description: err.message });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.requestedValueNgn || parseFloat(form.requestedValueNgn) <= 0) {
      toast.error("Please enter a valid loan amount.");
      return;
    }
    applyLoan.mutate({
      inputType: form.inputType,
      inputDescription: form.inputDescription,
      requestedValueNgn: parseFloat(form.requestedValueNgn),
      tenorMonths: form.tenorMonths,
      repaymentMethod: form.repaymentMethod,
      notes: form.notes || undefined,
    });
  };

  // Interest rate estimate
  const rateMap: Record<string, number> = {
    SEEDS: 0.09,
    FERTILIZER: 0.09,
    PESTICIDE: 0.10,
    HERBICIDE: 0.10,
    EQUIPMENT: 0.12,
    IRRIGATION: 0.11,
    STORAGE: 0.11,
    CASH: 0.14,
  };
  const principal = parseFloat(form.requestedValueNgn) || 0;
  const annualRate = rateMap[form.inputType] ?? 0.10;
  const monthlyRate = annualRate / 12;
  const totalInterest = principal * monthlyRate * form.tenorMonths;
  const monthlyPayment = form.repaymentMethod === "MONTHLY" && form.tenorMonths > 0
    ? (principal + totalInterest) / form.tenorMonths
    : 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Input Type *</Label>
          <Select
            value={form.inputType}
            onValueChange={(v) => setForm((f) => ({ ...f, inputType: v as typeof form.inputType }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["SEEDS", "FERTILIZER", "PESTICIDE", "HERBICIDE", "EQUIPMENT", "IRRIGATION", "STORAGE", "CASH"] as const).map((t) => (
                <SelectItem key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Requested Amount (₦) *</Label>
          <Input
            type="number"
            min="10000"
            step="1000"
            placeholder="e.g. 500000"
            value={form.requestedValueNgn}
            onChange={(e) => setForm((f) => ({ ...f, requestedValueNgn: e.target.value }))}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label>Tenor (months) *</Label>
          <Input
            type="number"
            min={1}
            max={24}
            value={form.tenorMonths}
            onChange={(e) => setForm((f) => ({ ...f, tenorMonths: parseInt(e.target.value) || 6 }))}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label>Repayment Method *</Label>
          <Select
            value={form.repaymentMethod}
            onValueChange={(v) => setForm((f) => ({ ...f, repaymentMethod: v as typeof form.repaymentMethod }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="HARVEST_DEDUCTION">Harvest Deduction</SelectItem>
              <SelectItem value="MONTHLY">Monthly Installments</SelectItem>
              <SelectItem value="LUMP_SUM">Lump Sum at Maturity</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Description of Inputs Needed *</Label>
        <Textarea
          placeholder="Describe the agricultural inputs you need (minimum 10 characters)..."
          value={form.inputDescription}
          onChange={(e) => setForm((f) => ({ ...f, inputDescription: e.target.value }))}
          rows={3}
          required
        />
        <p className="text-xs text-muted-foreground">{form.inputDescription.length}/500 characters</p>
      </div>

      <div className="space-y-1.5">
        <Label>Additional Notes (optional)</Label>
        <Textarea
          placeholder="Any additional information to support your application..."
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          rows={2}
        />
      </div>

      {/* Loan Cost Preview */}
      {principal > 0 && (
        <div className="rounded-lg bg-muted/50 p-4 space-y-2 text-sm">
          <p className="font-semibold text-foreground">Loan Cost Estimate (NEXCOM Agri-Finance)</p>
          <div className="grid grid-cols-2 gap-2 text-muted-foreground">
            <span>Principal:</span>
            <span className="text-right font-medium text-foreground">{fmt(principal)}</span>
            <span>Annual Rate:</span>
            <span className="text-right">{(annualRate * 100).toFixed(0)}% p.a.</span>
            <span>Total Interest ({form.tenorMonths}mo):</span>
            <span className="text-right text-amber-600">{fmt(totalInterest)}</span>
            <span className="font-semibold text-foreground">Total Repayment:</span>
            <span className="text-right font-bold text-foreground">{fmt(principal + totalInterest)}</span>
            {form.repaymentMethod === "MONTHLY" && monthlyPayment > 0 && (
              <>
                <span>Monthly Payment:</span>
                <span className="text-right font-medium">{fmt(monthlyPayment)}</span>
              </>
            )}
          </div>
        </div>
      )}

      <Button type="submit" className="w-full" disabled={applyLoan.isPending}>
        {applyLoan.isPending ? "Submitting Application..." : "Submit Loan Application"}
      </Button>
    </form>
  );
}

// ─── Insurance Claim Form ─────────────────────────────────────────────────────

function InsuranceClaimForm({ policyId, onSuccess }: { policyId: number; onSuccess: () => void }) {
  const [form, setForm] = useState({
    lossType: "DROUGHT" as "DROUGHT" | "FLOOD" | "PEST" | "DISEASE" | "FIRE" | "THEFT" | "OTHER",
    affectedAreaHectares: "",
    estimatedLossNgn: "",
    incidentDate: "",
    description: "",
  });

  const submitClaim = trpc.banking.submitInsuranceClaim.useMutation({
    onSuccess: (data) => {
      toast.success("Claim Submitted", {
        description: `Your claim reference is ${data.claimRef}. Our team will review it within 5 business days.`,
      });
      onSuccess();
    },
    onError: (err) => {
      toast.error("Submission Failed", { description: err.message });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.description.length < 20) {
      toast.error("Please provide at least 20 characters in the description.");
      return;
    }
    submitClaim.mutate({
      policyId,
      lossType: form.lossType,
      affectedAreaHectares: parseFloat(form.affectedAreaHectares) || 0,
      estimatedLossNgn: parseFloat(form.estimatedLossNgn) || 0,
      incidentDate: form.incidentDate,
      description: form.description,
      evidenceUrls: [],
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Loss Type *</Label>
          <Select
            value={form.lossType}
            onValueChange={(v) => setForm((f) => ({ ...f, lossType: v as typeof form.lossType }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["DROUGHT", "FLOOD", "PEST", "DISEASE", "FIRE", "THEFT", "OTHER"] as const).map((t) => (
                <SelectItem key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Incident Date *</Label>
          <Input
            type="date"
            value={form.incidentDate}
            onChange={(e) => setForm((f) => ({ ...f, incidentDate: e.target.value }))}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label>Affected Area (hectares) *</Label>
          <Input
            type="number"
            min="0.1"
            step="0.1"
            placeholder="e.g. 1.5"
            value={form.affectedAreaHectares}
            onChange={(e) => setForm((f) => ({ ...f, affectedAreaHectares: e.target.value }))}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label>Estimated Loss (₦) *</Label>
          <Input
            type="number"
            min="1000"
            placeholder="e.g. 250000"
            value={form.estimatedLossNgn}
            onChange={(e) => setForm((f) => ({ ...f, estimatedLossNgn: e.target.value }))}
            required
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Description of Loss *</Label>
        <Textarea
          placeholder="Describe the incident and loss in detail (minimum 20 characters)..."
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          rows={4}
          required
        />
        <p className="text-xs text-muted-foreground">{form.description.length}/2000 characters</p>
      </div>
      <Button type="submit" className="w-full" disabled={submitClaim.isPending}>
        {submitClaim.isPending ? "Submitting Claim..." : "Submit Insurance Claim"}
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
        <FileText className="mx-auto mb-2 h-8 w-8 opacity-30" />
        <p className="text-sm">No transactions found</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {txns.map((txn) => {
        const isCredit = txn.type === "CREDIT";
        const amount = parseFloat(String(txn.amount ?? 0));
        return (
          <div
            key={txn.id}
            className="flex items-center justify-between rounded-lg border px-4 py-3 hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  isCredit
                    ? "bg-green-100 text-green-600 dark:bg-green-900/30"
                    : "bg-red-100 text-red-600 dark:bg-red-900/30"
                }`}
              >
                {isCredit ? (
                  <ArrowDownLeft className="h-4 w-4" />
                ) : (
                  <ArrowUpRight className="h-4 w-4" />
                )}
              </div>
              <div>
                <p className="text-sm font-medium">{txn.narrative ?? txn.type}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(txn.valueDate)}</p>
              </div>
            </div>
            <span
              className={`font-semibold ${
                isCredit ? "text-green-600" : "text-red-600"
              }`}
            >
              {isCredit ? "+" : "-"}
              {fmt(amount)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Repayment Schedule ───────────────────────────────────────────────────────

function RepaymentSchedule({ loanId }: { loanId: number }) {
  const { data, isLoading } = trpc.banking.getRepaymentSchedule.useQuery({ loanId });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  const schedule = (Array.isArray(data) ? data : []) as Array<{ installment: number; dueDate: string; principal: number; interest: number; total: number; balance: number; status: string }>;
  if (schedule.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No repayment schedule available yet
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {schedule.map((item, i) => {
        const isPaid = item.status === "PAID";
        const isOverdue = item.status === "OVERDUE";
        return (
          <div
            key={i}
            className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
              isPaid
                ? "bg-green-50 dark:bg-green-900/10"
                : isOverdue
                ? "bg-red-50 dark:bg-red-900/10"
                : "bg-muted/30"
            }`}
          >
            <div className="flex items-center gap-2">
              {isPaid ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : isOverdue ? (
                <XCircle className="h-4 w-4 text-red-500" />
              ) : (
                <Clock className="h-4 w-4 text-muted-foreground" />
              )}
              <span>
                Installment {i + 1} — Due {fmtDate(item.dueDate)}
              </span>
            </div>
            <span className="font-medium">
              {fmt(item.total)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BankingDashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedLoanId, setSelectedLoanId] = useState<number | null>(null);
  const [insuranceOpen, setInsuranceOpen] = useState(false);
  const [loanApplyOpen, setLoanApplyOpen] = useState(false);
  const [claimPolicyId, setClaimPolicyId] = useState<number | null>(null);
  const [adminLoanSearch, setAdminLoanSearch] = useState("");
  const [adminLoanStatus, setAdminLoanStatus] = useState("all");
  const [adminLoanPage, setAdminLoanPage] = useState(1);
  const [repayLoanId, setRepayLoanId] = useState<number | null>(null);
  const [repayAmount, setRepayAmount] = useState("");

  const utils = trpc.useUtils();

  const { data: dashboard, isLoading: dashLoading } = trpc.banking.getDashboard.useQuery();
  const { data: loans, isLoading: loansLoading } = trpc.banking.listLoans.useQuery({ limit: 20 });
  const { data: insuranceApps } = trpc.banking.listInsuranceApplications.useQuery({ limit: 10 });
  const { data: creditScore } = trpc.banking.getCreditScore.useQuery();
  const { data: adminLoans, isLoading: adminLoansLoading } = trpc.banking.adminListLoans.useQuery(
    { page: adminLoanPage, limit: 20, status: adminLoanStatus === "all" ? undefined : adminLoanStatus },
    { enabled: isAdmin }
  );
  const { data: portfolioStats } = trpc.banking.adminPortfolioStats.useQuery(undefined, { enabled: isAdmin });

  const creditCheck = trpc.banking.requestCreditCheck.useMutation({
    onSuccess: (d) => { toast.success(`Credit Score: ${d.score} (${d.band})`); utils.banking.getCreditScore.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const approveLoan = trpc.banking.adminApproveLoan.useMutation({
    onSuccess: () => { toast.success("Loan approved"); utils.banking.adminListLoans.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const disburseLoan = trpc.banking.adminDisburseLoan.useMutation({
    onSuccess: () => { toast.success("Loan disbursed"); utils.banking.adminListLoans.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const rejectLoan = trpc.banking.adminRejectLoan.useMutation({
    onSuccess: () => { toast.success("Loan rejected"); utils.banking.adminListLoans.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const markDefault = trpc.banking.adminMarkDefault.useMutation({
    onSuccess: () => { toast.success("Marked as default"); utils.banking.adminListLoans.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const makeRepayment = trpc.banking.makeRepayment.useMutation({
    onSuccess: (d) => { toast.success(`Repayment recorded. Status: ${d.newStatus}`); utils.banking.listLoans.invalidate(); setRepayLoanId(null); setRepayAmount(""); },
    onError: (e) => toast.error(e.message),
  });

  const activeAccount = selectedAccountId
    ? dashboard?.accounts.find((a) => a.id === selectedAccountId)
    : dashboard?.accounts[0];

  if (dashLoading) return <PageSkeleton cards={4} tableRows={6} tableCols={4} showChart />;
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
          {/* Apply for Loan */}
          <Dialog open={loanApplyOpen} onOpenChange={setLoanApplyOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Banknote className="h-4 w-4" />
                Apply for Loan
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Input Financing Loan Application</DialogTitle>
              </DialogHeader>
              <LoanApplicationForm
                onSuccess={() => {
                  setLoanApplyOpen(false);
                  utils.banking.listLoans.invalidate();
                  utils.banking.getDashboard.invalidate();
                }}
              />
            </DialogContent>
          </Dialog>

          {/* Apply for Insurance */}
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
        <TabsList className="flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="loans">Loans</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="insurance">Insurance</TabsTrigger>
          <TabsTrigger value="credit">Credit Score</TabsTrigger>
          {isAdmin && <TabsTrigger value="admin">Admin Portal</TabsTrigger>}
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
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              Your input financing loans and repayment schedules
            </p>
            <Dialog open={loanApplyOpen} onOpenChange={setLoanApplyOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2">
                  <PlusCircle className="h-4 w-4" />
                  Apply for Loan
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Input Financing Loan Application</DialogTitle>
                </DialogHeader>
                <LoanApplicationForm
                  onSuccess={() => {
                    setLoanApplyOpen(false);
                    utils.banking.listLoans.invalidate();
                    utils.banking.getDashboard.invalidate();
                  }}
                />
              </DialogContent>
            </Dialog>
          </div>

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
              <Button variant="outline" className="mt-4" onClick={() => setLoanApplyOpen(true)}>
                Apply for Input Loan
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
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <div className="text-right text-xs text-muted-foreground">
                            <p>Submitted</p>
                            <p>{fmtDate(String(app.submittedAt ?? ""))}</p>
                          </div>
                          {/* File a Claim button for active/approved policies */}
                          {["APPROVED", "ACTIVE"].includes(String(app.status ?? "")) && (
                            <Dialog
                              open={claimPolicyId === Number(app.id)}
                              onOpenChange={(open) => setClaimPolicyId(open ? Number(app.id) : null)}
                            >
                              <DialogTrigger asChild>
                                <Button variant="outline" size="sm" className="gap-1">
                                  <FileText className="h-3 w-3" />
                                  File Claim
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-lg">
                                <DialogHeader>
                                  <DialogTitle>Submit Insurance Claim</DialogTitle>
                                </DialogHeader>
                                <InsuranceClaimForm
                                  policyId={Number(app.id)}
                                  onSuccess={() => {
                                    setClaimPolicyId(null);
                                    utils.banking.listInsuranceApplications.invalidate();
                                  }}
                                />
                              </DialogContent>
                            </Dialog>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Credit Score Tab ── */}
        <TabsContent value="credit" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Award className="h-4 w-4 text-amber-500" />
                  NEXCOM Agri Credit Score
                </CardTitle>
              </CardHeader>
              <CardContent>
                {creditScore ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center">
                      <div className="relative flex h-32 w-32 items-center justify-center rounded-full border-8 border-primary/20">
                        <div className="text-center">
                          <p className="text-3xl font-bold text-primary">{creditScore.score}</p>
                          <p className="text-xs text-muted-foreground">{creditScore.band}</p>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-lg bg-muted/50 p-3">
                        <p className="text-xs text-muted-foreground">Max Loan</p>
                        <p className="font-semibold">{fmt(creditScore.maxLoanNgn)}</p>
                      </div>
                      <div className="rounded-lg bg-muted/50 p-3">
                        <p className="text-xs text-muted-foreground">Interest Rate</p>
                        <p className="font-semibold">{creditScore.interestRatePct}% p.a.</p>
                      </div>
                      <div className="rounded-lg bg-muted/50 p-3">
                        <p className="text-xs text-muted-foreground">Model</p>
                        <p className="font-semibold text-xs">{creditScore.model}</p>
                      </div>
                      <div className="rounded-lg bg-muted/50 p-3">
                        <p className="text-xs text-muted-foreground">Valid Until</p>
                        <p className="font-semibold text-xs">{fmtDate(creditScore.validUntil)}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <TrendingUp className="mx-auto mb-2 h-8 w-8 opacity-30" />
                    <p className="text-sm">No credit score yet</p>
                    <p className="text-xs mt-1">Request a credit check to get started</p>
                  </div>
                )}
                <Button
                  className="w-full mt-4"
                  onClick={() => creditCheck.mutate()}
                  disabled={creditCheck.isPending}
                >
                  {creditCheck.isPending ? "Checking..." : "Request Credit Check"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-blue-500" />
                  Credit Score Bands
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[
                    { band: "EXCELLENT", range: "750–850", color: "bg-green-500", desc: "Best rates, max limits" },
                    { band: "VERY GOOD", range: "680–749", color: "bg-emerald-400", desc: "Preferred rates" },
                    { band: "GOOD", range: "580–679", color: "bg-yellow-400", desc: "Standard rates" },
                    { band: "FAIR", range: "480–579", color: "bg-orange-400", desc: "Higher rates" },
                    { band: "POOR", range: "300–479", color: "bg-red-500", desc: "Limited access" },
                  ].map((b) => (
                    <div key={b.band} className="flex items-center gap-3">
                      <div className={`h-3 w-3 rounded-full ${b.color}`} />
                      <div className="flex-1">
                        <span className="text-sm font-medium">{b.band}</span>
                        <span className="text-xs text-muted-foreground ml-2">{b.range}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{b.desc}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-lg bg-blue-50 dark:bg-blue-900/10 p-3 text-xs text-blue-700 dark:text-blue-300">
                  <p className="font-semibold mb-1">How to improve your score:</p>
                  <ul className="space-y-1 list-disc list-inside">
                    <li>Repay loans on time</li>
                    <li>Maintain active accounts</li>
                    <li>Keep utilization below 70%</li>
                    <li>Complete KYC verification</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Repayment quick action */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-green-500" />
                Make a Loan Repayment
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3 items-end">
                <div className="flex-1 space-y-1.5">
                  <Label>Select Loan</Label>
                  <Select value={repayLoanId?.toString() ?? ""} onValueChange={(v) => setRepayLoanId(Number(v))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a loan..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(loans?.loans ?? []).filter(l => ["DISBURSED","REPAYING","OVERDUE"].includes(l.status)).map(l => (
                        <SelectItem key={l.id} value={String(l.id)}>Loan #{l.id} — {l.inputType} ({l.status})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 space-y-1.5">
                  <Label>Amount (₦)</Label>
                  <Input type="number" min="100" placeholder="e.g. 50000" value={repayAmount} onChange={e => setRepayAmount(e.target.value)} />
                </div>
                <Button
                  disabled={!repayLoanId || !repayAmount || makeRepayment.isPending}
                  onClick={() => repayLoanId && repayAmount && makeRepayment.mutate({ loanId: repayLoanId, amountNgn: Number(repayAmount) })}
                >
                  {makeRepayment.isPending ? "Processing..." : "Pay"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Admin Portal Tab ── */}
        {isAdmin && (
          <TabsContent value="admin" className="mt-4 space-y-4">
            {/* Portfolio Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Total Loans", value: portfolioStats?.totalLoans ?? 0, icon: Users, color: "text-blue-500" },
                { label: "Total Disbursed", value: fmt(portfolioStats?.totalDisbursed ?? 0), icon: DollarSign, color: "text-green-500" },
                { label: "Total Repaid", value: fmt(portfolioStats?.totalRepaid ?? 0), icon: CheckCircle2, color: "text-emerald-500" },
                { label: "Default Rate", value: `${portfolioStats?.defaultRate ?? "0.00"}%`, icon: AlertTriangle, color: "text-red-500" },
              ].map((s) => (
                <Card key={s.label}>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2">
                      <s.icon className={`h-5 w-5 ${s.color}`} />
                      <div>
                        <p className="text-xs text-muted-foreground">{s.label}</p>
                        <p className="font-bold text-sm">{String(s.value)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Loan Management Table */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Loan Management</CardTitle>
                  <div className="flex gap-2">
                    <div className="relative">
                      <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                      <Input
                        className="pl-8 h-8 w-40 text-sm"
                        placeholder="Search..."
                        value={adminLoanSearch}
                        onChange={e => setAdminLoanSearch(e.target.value)}
                      />
                    </div>
                    <Select value={adminLoanStatus} onValueChange={setAdminLoanStatus}>
                      <SelectTrigger className="h-8 w-32 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="APPLIED">Applied</SelectItem>
                        <SelectItem value="APPROVED">Approved</SelectItem>
                        <SelectItem value="DISBURSED">Disbursed</SelectItem>
                        <SelectItem value="REPAYING">Repaying</SelectItem>
                        <SelectItem value="REPAID">Repaid</SelectItem>
                        <SelectItem value="DEFAULTED">Defaulted</SelectItem>
                        <SelectItem value="WRITTEN_OFF">Written Off</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {adminLoansLoading ? (
                  <div className="space-y-2">{Array.from({length:5}).map((_,i)=><Skeleton key={i} className="h-14 w-full" />)}</div>
                ) : (adminLoans?.loans ?? []).length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground text-sm">No loans found</p>
                ) : (
                  <div className="space-y-2">
                    {(adminLoans?.loans ?? []).filter(l => !adminLoanSearch || String(l.id).includes(adminLoanSearch) || String(l.farmerId).includes(adminLoanSearch)).map((loan) => (
                      <div key={loan.id} className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm">Loan #{loan.id}</span>
                              <LoanStatusBadge status={loan.status} />
                              <span className="text-xs text-muted-foreground">Farmer #{loan.farmerId}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {loan.inputType} · Requested: {fmt(parseFloat(String(loan.requestedValueNgn ?? 0)))}
                              {loan.disbursedValueNgn ? ` · Disbursed: ${fmt(parseFloat(String(loan.disbursedValueNgn)))}` : ""}
                              {loan.repaidValueNgn && parseFloat(String(loan.repaidValueNgn)) > 0 ? ` · Repaid: ${fmt(parseFloat(String(loan.repaidValueNgn)))}` : ""}
                            </p>
                          </div>
                          <div className="flex gap-1 flex-wrap justify-end">
                            {loan.status === "APPLIED" && (
                              <>
                                <Button size="sm" variant="default" className="h-7 text-xs"
                                  disabled={approveLoan.isPending}
                                  onClick={() => approveLoan.mutate({ loanId: loan.id, approvedValueNgn: parseFloat(String(loan.requestedValueNgn ?? 0)) })}>
                                  Approve
                                </Button>
                                <Button size="sm" variant="destructive" className="h-7 text-xs"
                                  disabled={rejectLoan.isPending}
                                  onClick={() => rejectLoan.mutate({ loanId: loan.id, reason: "Does not meet eligibility criteria" })}>
                                  Reject
                                </Button>
                              </>
                            )}
                            {loan.status === "APPROVED" && (
                              <Button size="sm" variant="default" className="h-7 text-xs bg-green-600 hover:bg-green-700"
                                disabled={disburseLoan.isPending}
                                onClick={() => disburseLoan.mutate({ loanId: loan.id, disbursedValueNgn: parseFloat(String(loan.approvedValueNgn ?? loan.requestedValueNgn ?? 0)) })}>
                                Disburse
                              </Button>
                            )}
                            {["DISBURSED","REPAYING"].includes(loan.status) && (
                              <Button size="sm" variant="destructive" className="h-7 text-xs"
                                disabled={markDefault.isPending}
                                onClick={() => markDefault.mutate({ loanId: loan.id })}>
                                Mark Default
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    {/* Pagination */}
                    <div className="flex items-center justify-between pt-2">
                      <p className="text-xs text-muted-foreground">Total: {adminLoans?.total ?? 0} loans</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={adminLoanPage <= 1} onClick={() => setAdminLoanPage(p => p - 1)}>Prev</Button>
                        <span className="text-xs self-center">Page {adminLoanPage}</span>
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={(adminLoans?.loans ?? []).length < 20} onClick={() => setAdminLoanPage(p => p + 1)}>Next</Button>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
