import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  Layers,
  Plus,
  RefreshCw,
  Play,
  CheckSquare,
  CheckCircle,
  BarChart3,
  AlertTriangle,
} from "lucide-react";

type CycleStatus = "OPEN" | "MATCHING" | "MATCHED" | "SETTLING" | "SETTLED" | "FAILED" | "ALL";

function cycleStatusBadge(status: string) {
  const colors: Record<string, string> = {
    OPEN: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    MATCHING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    MATCHED: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    SETTLING: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    SETTLED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    FAILED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-semibold ${
        colors[status] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {status}
    </span>
  );
}

function instructionStatusBadge(status: string) {
  const colors: Record<string, string> = {
    MATCHED: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    CONFIRMED: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    SETTLED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    FAILED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    CANCELLED: "bg-gray-100 text-gray-700 dark:bg-secondary dark:text-muted-foreground",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-semibold ${
        colors[status] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {status}
    </span>
  );
}

export default function SettlementEngine() {
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const [statusFilter, setStatusFilter] = useState<CycleStatus>("ALL");
  const [offset, setOffset] = useState(0);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedCycleId, setSelectedCycleId] = useState<number | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);

  // Create cycle form
  const [cycleDate, setCycleDate] = useState(new Date().toISOString().split("T")[0]);
  const [settlementType, setSettlementType] = useState<"T+0" | "T+1" | "T+2" | "T+3">("T+1");
  const [assetClass, setAssetClass] = useState<"COMMODITY" | "EQUITY" | "FX" | "CRYPTO">("COMMODITY");
  const [currency, setCurrency] = useState("NGN");

  const { data: cyclesData, isLoading } = trpc.settlementEngine.adminListCycles.useQuery({
    status: statusFilter,
    limit: 20,
    offset,
  });

  const { data: stats } = trpc.settlementEngine.adminGetStats.useQuery();

  const { data: cycleDetail } = trpc.settlementEngine.adminGetCycleDetail.useQuery(
    { cycleId: selectedCycleId! },
    { enabled: !!selectedCycleId }
  );

  const createMutation = trpc.settlementEngine.adminCreateCycle.useMutation({
    onSuccess: (data) => {
      toast.success("Cycle created", {
        description: `Settlement cycle #${data.id} opened for ${new Date(data.cycleDate).toLocaleDateString()}`,
      });
      utils.settlementEngine.adminListCycles.invalidate();
      utils.settlementEngine.adminGetStats.invalidate();
      setShowCreateDialog(false);
    },
    onError: (e) => toast.error("Error creating cycle", { description: e.message }),
  });

  const runMatchingMutation = trpc.settlementEngine.adminRunMatching.useMutation({
    onSuccess: (data) => {
      toast.success("Matching complete", {
        description: `${data.matchedTrades} trades matched in cycle #${data.id}`,
      });
      utils.settlementEngine.adminListCycles.invalidate();
      utils.settlementEngine.adminGetStats.invalidate();
      if (selectedCycleId) utils.settlementEngine.adminGetCycleDetail.invalidate({ cycleId: selectedCycleId });
    },
    onError: (e) => toast.error("Matching failed", { description: e.message }),
  });

  const confirmDVPMutation = trpc.settlementEngine.adminConfirmDVP.useMutation({
    onSuccess: (data) => {
      toast.success("DVP confirmed", {
        description: `${data.confirmedCount} instructions confirmed`,
      });
      utils.settlementEngine.adminListCycles.invalidate();
      if (selectedCycleId) utils.settlementEngine.adminGetCycleDetail.invalidate({ cycleId: selectedCycleId });
    },
    onError: (e) => toast.error("DVP confirmation failed", { description: e.message }),
  });

  const settleMutation = trpc.settlementEngine.adminSettleCycle.useMutation({
    onSuccess: (data) => {
      toast.success("Cycle settled", {
        description: `Cycle #${data.id} settled. Gross value: ₦${parseFloat(data.grossValue ?? "0").toLocaleString()}`,
      });
      utils.settlementEngine.adminListCycles.invalidate();
      utils.settlementEngine.adminGetStats.invalidate();
      if (selectedCycleId) utils.settlementEngine.adminGetCycleDetail.invalidate({ cycleId: selectedCycleId });
    },
    onError: (e) => toast.error("Settlement failed", { description: e.message }),
  });

  const isAdmin = (user as { role?: string })?.role === "admin";
  if (!isAdmin) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Admin access required.</p>
        </div>
      </DashboardLayout>
    );
  }

  const cycles = cyclesData?.cycles ?? [];
  const total = cyclesData?.total ?? 0;

  // Aggregate stats
  const openCycles = stats?.cycleStats.filter((s) => s.status === "OPEN").reduce((a, b) => a + Number(b.cnt), 0) ?? 0;
  const settledCycles = stats?.cycleStats.filter((s) => s.status === "SETTLED").reduce((a, b) => a + Number(b.cnt), 0) ?? 0;
  const openFails = stats?.failStats.filter((s) => s.status === "OPEN").reduce((a, b) => a + Number(b.cnt), 0) ?? 0;
  const totalGross = stats?.cycleStats.reduce((a, b) => a + parseFloat(b.totalGross ?? "0"), 0) ?? 0;

  if (isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Layers className="h-6 w-6 text-purple-500" />
              Settlement Engine
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage T+1/T+2 settlement cycles, DVP matching, and position netting
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => utils.settlementEngine.adminListCycles.invalidate()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Cycle
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Play className="h-8 w-8 text-blue-500" />
                <div>
                  <div className="text-2xl font-bold">{openCycles}</div>
                  <div className="text-xs text-muted-foreground">Open Cycles</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <CheckCircle className="h-8 w-8 text-green-500" />
                <div>
                  <div className="text-2xl font-bold">{settledCycles}</div>
                  <div className="text-xs text-muted-foreground">Settled Cycles</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-8 w-8 text-red-500" />
                <div>
                  <div className="text-2xl font-bold">{openFails}</div>
                  <div className="text-xs text-muted-foreground">Open Fails</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <BarChart3 className="h-8 w-8 text-purple-500" />
                <div>
                  <div className="text-2xl font-bold text-sm">
                    ₦{(totalGross / 1_000_000).toFixed(1)}M
                  </div>
                  <div className="text-xs text-muted-foreground">Total Gross Value</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Cycles Table */}
        <div className="space-y-4">
          <div className="flex gap-3 flex-wrap">
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v as CycleStatus);
                setOffset(0);
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="MATCHING">Matching</SelectItem>
                <SelectItem value="MATCHED">Matched</SelectItem>
                <SelectItem value="SETTLING">Settling</SelectItem>
                <SelectItem value="SETTLED">Settled</SelectItem>
                <SelectItem value="FAILED">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Asset Class</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Trades</TableHead>
                    <TableHead>Matched</TableHead>
                    <TableHead>Failed</TableHead>
                    <TableHead>Gross Value</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                        Loading cycles...
                      </TableCell>
                    </TableRow>
                  ) : !cycles.length ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                        No settlement cycles found. Create a new cycle to begin.
                      </TableCell>
                    </TableRow>
                  ) : (
                    cycles.map((cycle) => (
                      <TableRow key={cycle.id}>
                        <TableCell className="font-mono text-xs">#{cycle.id}</TableCell>
                        <TableCell className="text-sm">
                          {new Date(cycle.cycleDate).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{cycle.settlementType}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">{cycle.assetClass}</TableCell>
                        <TableCell>{cycleStatusBadge(cycle.status)}</TableCell>
                        <TableCell className="text-sm">{cycle.totalTrades ?? 0}</TableCell>
                        <TableCell className="text-sm text-green-600">
                          {cycle.matchedTrades ?? 0}
                        </TableCell>
                        <TableCell className="text-sm text-red-500">
                          {cycle.failedTrades ?? 0}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {cycle.grossValue
                            ? `₦${parseFloat(cycle.grossValue).toLocaleString()}`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setSelectedCycleId(cycle.id);
                                setShowDetailDialog(true);
                              }}
                            >
                              View
                            </Button>
                            {cycle.status === "OPEN" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => runMatchingMutation.mutate({ cycleId: cycle.id })}
                                disabled={runMatchingMutation.isPending}
                              >
                                <Play className="h-3 w-3 mr-1" />
                                Match
                              </Button>
                            )}
                            {cycle.status === "MATCHED" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => confirmDVPMutation.mutate({ cycleId: cycle.id })}
                                disabled={confirmDVPMutation.isPending}
                              >
                                <CheckSquare className="h-3 w-3 mr-1" />
                                Confirm DVP
                              </Button>
                            )}
                            {cycle.status === "MATCHED" && (
                              <Button
                                size="sm"
                                onClick={() => settleMutation.mutate({ cycleId: cycle.id })}
                                disabled={settleMutation.isPending}
                              >
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Settle
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Pagination */}
          {total > 20 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Showing {offset + 1}–{Math.min(offset + 20, total)} of {total}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 20))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={offset + 20 >= total}
                  onClick={() => setOffset(offset + 20)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create Cycle Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Settlement Cycle</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Cycle Date</Label>
              <Input
                type="date"
                value={cycleDate}
                onChange={(e) => setCycleDate(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Settlement Type</Label>
                <Select value={settlementType} onValueChange={(v) => setSettlementType(v as typeof settlementType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="T+0">T+0 (Same Day)</SelectItem>
                    <SelectItem value="T+1">T+1 (Next Day)</SelectItem>
                    <SelectItem value="T+2">T+2 (Two Days)</SelectItem>
                    <SelectItem value="T+3">T+3 (Three Days)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Asset Class</Label>
                <Select value={assetClass} onValueChange={(v) => setAssetClass(v as typeof assetClass)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="COMMODITY">Commodity</SelectItem>
                    <SelectItem value="EQUITY">Equity</SelectItem>
                    <SelectItem value="FX">FX</SelectItem>
                    <SelectItem value="CRYPTO">Crypto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Currency</Label>
              <Input
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                placeholder="NGN"
                maxLength={8}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                createMutation.mutate({
                  cycleDate: new Date(cycleDate),
                  settlementType,
                  assetClass,
                  currency,
                });
              }}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : "Create Cycle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cycle Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Cycle #{selectedCycleId} Detail
              {cycleDetail?.cycle && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  — {new Date(cycleDetail.cycle.cycleDate).toLocaleDateString()}{" "}
                  {cycleDetail.cycle.settlementType}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {cycleDetail ? (
            <Tabs defaultValue="positions">
              <TabsList>
                <TabsTrigger value="positions">
                  Positions ({cycleDetail.positions.length})
                </TabsTrigger>
                <TabsTrigger value="instructions">
                  Instructions ({cycleDetail.instructions.length})
                </TabsTrigger>
                <TabsTrigger value="fails">
                  Fails ({cycleDetail.fails.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="positions">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Instrument</TableHead>
                      <TableHead>Buy Qty</TableHead>
                      <TableHead>Sell Qty</TableHead>
                      <TableHead>Net Qty</TableHead>
                      <TableHead>Net Cash</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cycleDetail.positions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-4 text-muted-foreground">
                          No positions computed yet. Run matching first.
                        </TableCell>
                      </TableRow>
                    ) : (
                      cycleDetail.positions.map((pos) => (
                        <TableRow key={pos.id}>
                          <TableCell>User {pos.userId}</TableCell>
                          <TableCell className="font-mono text-xs">{pos.instrument}</TableCell>
                          <TableCell className="text-green-600">
                            {parseFloat(pos.grossBuyQty ?? "0").toFixed(2)}
                          </TableCell>
                          <TableCell className="text-red-500">
                            {parseFloat(pos.grossSellQty ?? "0").toFixed(2)}
                          </TableCell>
                          <TableCell
                            className={
                              parseFloat(pos.netQty ?? "0") >= 0 ? "text-green-600 font-medium" : "text-red-500 font-medium"
                            }
                          >
                            {parseFloat(pos.netQty ?? "0").toFixed(2)}
                          </TableCell>
                          <TableCell className="text-sm">
                            ₦{parseFloat(pos.netCashObligation ?? "0").toLocaleString()}
                          </TableCell>
                          <TableCell>{instructionStatusBadge(pos.status)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="instructions">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Buyer</TableHead>
                      <TableHead>Seller</TableHead>
                      <TableHead>Instrument</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Total Value</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cycleDetail.instructions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-4 text-muted-foreground">
                          No DVP instructions yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      cycleDetail.instructions.map((instr) => (
                        <TableRow key={instr.id}>
                          <TableCell>User {instr.buyerUserId}</TableCell>
                          <TableCell>User {instr.sellerUserId}</TableCell>
                          <TableCell className="font-mono text-xs">{instr.instrument}</TableCell>
                          <TableCell>{parseFloat(instr.quantity).toFixed(2)}</TableCell>
                          <TableCell>₦{parseFloat(instr.price).toLocaleString()}</TableCell>
                          <TableCell className="font-medium">
                            ₦{parseFloat(instr.totalValue).toLocaleString()}
                          </TableCell>
                          <TableCell>{instructionStatusBadge(instr.status)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="fails">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Instruction</TableHead>
                      <TableHead>Fail Type</TableHead>
                      <TableHead>Failed Party</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Penalty</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cycleDetail.fails.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-4 text-muted-foreground">
                          No settlement fails.
                        </TableCell>
                      </TableRow>
                    ) : (
                      cycleDetail.fails.map((fail) => (
                        <TableRow key={fail.id}>
                          <TableCell className="font-mono text-xs">#{fail.instructionId}</TableCell>
                          <TableCell className="text-xs">
                            {fail.failType.replace(/_/g, " ")}
                          </TableCell>
                          <TableCell>User {fail.failedPartyUserId}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                fail.status === "RESOLVED"
                                  ? "default"
                                  : fail.status === "OPEN"
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              {fail.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {fail.penaltyAmount
                              ? `₦${parseFloat(fail.penaltyAmount).toLocaleString()}`
                              : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(fail.createdAt).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              Loading cycle details...
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
