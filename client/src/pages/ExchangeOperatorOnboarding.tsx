import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, Plus, Building2, CheckCircle, XCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

function statusBadge(status: string) {
  if (status === "ACTIVE") return <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/30">Active</Badge>;
  if (status === "SUSPENDED") return <Badge variant="outline" className="bg-red-500/20 text-red-400 border-red-500/30">Suspended</Badge>;
  if (status === "TERMINATED") return <Badge variant="outline" className="bg-slate-500/20 text-slate-400 border-slate-500/30">Terminated</Badge>;
  return <Badge variant="outline" className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Pending</Badge>;
}

const STEPS = ["Register", "Instruments", "Fees", "Settlement", "Review"] as const;
type Step = typeof STEPS[number];

export default function ExchangeOperatorOnboarding() {
  const [step, setStep] = useState<Step>("Register");
  const [operatorId, setOperatorId] = useState<number | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);

  // Register form — matches router: operatorCode, legalName, tradingName, contactEmail, contactPhone, country, websiteUrl, tier
  const [regForm, setRegForm] = useState({
    operatorCode: "",
    legalName: "",
    tradingName: "",
    registrationNumber: "",
    regulatoryLicenseNo: "",
    contactEmail: "",
    contactPhone: "",
    country: "NGA",
    websiteUrl: "",
    tier: "BASIC" as "BASIC" | "STANDARD" | "PREMIUM" | "ENTERPRISE",
  });

  // Fee form — matches router: feeType enum, rateBps, minFeeNgn, maxFeeNgn, effectiveFrom
  const [feeForm, setFeeForm] = useState({
    feeType: "MAKER" as "MAKER" | "TAKER" | "SETTLEMENT" | "WITHDRAWAL" | "DEPOSIT" | "LISTING",
    rateBps: 5,
    minFeeNgn: "",
    maxFeeNgn: "",
    effectiveFrom: "",
  });

  // Settlement form — matches router fields directly
  const [settlForm, setSettlForm] = useState({
    settlementModel: "DVP" as "DVP" | "FOP" | "CASH_ONLY" | "BILATERAL",
    settlementCycleDays: 2,
    cutoffTimeUtc: "14:00:00",
    autoNetEnabled: true,
    failedTradePolicy: "RETRY_ONCE",
    marginRequiredPct: "10",
    custodianBankCode: "",
    clearingHouseCode: "",
  });

  const listQuery = trpc.exchangeOperator.list.useQuery({ limit: 50, offset: 0 });

  const registerMutation = trpc.exchangeOperator.register.useMutation({
    onSuccess: (data) => {
      setOperatorId(data.operator.id);
      setStep("Instruments");
      toast.success("Operator registered", { description: `ID: ${data.operator.id}` });
      void listQuery.refetch();
    },
    onError: (err: { message: string }) => toast.error("Registration failed", { description: err.message }),
  });

  const setFeesMutation = trpc.exchangeOperator.setFees.useMutation({
    onSuccess: () => {
      setStep("Settlement");
      toast.success("Fee schedule saved");
    },
    onError: (err: { message: string }) => toast.error("Fee save failed", { description: err.message }),
  });

  const setSettlementMutation = trpc.exchangeOperator.setSettlementRules.useMutation({
    onSuccess: () => {
      setStep("Review");
      toast.success("Settlement rules saved");
    },
    onError: (err: { message: string }) => toast.error("Settlement save failed", { description: err.message }),
  });

  const activateMutation = trpc.exchangeOperator.activate.useMutation({
    onSuccess: () => {
      toast.success("Operator activated!", { description: "The exchange operator is now live." });
      setRegisterOpen(false);
      setStep("Register");
      setOperatorId(null);
      void listQuery.refetch();
    },
    onError: (err: { message: string }) => toast.error("Activation failed", { description: err.message }),
  });

  const suspendMutation = trpc.exchangeOperator.suspend.useMutation({
    onSuccess: () => {
      toast.success("Operator suspended");
      void listQuery.refetch();
    },
    onError: (err: { message: string }) => toast.error("Suspend failed", { description: err.message }),
  });

  const operators = listQuery.data?.operators ?? [];
  const stepIndex = STEPS.indexOf(step);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Exchange Operator Onboarding</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Register and configure multi-tenant exchange operators with instruments, fees, and settlement rules.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void listQuery.refetch()} disabled={listQuery.isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${listQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                New Operator
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Onboard Exchange Operator</DialogTitle>
              </DialogHeader>

              {/* Step indicator */}
              <div className="flex items-center gap-1 mb-4">
                {STEPS.map((s, i) => (
                  <div key={s} className="flex items-center gap-1">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border ${
                      i < stepIndex ? "bg-primary text-primary-foreground border-primary" :
                      i === stepIndex ? "bg-primary/20 text-primary border-primary" :
                      "bg-muted text-muted-foreground border-border"
                    }`}>
                      {i < stepIndex ? <CheckCircle className="h-4 w-4" /> : i + 1}
                    </div>
                    {i < STEPS.length - 1 && (
                      <div className={`h-0.5 w-6 ${i < stepIndex ? "bg-primary" : "bg-border"}`} />
                    )}
                  </div>
                ))}
                <span className="ml-2 text-sm font-medium text-foreground">{step}</span>
              </div>

              {/* Step 1: Register */}
              {step === "Register" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Operator Code * (uppercase, no spaces)</Label>
                      <Input
                        value={regForm.operatorCode}
                        onChange={e => setRegForm(f => ({ ...f, operatorCode: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") }))}
                        placeholder="NEXCOM"
                        maxLength={20}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Legal Name *</Label>
                      <Input value={regForm.legalName} onChange={e => setRegForm(f => ({ ...f, legalName: e.target.value }))} placeholder="NEXCOM Commodities Ltd" />
                    </div>
                    <div className="space-y-1">
                      <Label>Trading Name</Label>
                      <Input value={regForm.tradingName} onChange={e => setRegForm(f => ({ ...f, tradingName: e.target.value }))} placeholder="NEXCOM" />
                    </div>
                    <div className="space-y-1">
                      <Label>Country (ISO 3)</Label>
                      <Input value={regForm.country} onChange={e => setRegForm(f => ({ ...f, country: e.target.value.toUpperCase() }))} placeholder="NGA" maxLength={3} />
                    </div>
                    <div className="space-y-1">
                      <Label>Registration Number</Label>
                      <Input value={regForm.registrationNumber} onChange={e => setRegForm(f => ({ ...f, registrationNumber: e.target.value }))} placeholder="RC-123456" />
                    </div>
                    <div className="space-y-1">
                      <Label>Regulatory License No.</Label>
                      <Input value={regForm.regulatoryLicenseNo} onChange={e => setRegForm(f => ({ ...f, regulatoryLicenseNo: e.target.value }))} placeholder="SEC-2024-001" />
                    </div>
                    <div className="space-y-1">
                      <Label>Contact Email *</Label>
                      <Input type="email" value={regForm.contactEmail} onChange={e => setRegForm(f => ({ ...f, contactEmail: e.target.value }))} placeholder="ops@exchange.com" />
                    </div>
                    <div className="space-y-1">
                      <Label>Contact Phone</Label>
                      <Input value={regForm.contactPhone} onChange={e => setRegForm(f => ({ ...f, contactPhone: e.target.value }))} placeholder="+234..." />
                    </div>
                    <div className="space-y-1">
                      <Label>Website URL</Label>
                      <Input value={regForm.websiteUrl} onChange={e => setRegForm(f => ({ ...f, websiteUrl: e.target.value }))} placeholder="https://exchange.com" />
                    </div>
                    <div className="space-y-1">
                      <Label>Tier</Label>
                      <Select value={regForm.tier} onValueChange={v => setRegForm(f => ({ ...f, tier: v as typeof regForm.tier }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(["BASIC", "STANDARD", "PREMIUM", "ENTERPRISE"] as const).map(t => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => registerMutation.mutate({
                      operatorCode: regForm.operatorCode,
                      legalName: regForm.legalName,
                      tradingName: regForm.tradingName || undefined,
                      registrationNumber: regForm.registrationNumber || undefined,
                      regulatoryLicenseNo: regForm.regulatoryLicenseNo || undefined,
                      contactEmail: regForm.contactEmail,
                      contactPhone: regForm.contactPhone || undefined,
                      country: regForm.country || "NGA",
                      websiteUrl: regForm.websiteUrl || undefined,
                      tier: regForm.tier,
                    })}
                    disabled={registerMutation.isPending || !regForm.operatorCode || !regForm.legalName || !regForm.contactEmail}
                  >
                    {registerMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Register Operator
                  </Button>
                </div>
              )}

              {/* Step 2: Instruments — skip for now, instruments need instrumentId from DB */}
              {step === "Instruments" && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Instruments are configured by linking existing exchange instruments to this operator.
                    Use the <strong>Set Instruments</strong> action from the operator detail view after activation.
                  </p>
                  <div className="p-4 rounded-md bg-muted/30 border border-border">
                    <p className="text-sm font-medium">Operator ID: {operatorId}</p>
                    <p className="text-xs text-muted-foreground mt-1">Proceed to configure fees and settlement rules.</p>
                  </div>
                  <Button className="w-full" onClick={() => setStep("Fees")}>
                    Continue to Fees
                  </Button>
                </div>
              )}

              {/* Step 3: Fees */}
              {step === "Fees" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Fee Type</Label>
                      <Select value={feeForm.feeType} onValueChange={v => setFeeForm(f => ({ ...f, feeType: v as typeof feeForm.feeType }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(["MAKER", "TAKER", "SETTLEMENT", "WITHDRAWAL", "DEPOSIT", "LISTING"] as const).map(t => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Rate (basis points)</Label>
                      <Input type="number" min={0} max={10000} value={feeForm.rateBps} onChange={e => setFeeForm(f => ({ ...f, rateBps: parseInt(e.target.value) || 0 }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Min Fee (NGN)</Label>
                      <Input value={feeForm.minFeeNgn} onChange={e => setFeeForm(f => ({ ...f, minFeeNgn: e.target.value }))} placeholder="0" />
                    </div>
                    <div className="space-y-1">
                      <Label>Max Fee (NGN, blank = unlimited)</Label>
                      <Input value={feeForm.maxFeeNgn} onChange={e => setFeeForm(f => ({ ...f, maxFeeNgn: e.target.value }))} placeholder="" />
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => setFeesMutation.mutate({
                      operatorId: operatorId!,
                      fees: [{
                        feeType: feeForm.feeType,
                        rateBps: feeForm.rateBps,
                        minFeeNgn: feeForm.minFeeNgn || undefined,
                        maxFeeNgn: feeForm.maxFeeNgn || undefined,
                        effectiveFrom: feeForm.effectiveFrom || undefined,
                      }],
                    })}
                    disabled={setFeesMutation.isPending || !operatorId}
                  >
                    {setFeesMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Save Fee Schedule
                  </Button>
                </div>
              )}

              {/* Step 4: Settlement */}
              {step === "Settlement" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Settlement Model</Label>
                      <Select value={settlForm.settlementModel} onValueChange={v => setSettlForm(f => ({ ...f, settlementModel: v as typeof settlForm.settlementModel }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(["DVP", "FOP", "CASH_ONLY", "BILATERAL"] as const).map(m => (
                            <SelectItem key={m} value={m}>{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Settlement Cycle (days)</Label>
                      <Input type="number" min={0} max={5} value={settlForm.settlementCycleDays} onChange={e => setSettlForm(f => ({ ...f, settlementCycleDays: parseInt(e.target.value) || 2 }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Cut-off Time (UTC, HH:MM:SS)</Label>
                      <Input value={settlForm.cutoffTimeUtc} onChange={e => setSettlForm(f => ({ ...f, cutoffTimeUtc: e.target.value }))} placeholder="14:00:00" />
                    </div>
                    <div className="space-y-1">
                      <Label>Margin Required (%)</Label>
                      <Input value={settlForm.marginRequiredPct} onChange={e => setSettlForm(f => ({ ...f, marginRequiredPct: e.target.value }))} placeholder="10" />
                    </div>
                    <div className="space-y-1">
                      <Label>Custodian Bank Code</Label>
                      <Input value={settlForm.custodianBankCode} onChange={e => setSettlForm(f => ({ ...f, custodianBankCode: e.target.value }))} placeholder="GTBINGLA" />
                    </div>
                    <div className="space-y-1">
                      <Label>Clearing House Code</Label>
                      <Input value={settlForm.clearingHouseCode} onChange={e => setSettlForm(f => ({ ...f, clearingHouseCode: e.target.value }))} placeholder="NCXCLR" />
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => setSettlementMutation.mutate({
                      operatorId: operatorId!,
                      settlementModel: settlForm.settlementModel,
                      settlementCycleDays: settlForm.settlementCycleDays,
                      cutoffTimeUtc: settlForm.cutoffTimeUtc,
                      autoNetEnabled: settlForm.autoNetEnabled,
                      failedTradePolicy: settlForm.failedTradePolicy,
                      marginRequiredPct: settlForm.marginRequiredPct,
                      custodianBankCode: settlForm.custodianBankCode || undefined,
                      clearingHouseCode: settlForm.clearingHouseCode || undefined,
                    })}
                    disabled={setSettlementMutation.isPending || !operatorId}
                  >
                    {setSettlementMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Save Settlement Rules
                  </Button>
                </div>
              )}

              {/* Step 5: Review & Activate */}
              {step === "Review" && (
                <div className="space-y-4">
                  <div className="p-4 rounded-md bg-muted/30 border border-border space-y-2">
                    <p className="text-sm font-semibold text-foreground">Operator ID: {operatorId}</p>
                    <p className="text-sm text-muted-foreground">Code: {regForm.operatorCode}</p>
                    <p className="text-sm text-muted-foreground">Legal Name: {regForm.legalName}</p>
                    <p className="text-sm text-muted-foreground">Country: {regForm.country}</p>
                    <p className="text-sm text-muted-foreground">Settlement: {settlForm.settlementModel} (T+{settlForm.settlementCycleDays})</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Review the details above. Activating the operator will make it live on the exchange.
                  </p>
                  <Button
                    className="w-full"
                    onClick={() => activateMutation.mutate({ operatorId: operatorId! })}
                    disabled={activateMutation.isPending || !operatorId}
                  >
                    {activateMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                    Activate Operator
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Operators Table */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Registered Operators
          </CardTitle>
          <CardDescription>All exchange operators registered on the platform.</CardDescription>
        </CardHeader>
        <CardContent>
          {listQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : operators.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Building2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p>No operators registered yet. Click "New Operator" to begin onboarding.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Legal Name</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {operators.map((op) => (
                  <TableRow key={op.id}>
                    <TableCell className="text-sm font-mono">{op.id}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{op.operatorCode}</Badge>
                    </TableCell>
                    <TableCell className="text-sm font-medium">{op.legalName}</TableCell>
                    <TableCell className="text-sm">{op.country}</TableCell>
                    <TableCell className="text-sm">{op.tier}</TableCell>
                    <TableCell>{statusBadge(op.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {op.createdAt ? new Date(op.createdAt).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {op.status === "ACTIVE" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-400 hover:text-red-300"
                            onClick={() => suspendMutation.mutate({ operatorId: op.id, reason: "Admin action via dashboard" })}
                            disabled={suspendMutation.isPending}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        ) : op.status === "PENDING" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-green-400 hover:text-green-300"
                            onClick={() => activateMutation.mutate({ operatorId: op.id })}
                            disabled={activateMutation.isPending}
                          >
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
