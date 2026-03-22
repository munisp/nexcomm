import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, TrendingDown, Shield, Zap, Plus, RefreshCw } from "lucide-react";

type MarginCallStatus = "OPEN" | "PARTIALLY_MET" | "MET" | "DEFAULTED" | "CANCELLED";

function statusBadge(status: MarginCallStatus) {
  const map: Record<MarginCallStatus, string> = {
    OPEN: "bg-red-500/20 text-red-400 border-red-500/30",
    PARTIALLY_MET: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    MET: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    DEFAULTED: "bg-red-900/40 text-red-300 border-red-700/50",
    CANCELLED: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  };
  return <Badge className={`text-xs border ${map[status] ?? ""}`}>{status.replace("_", " ")}</Badge>;
}

function healthBadge(equityRatio: number) {
  const pct = equityRatio * 100;
  if (pct >= 10) return <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">HEALTHY</Badge>;
  if (pct >= 7) return <Badge className="bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">WARNING</Badge>;
  return <Badge className="bg-red-500/20 text-red-400 border border-red-500/30">CRITICAL</Badge>;
}

export default function MarginCallDashboard() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");
  const [callStatusFilter, setCallStatusFilter] = useState<MarginCallStatus | "ALL">("ALL");
  const [showCreateAccountModal, setShowCreateAccountModal] = useState(false);
  const [showTriggerCallModal, setShowTriggerCallModal] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [selectedCallId, setSelectedCallId] = useState<number | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);

  // Create account form
  const [newUserId, setNewUserId] = useState("");
  const [newInitPct, setNewInitPct] = useState("0.10");
  const [newMaintPct, setNewMaintPct] = useState("0.07");
  const [newPortfolioValue, setNewPortfolioValue] = useState("0");
  const [newCashBalance, setNewCashBalance] = useState("0");

  // Trigger call form
  const [gracePeriodHours, setGracePeriodHours] = useState("24");
  const [callNotes, setCallNotes] = useState("");

  // Deposit form
  const [depositAmount, setDepositAmount] = useState("");
  const [depositNotes, setDepositNotes] = useState("");

  const statsQuery = trpc.clearingHouse.adminGetStats.useQuery(undefined, { refetchInterval: 30000 });
  const accountsQuery = trpc.clearingHouse.adminListAccounts.useQuery({ limit: 100 });
  const atRiskQuery = trpc.clearingHouse.adminCheckMarginHealth.useQuery({ threshold: 0.08 });
  const callsQuery = trpc.clearingHouse.adminListMarginCalls.useQuery({
    status: callStatusFilter === "ALL" ? undefined : callStatusFilter,
    limit: 100,
  });
  const liquidationsQuery = trpc.clearingHouse.adminListAutoLiquidations.useQuery({ limit: 50 });

  const utils = trpc.useUtils();

  const createAccountMutation = trpc.clearingHouse.adminCreateAccount.useMutation({
    onSuccess: () => {
      toast.success("Clearing account created");
      setShowCreateAccountModal(false);
      utils.clearingHouse.adminListAccounts.invalidate();
      utils.clearingHouse.adminGetStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const triggerCallMutation = trpc.clearingHouse.adminTriggerMarginCall.useMutation({
    onSuccess: () => {
      toast.success("Margin call issued");
      setShowTriggerCallModal(false);
      setSelectedAccountId(null);
      utils.clearingHouse.adminListMarginCalls.invalidate();
      utils.clearingHouse.adminGetStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const depositMutation = trpc.clearingHouse.adminRecordMarginDeposit.useMutation({
    onSuccess: (data) => {
      toast.success(data.isMet ? "Margin call fully met!" : "Deposit recorded");
      setShowDepositModal(false);
      setSelectedCallId(null);
      utils.clearingHouse.adminListMarginCalls.invalidate();
      utils.clearingHouse.adminGetStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const resolveMutation = trpc.clearingHouse.adminResolveMarginCall.useMutation({
    onSuccess: () => {
      toast.success("Margin call resolved");
      utils.clearingHouse.adminListMarginCalls.invalidate();
      utils.clearingHouse.adminGetStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const stats = statsQuery.data;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Clearing House</h1>
          <p className="text-zinc-400 text-sm mt-1">Margin health monitoring, margin calls, and auto-liquidation</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { statsQuery.refetch(); accountsQuery.refetch(); callsQuery.refetch(); }}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreateAccountModal(true)}>
            <Plus className="w-4 h-4 mr-1" /> New Account
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-4">
            <div className="text-zinc-400 text-xs mb-1">Total Accounts</div>
            <div className="text-2xl font-bold text-white">{stats?.accounts.total ?? "—"}</div>
            <div className="text-zinc-500 text-xs">{stats?.accounts.active ?? 0} active</div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-4">
            <div className="text-zinc-400 text-xs mb-1">At-Risk Accounts</div>
            <div className="text-2xl font-bold text-red-400">{stats?.accounts.atRisk ?? "—"}</div>
            <div className="text-zinc-500 text-xs">equity ratio &lt; 8%</div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-4">
            <div className="text-zinc-400 text-xs mb-1">Open Margin Calls</div>
            <div className="text-2xl font-bold text-yellow-400">{stats?.marginCalls.open ?? "—"}</div>
            <div className="text-zinc-500 text-xs">{stats?.marginCalls.defaulted ?? 0} defaulted</div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-4">
            <div className="text-zinc-400 text-xs mb-1">Liquidations</div>
            <div className="text-2xl font-bold text-orange-400">{stats?.liquidations.total ?? "—"}</div>
            <div className="text-zinc-500 text-xs">{stats?.liquidations.pending ?? 0} pending</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-zinc-900 border border-zinc-800">
          <TabsTrigger value="overview">At-Risk Accounts</TabsTrigger>
          <TabsTrigger value="accounts">All Accounts</TabsTrigger>
          <TabsTrigger value="calls">Margin Calls</TabsTrigger>
          <TabsTrigger value="liquidations">Liquidations</TabsTrigger>
        </TabsList>

        {/* At-Risk Accounts */}
        <TabsContent value="overview" className="mt-4">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                At-Risk Accounts (Equity Ratio &lt; 8%)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {atRiskQuery.isLoading ? (
                <div className="text-zinc-500 text-sm">Loading...</div>
              ) : (atRiskQuery.data?.accounts.length ?? 0) === 0 ? (
                <div className="text-zinc-500 text-sm text-center py-8">No at-risk accounts</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-400">
                        <th className="text-left py-2 pr-4">Account Ref</th>
                        <th className="text-left py-2 pr-4">User ID</th>
                        <th className="text-right py-2 pr-4">Portfolio Value</th>
                        <th className="text-right py-2 pr-4">Cash Balance</th>
                        <th className="text-right py-2 pr-4">Equity Ratio</th>
                        <th className="text-left py-2 pr-4">Health</th>
                        <th className="text-right py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {atRiskQuery.data?.accounts.map(acc => (
                        <tr key={acc.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                          <td className="py-2 pr-4 font-mono text-xs text-zinc-300">{acc.accountRef}</td>
                          <td className="py-2 pr-4 text-zinc-300">{acc.userId}</td>
                          <td className="py-2 pr-4 text-right text-zinc-300">₦{parseFloat(acc.portfolioValue).toLocaleString()}</td>
                          <td className="py-2 pr-4 text-right text-zinc-300">₦{parseFloat(acc.cashBalance).toLocaleString()}</td>
                          <td className="py-2 pr-4 text-right text-red-400 font-medium">{(parseFloat(acc.equityRatio) * 100).toFixed(2)}%</td>
                          <td className="py-2 pr-4">{healthBadge(parseFloat(acc.equityRatio))}</td>
                          <td className="py-2 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs border-red-700 text-red-400 hover:bg-red-900/20"
                              onClick={() => { setSelectedAccountId(acc.id); setShowTriggerCallModal(true); }}
                            >
                              Issue Call
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* All Accounts */}
        <TabsContent value="accounts" className="mt-4">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-white flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-400" />
                All Clearing Accounts
              </CardTitle>
            </CardHeader>
            <CardContent>
              {accountsQuery.isLoading ? (
                <div className="text-zinc-500 text-sm">Loading...</div>
              ) : (accountsQuery.data?.accounts.length ?? 0) === 0 ? (
                <div className="text-zinc-500 text-sm text-center py-8">No clearing accounts</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-400">
                        <th className="text-left py-2 pr-4">Account Ref</th>
                        <th className="text-left py-2 pr-4">User ID</th>
                        <th className="text-right py-2 pr-4">Portfolio</th>
                        <th className="text-right py-2 pr-4">Cash</th>
                        <th className="text-right py-2 pr-4">Margin Req.</th>
                        <th className="text-right py-2 pr-4">Equity Ratio</th>
                        <th className="text-left py-2 pr-4">Status</th>
                        <th className="text-left py-2">Health</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accountsQuery.data?.accounts.map(acc => (
                        <tr key={acc.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                          <td className="py-2 pr-4 font-mono text-xs text-zinc-300">{acc.accountRef}</td>
                          <td className="py-2 pr-4 text-zinc-300">{acc.userId}</td>
                          <td className="py-2 pr-4 text-right text-zinc-300">₦{parseFloat(acc.portfolioValue).toLocaleString()}</td>
                          <td className="py-2 pr-4 text-right text-zinc-300">₦{parseFloat(acc.cashBalance).toLocaleString()}</td>
                          <td className="py-2 pr-4 text-right text-zinc-300">₦{parseFloat(acc.totalMarginRequired).toLocaleString()}</td>
                          <td className="py-2 pr-4 text-right font-medium" style={{ color: parseFloat(acc.equityRatio) < 0.08 ? "#f87171" : "#a3e635" }}>
                            {(parseFloat(acc.equityRatio) * 100).toFixed(2)}%
                          </td>
                          <td className="py-2 pr-4">
                            <Badge className={`text-xs border ${acc.status === "ACTIVE" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-zinc-500/20 text-zinc-400 border-zinc-500/30"}`}>
                              {acc.status}
                            </Badge>
                          </td>
                          <td className="py-2">{healthBadge(parseFloat(acc.equityRatio))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Margin Calls */}
        <TabsContent value="calls" className="mt-4">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base text-white flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-red-400" />
                  Margin Calls
                </CardTitle>
                <Select value={callStatusFilter} onValueChange={(v) => setCallStatusFilter(v as MarginCallStatus | "ALL")}>
                  <SelectTrigger className="w-40 h-8 bg-zinc-800 border-zinc-700 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    <SelectItem value="ALL">All Statuses</SelectItem>
                    <SelectItem value="OPEN">Open</SelectItem>
                    <SelectItem value="PARTIALLY_MET">Partially Met</SelectItem>
                    <SelectItem value="MET">Met</SelectItem>
                    <SelectItem value="DEFAULTED">Defaulted</SelectItem>
                    <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {callsQuery.isLoading ? (
                <div className="text-zinc-500 text-sm">Loading...</div>
              ) : (callsQuery.data?.length ?? 0) === 0 ? (
                <div className="text-zinc-500 text-sm text-center py-8">No margin calls found</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-400">
                        <th className="text-left py-2 pr-4">Call Ref</th>
                        <th className="text-left py-2 pr-4">User ID</th>
                        <th className="text-right py-2 pr-4">Required</th>
                        <th className="text-right py-2 pr-4">Received</th>
                        <th className="text-left py-2 pr-4">Due</th>
                        <th className="text-left py-2 pr-4">Status</th>
                        <th className="text-right py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {callsQuery.data?.map(call => (
                        <tr key={call.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                          <td className="py-2 pr-4 font-mono text-xs text-zinc-300">{call.callRef}</td>
                          <td className="py-2 pr-4 text-zinc-300">{call.userId}</td>
                          <td className="py-2 pr-4 text-right text-red-400">₦{parseFloat(call.amountRequired).toLocaleString()}</td>
                          <td className="py-2 pr-4 text-right text-emerald-400">₦{parseFloat(call.amountReceived).toLocaleString()}</td>
                          <td className="py-2 pr-4 text-zinc-400 text-xs">{new Date(call.dueAt).toLocaleDateString()}</td>
                          <td className="py-2 pr-4">{statusBadge(call.status as MarginCallStatus)}</td>
                          <td className="py-2 text-right">
                            {(call.status === "OPEN" || call.status === "PARTIALLY_MET") && (
                              <div className="flex gap-1 justify-end">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs h-7 border-emerald-700 text-emerald-400 hover:bg-emerald-900/20"
                                  onClick={() => { setSelectedCallId(call.id); setShowDepositModal(true); }}
                                >
                                  Deposit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs h-7 border-zinc-600 text-zinc-400"
                                  onClick={() => resolveMutation.mutate({ marginCallId: call.id, resolution: "CANCELLED" })}
                                >
                                  Cancel
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Liquidations */}
        <TabsContent value="liquidations" className="mt-4">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-white flex items-center gap-2">
                <Zap className="w-4 h-4 text-orange-400" />
                Auto-Liquidation Orders
              </CardTitle>
            </CardHeader>
            <CardContent>
              {liquidationsQuery.isLoading ? (
                <div className="text-zinc-500 text-sm">Loading...</div>
              ) : (liquidationsQuery.data?.length ?? 0) === 0 ? (
                <div className="text-zinc-500 text-sm text-center py-8">No liquidation orders</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-400">
                        <th className="text-left py-2 pr-4">User ID</th>
                        <th className="text-left py-2 pr-4">Instrument</th>
                        <th className="text-right py-2 pr-4">Quantity</th>
                        <th className="text-right py-2 pr-4">Est. Value</th>
                        <th className="text-right py-2 pr-4">Actual Proceeds</th>
                        <th className="text-left py-2 pr-4">Initiated</th>
                        <th className="text-left py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liquidationsQuery.data?.map(order => (
                        <tr key={order.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                          <td className="py-2 pr-4 text-zinc-300">{order.userId}</td>
                          <td className="py-2 pr-4 text-zinc-300 font-medium">{order.instrument}</td>
                          <td className="py-2 pr-4 text-right text-zinc-300">{parseFloat(order.quantity).toLocaleString()}</td>
                          <td className="py-2 pr-4 text-right text-zinc-300">₦{parseFloat(order.estimatedValue).toLocaleString()}</td>
                          <td className="py-2 pr-4 text-right text-emerald-400">
                            {order.actualProceeds ? `₦${parseFloat(order.actualProceeds).toLocaleString()}` : "—"}
                          </td>
                          <td className="py-2 pr-4 text-zinc-400 text-xs">{new Date(order.initiatedAt).toLocaleString()}</td>
                          <td className="py-2">
                            <Badge className={`text-xs border ${
                              order.status === "COMPLETED" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
                              order.status === "PENDING" ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" :
                              "bg-zinc-500/20 text-zinc-400 border-zinc-500/30"
                            }`}>{order.status}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Account Modal */}
      <Dialog open={showCreateAccountModal} onOpenChange={setShowCreateAccountModal}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Create Clearing Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-zinc-300 text-sm">User ID</Label>
              <Input value={newUserId} onChange={e => setNewUserId(e.target.value)} placeholder="e.g. 42" className="bg-zinc-800 border-zinc-700 text-white mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-zinc-300 text-sm">Initial Margin %</Label>
                <Input value={newInitPct} onChange={e => setNewInitPct(e.target.value)} placeholder="0.10" className="bg-zinc-800 border-zinc-700 text-white mt-1" />
              </div>
              <div>
                <Label className="text-zinc-300 text-sm">Maintenance Margin %</Label>
                <Input value={newMaintPct} onChange={e => setNewMaintPct(e.target.value)} placeholder="0.07" className="bg-zinc-800 border-zinc-700 text-white mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-zinc-300 text-sm">Portfolio Value (₦)</Label>
                <Input value={newPortfolioValue} onChange={e => setNewPortfolioValue(e.target.value)} placeholder="0" className="bg-zinc-800 border-zinc-700 text-white mt-1" />
              </div>
              <div>
                <Label className="text-zinc-300 text-sm">Cash Balance (₦)</Label>
                <Input value={newCashBalance} onChange={e => setNewCashBalance(e.target.value)} placeholder="0" className="bg-zinc-800 border-zinc-700 text-white mt-1" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateAccountModal(false)}>Cancel</Button>
            <Button
              onClick={() => createAccountMutation.mutate({
                userId: parseInt(newUserId),
                initialMarginPct: parseFloat(newInitPct),
                maintenanceMarginPct: parseFloat(newMaintPct),
                portfolioValue: parseFloat(newPortfolioValue),
                cashBalance: parseFloat(newCashBalance),
              })}
              disabled={createAccountMutation.isPending || !newUserId}
            >
              {createAccountMutation.isPending ? "Creating..." : "Create Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Trigger Margin Call Modal */}
      <Dialog open={showTriggerCallModal} onOpenChange={setShowTriggerCallModal}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Issue Margin Call</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-zinc-300 text-sm">Grace Period (hours)</Label>
              <Input value={gracePeriodHours} onChange={e => setGracePeriodHours(e.target.value)} placeholder="24" className="bg-zinc-800 border-zinc-700 text-white mt-1" />
            </div>
            <div>
              <Label className="text-zinc-300 text-sm">Notes (optional)</Label>
              <Input value={callNotes} onChange={e => setCallNotes(e.target.value)} placeholder="Reason for margin call..." className="bg-zinc-800 border-zinc-700 text-white mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTriggerCallModal(false)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700"
              onClick={() => selectedAccountId && triggerCallMutation.mutate({
                accountId: selectedAccountId,
                gracePeriodHours: parseInt(gracePeriodHours),
                notes: callNotes || undefined,
              })}
              disabled={triggerCallMutation.isPending || !selectedAccountId}
            >
              {triggerCallMutation.isPending ? "Issuing..." : "Issue Margin Call"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record Deposit Modal */}
      <Dialog open={showDepositModal} onOpenChange={setShowDepositModal}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Record Margin Deposit</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-zinc-300 text-sm">Amount (₦)</Label>
              <Input value={depositAmount} onChange={e => setDepositAmount(e.target.value)} placeholder="e.g. 500000" className="bg-zinc-800 border-zinc-700 text-white mt-1" />
            </div>
            <div>
              <Label className="text-zinc-300 text-sm">Notes (optional)</Label>
              <Input value={depositNotes} onChange={e => setDepositNotes(e.target.value)} placeholder="Reference or notes..." className="bg-zinc-800 border-zinc-700 text-white mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDepositModal(false)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => selectedCallId && depositMutation.mutate({
                marginCallId: selectedCallId,
                amount: parseFloat(depositAmount),
                notes: depositNotes || undefined,
              })}
              disabled={depositMutation.isPending || !depositAmount}
            >
              {depositMutation.isPending ? "Recording..." : "Record Deposit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
