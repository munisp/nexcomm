import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { TrendingUp, TrendingDown, BarChart3, Clock, Plus, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    ACTIVE: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    EXPIRED: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    SETTLED: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${variants[status] ?? "bg-slate-500/20 text-slate-400 border-slate-500/30"}`}>
      {status}
    </span>
  );
}

function fmt(n: number | string | null | undefined, decimals = 2) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-NG", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export default function DerivativesDashboard() {
  const utils = trpc.useUtils();

  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "EXPIRED" | "SETTLED">("ALL");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showMtmDialog, setShowMtmDialog] = useState(false);
  const [showSettleDialog, setShowSettleDialog] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState<number | null>(null);
  const [mtmPrice, setMtmPrice] = useState("");
  const [finalPrice, setFinalPrice] = useState("");

  // Create form state
  const [form, setForm] = useState({
    symbol: "", underlyingAsset: "", assetClass: "COMMODITY",
    contractSize: "", tickSize: "", currency: "NGN",
    expiryDate: "", settlementDate: "",
    initialMarginPct: "0.10", maintenanceMarginPct: "0.07",
  });

  const statsQuery = trpc.derivatives.adminGetDerivativesStats.useQuery();
  const contractsQuery = trpc.derivatives.adminListFuturesContracts.useQuery({ status: statusFilter });

  const createMutation = trpc.derivatives.adminCreateFuturesContract.useMutation({
    onSuccess: () => {
      toast.success("Contract created successfully");
      setShowCreateDialog(false);
      setForm({ symbol: "", underlyingAsset: "", assetClass: "COMMODITY", contractSize: "", tickSize: "", currency: "NGN", expiryDate: "", settlementDate: "", initialMarginPct: "0.10", maintenanceMarginPct: "0.07" });
      utils.derivatives.adminListFuturesContracts.invalidate();
      utils.derivatives.adminGetDerivativesStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const expireMutation = trpc.derivatives.adminExpireContract.useMutation({
    onSuccess: () => {
      toast.success("Contract expired");
      utils.derivatives.adminListFuturesContracts.invalidate();
      utils.derivatives.adminGetDerivativesStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const mtmMutation = trpc.derivatives.adminMarkToMarket.useMutation({
    onSuccess: (data) => {
      toast.success(`Mark-to-Market complete: ${data.positionsSettled} positions updated`);
      setShowMtmDialog(false);
      setMtmPrice("");
      utils.derivatives.adminListFuturesContracts.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const settleMutation = trpc.derivatives.adminSettleExpiredContracts.useMutation({
    onSuccess: (data) => {
      toast.success(`Final Settlement complete: ${data.positionsSettled} positions settled`);
      setShowSettleDialog(false);
      setFinalPrice("");
      utils.derivatives.adminListFuturesContracts.invalidate();
      utils.derivatives.adminGetDerivativesStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const stats = statsQuery.data;
  const contracts = contractsQuery.data?.contracts ?? [];

  const selectedContract = contracts.find(c => c.id === selectedContractId);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Derivatives Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage futures contracts, open interest, and daily settlements</p>
          </div>
          <Button onClick={() => setShowCreateDialog(true)} className="gap-2">
            <Plus className="h-4 w-4" /> New Contract
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Active Contracts", value: stats?.activeContracts ?? "—", icon: BarChart3, color: "text-emerald-400" },
            { label: "Open Positions", value: stats?.totalOpenPositions ?? "—", icon: TrendingUp, color: "text-blue-400" },
            { label: "Expiring in 7 Days", value: stats?.expiringSoon ?? "—", icon: Clock, color: "text-amber-400" },
            { label: "Today's Settlements", value: stats?.todaySettlements ?? "—", icon: CheckCircle2, color: "text-purple-400" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="bg-card border-border">
              <CardContent className="p-4 flex items-center gap-3">
                <Icon className={`h-8 w-8 ${color} shrink-0`} />
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xl font-bold text-foreground">{value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Contracts Table */}
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Futures Contracts</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                <SelectTrigger className="w-32 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["ALL", "ACTIVE", "EXPIRED", "SETTLED"].map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => utils.derivatives.adminListFuturesContracts.invalidate()}>
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Underlying</TableHead>
                  <TableHead>Contract Size</TableHead>
                  <TableHead>Mark Price</TableHead>
                  <TableHead>Initial Margin</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">No contracts found</TableCell>
                  </TableRow>
                ) : contracts.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono font-semibold text-foreground">{c.symbol}</TableCell>
                    <TableCell className="text-muted-foreground">{c.underlyingAsset}</TableCell>
                    <TableCell>{fmt(c.contractSize, 0)}</TableCell>
                    <TableCell>{c.lastMarkPrice ? fmt(c.lastMarkPrice) : "—"}</TableCell>
                    <TableCell>{(parseFloat(c.initialMarginPct) * 100).toFixed(1)}%</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(c.expiryDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell><StatusBadge status={c.status} /></TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {c.status === "ACTIVE" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => { setSelectedContractId(c.id); setShowMtmDialog(true); }}
                            >
                              MTM
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                              onClick={() => { setSelectedContractId(c.id); setShowSettleDialog(true); }}
                            >
                              Settle
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs text-red-400 border-red-500/30 hover:bg-red-500/10"
                              onClick={() => expireMutation.mutate({ contractId: c.id })}
                            >
                              Expire
                            </Button>
                          </>
                        )}
                        {c.status === "EXPIRED" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-purple-400 border-purple-500/30 hover:bg-purple-500/10"
                            onClick={() => { setSelectedContractId(c.id); setShowSettleDialog(true); }}
                          >
                            Final Settle
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Create Contract Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Futures Contract</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            {[
              { label: "Symbol", key: "symbol", placeholder: "MAIZE-DEC26" },
              { label: "Underlying Asset", key: "underlyingAsset", placeholder: "White Maize" },
              { label: "Contract Size (kg)", key: "contractSize", placeholder: "1000" },
              { label: "Tick Size", key: "tickSize", placeholder: "0.50" },
              { label: "Initial Margin %", key: "initialMarginPct", placeholder: "0.10" },
              { label: "Maintenance Margin %", key: "maintenanceMarginPct", placeholder: "0.07" },
            ].map(({ label, key, placeholder }) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs">{label}</Label>
                <Input
                  className="h-8 text-sm"
                  placeholder={placeholder}
                  value={(form as Record<string, string>)[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
            <div className="space-y-1">
              <Label className="text-xs">Expiry Date</Label>
              <Input
                type="datetime-local"
                className="h-8 text-sm"
                value={form.expiryDate}
                onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Settlement Date</Label>
              <Input
                type="datetime-local"
                className="h-8 text-sm"
                value={form.settlementDate}
                onChange={e => setForm(f => ({ ...f, settlementDate: e.target.value }))}
              />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Asset Class</Label>
              <Select value={form.assetClass} onValueChange={v => setForm(f => ({ ...f, assetClass: v }))}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["COMMODITY", "FOREX", "EQUITY", "INDEX"].map(ac => (
                    <SelectItem key={ac} value={ac}>{ac}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate({
                symbol: form.symbol,
                underlyingAsset: form.underlyingAsset,
                assetClass: form.assetClass,
                contractSize: parseFloat(form.contractSize),
                tickSize: parseFloat(form.tickSize),
                currency: form.currency,
                expiryDate: form.expiryDate ? new Date(form.expiryDate).toISOString() : "",
                settlementDate: form.settlementDate ? new Date(form.settlementDate).toISOString() : "",
                initialMarginPct: parseFloat(form.initialMarginPct),
                maintenanceMarginPct: parseFloat(form.maintenanceMarginPct),
              })}
            >
              {createMutation.isPending ? "Creating..." : "Create Contract"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark-to-Market Dialog */}
      <Dialog open={showMtmDialog} onOpenChange={setShowMtmDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark-to-Market: {selectedContract?.symbol}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Set today's settlement price. All open positions will be revalued and daily P&L transferred to clearing accounts.
            </p>
            <div className="space-y-1">
              <Label className="text-xs">Settlement Price (NGN)</Label>
              <Input
                type="number"
                className="h-8 text-sm"
                placeholder="e.g. 85000"
                value={mtmPrice}
                onChange={e => setMtmPrice(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMtmDialog(false)}>Cancel</Button>
            <Button
              disabled={!mtmPrice || mtmMutation.isPending}
              onClick={() => selectedContractId && mtmMutation.mutate({
                contractId: selectedContractId,
                settlementPrice: parseFloat(mtmPrice),
              })}
            >
              {mtmMutation.isPending ? "Processing..." : "Run MTM"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Final Settlement Dialog */}
      <Dialog open={showSettleDialog} onOpenChange={setShowSettleDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Final Settlement: {selectedContract?.symbol}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-300">
                This will close all open positions at the final settlement price and mark the contract as SETTLED. This action cannot be undone.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Final Settlement Price (NGN)</Label>
              <Input
                type="number"
                className="h-8 text-sm"
                placeholder="e.g. 87500"
                value={finalPrice}
                onChange={e => setFinalPrice(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSettleDialog(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!finalPrice || settleMutation.isPending}
              onClick={() => selectedContractId && settleMutation.mutate({
                contractId: selectedContractId,
                finalSettlementPrice: parseFloat(finalPrice),
              })}
            >
              {settleMutation.isPending ? "Settling..." : "Confirm Final Settlement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
