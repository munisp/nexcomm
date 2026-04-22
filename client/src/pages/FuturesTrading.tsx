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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, X } from "lucide-react";
import OptionsChain from "@/components/OptionsChain";
import { PageSkeleton } from "@/components/PageSkeleton";

function fmt(n: number | string | null | undefined, decimals = 2) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-NG", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function PnlBadge({ value }: { value: number }) {
  const isPositive = value >= 0;
  return (
    <span className={`flex items-center gap-1 text-sm font-semibold ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
      {isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {isPositive ? "+" : ""}{fmt(value)} NGN
    </span>
  );
}

export default function FuturesTrading() {
  const utils = trpc.useUtils();
  const [selectedContractId, setSelectedContractId] = useState<number | null>(null);
  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const [quantity, setQuantity] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [closePositionId, setClosePositionId] = useState<number | null>(null);
  const [closePrice, setClosePrice] = useState("");

  const contractsQuery = trpc.derivatives.listActiveContracts.useQuery({});
  const positionsQuery = trpc.derivatives.myFuturesPositions.useQuery({ status: "OPEN" });
  const closedQuery = trpc.derivatives.myFuturesPositions.useQuery({ status: "CLOSED" });

  const placeMutation = trpc.derivatives.placeFuturesOrder.useMutation({
    onSuccess: (data) => {
      toast.success(`${side} position opened. Margin posted: ${fmt(data.requiredMargin)} NGN`);
      setQuantity("");
      setEntryPrice("");
      utils.derivatives.myFuturesPositions.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const closeMutation = trpc.derivatives.closeFuturesPosition.useMutation({
    onSuccess: (data) => {
      const pnl = data.realizedPnl;
      if (pnl >= 0) {
        toast.success(`Position closed. Realized P&L: +${fmt(pnl)} NGN`);
      } else {
        toast.error(`Position closed. Realized P&L: ${fmt(pnl)} NGN`);
      }
      setShowCloseDialog(false);
      setClosePrice("");
      utils.derivatives.myFuturesPositions.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const contracts = contractsQuery.data ?? [];
  const openPositions = positionsQuery.data ?? [];
  const closedPositions = closedQuery.data ?? [];

  const selectedContract = contracts.find(c => c.id === selectedContractId);

  const requiredMargin = selectedContract && quantity && entryPrice
    ? parseFloat(entryPrice) * parseFloat(quantity) * parseFloat(selectedContract.contractSize) * parseFloat(selectedContract.initialMarginPct)
    : null;

  if (contractsQuery.isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Futures Trading</h1>
          <p className="text-sm text-muted-foreground mt-1">Trade commodity futures contracts with margin</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Order Panel */}
          <Card className="bg-card border-border lg:col-span-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Place Futures Order</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Contract selector */}
              <div className="space-y-1">
                <Label className="text-xs">Contract</Label>
                <Select
                  value={selectedContractId?.toString() ?? ""}
                  onValueChange={v => {
                    setSelectedContractId(parseInt(v));
                    const c = contracts.find(x => x.id === parseInt(v));
                    if (c?.lastMarkPrice) setEntryPrice(c.lastMarkPrice);
                  }}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Select contract…" />
                  </SelectTrigger>
                  <SelectContent>
                    {contracts.map(c => (
                      <SelectItem key={c.id} value={c.id.toString()}>
                        {c.symbol} — {c.underlyingAsset}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedContract && (
                <div className="p-3 rounded-lg bg-muted/30 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Contract Size</span>
                    <span>{fmt(selectedContract.contractSize, 0)} kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Initial Margin</span>
                    <span>{(parseFloat(selectedContract.initialMarginPct) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expiry</span>
                    <span>{new Date(selectedContract.expiryDate).toLocaleDateString()}</span>
                  </div>
                  {selectedContract.lastMarkPrice && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Last Mark Price</span>
                      <span className="font-semibold text-foreground">{fmt(selectedContract.lastMarkPrice)} NGN</span>
                    </div>
                  )}
                </div>
              )}

              {/* Side selector */}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={side === "LONG" ? "default" : "outline"}
                  className={`gap-1 ${side === "LONG" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}`}
                  onClick={() => setSide("LONG")}
                >
                  <TrendingUp className="h-4 w-4" /> Long
                </Button>
                <Button
                  variant={side === "SHORT" ? "default" : "outline"}
                  className={`gap-1 ${side === "SHORT" ? "bg-red-600 hover:bg-red-700 text-white" : ""}`}
                  onClick={() => setSide("SHORT")}
                >
                  <TrendingDown className="h-4 w-4" /> Short
                </Button>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Quantity (contracts)</Label>
                <Input
                  type="number"
                  className="h-9 text-sm"
                  placeholder="e.g. 5"
                  value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Entry Price (NGN/kg)</Label>
                <Input
                  type="number"
                  className="h-9 text-sm"
                  placeholder="e.g. 85000"
                  value={entryPrice}
                  onChange={e => setEntryPrice(e.target.value)}
                />
              </div>

              {requiredMargin !== null && (
                <div className="p-3 rounded-lg bg-muted/30 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Notional Value</span>
                    <span>{fmt(parseFloat(entryPrice) * parseFloat(quantity) * parseFloat(selectedContract!.contractSize))} NGN</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span className="text-muted-foreground">Required Margin</span>
                    <span className="text-foreground">{fmt(requiredMargin)} NGN</span>
                  </div>
                </div>
              )}

              <Button
                className="w-full"
                disabled={!selectedContractId || !quantity || !entryPrice || placeMutation.isPending}
                onClick={() => selectedContractId && placeMutation.mutate({
                  contractId: selectedContractId,
                  side,
                  quantity: parseFloat(quantity),
                  entryPrice: parseFloat(entryPrice),
                })}
              >
                {placeMutation.isPending ? "Opening..." : `Open ${side} Position`}
              </Button>
            </CardContent>
          </Card>

          {/* Positions */}
          <div className="lg:col-span-2 space-y-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Open Positions ({openPositions.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contract</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Entry</TableHead>
                      <TableHead>Mark</TableHead>
                      <TableHead>Unrealized P&L</TableHead>
                      <TableHead>Margin</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openPositions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-6 text-sm">No open positions</TableCell>
                      </TableRow>
                    ) : openPositions.map(({ position, contract }) => (
                      <TableRow key={position.id}>
                        <TableCell className="font-mono text-xs font-semibold">{contract.symbol}</TableCell>
                        <TableCell>
                          <span className={`flex items-center gap-1 text-xs font-medium ${position.side === "LONG" ? "text-emerald-400" : "text-red-400"}`}>
                            {position.side === "LONG" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {position.side}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">{fmt(position.quantity, 0)}</TableCell>
                        <TableCell className="text-sm">{fmt(position.entryPrice)}</TableCell>
                        <TableCell className="text-sm">{position.currentMarkPrice ? fmt(position.currentMarkPrice) : "—"}</TableCell>
                        <TableCell><PnlBadge value={parseFloat(position.unrealizedPnl)} /></TableCell>
                        <TableCell className="text-sm">{fmt(position.marginPosted)}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            onClick={() => { setClosePositionId(position.id); setShowCloseDialog(true); }}
                          >
                            <X className="h-3 w-3" /> Close
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Closed Positions */}
            {closedPositions.length > 0 && (
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base text-muted-foreground">Closed Positions</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Contract</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead>Entry</TableHead>
                        <TableHead>Realized P&L</TableHead>
                        <TableHead>Closed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {closedPositions.slice(0, 10).map(({ position, contract }) => (
                        <TableRow key={position.id} className="opacity-70">
                          <TableCell className="font-mono text-xs">{contract.symbol}</TableCell>
                          <TableCell>
                            <span className={`text-xs ${position.side === "LONG" ? "text-emerald-400" : "text-red-400"}`}>
                              {position.side}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">{fmt(position.entryPrice)}</TableCell>
                          <TableCell><PnlBadge value={parseFloat(position.realizedPnl)} /></TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {position.closedAt ? new Date(position.closedAt).toLocaleDateString() : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Close Position Dialog */}
      <Dialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Close Position</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Enter the closing price to calculate your realized P&L.</p>
            <div className="space-y-1">
              <Label className="text-xs">Close Price (NGN/kg)</Label>
              <Input
                type="number"
                className="h-8 text-sm"
                placeholder="e.g. 87000"
                value={closePrice}
                onChange={e => setClosePrice(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCloseDialog(false)}>Cancel</Button>
            <Button
              disabled={!closePrice || closeMutation.isPending}
              onClick={() => closePositionId && closeMutation.mutate({
                positionId: closePositionId,
                closePrice: parseFloat(closePrice),
              })}
            >
              {closeMutation.isPending ? "Closing..." : "Close Position"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Options Chain */}
      <div className="px-6 pb-6">
        <OptionsChain />
      </div>
    </DashboardLayout>
  );
}
