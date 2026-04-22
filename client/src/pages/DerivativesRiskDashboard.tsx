import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { AlertTriangle, TrendingUp, TrendingDown, Zap, BarChart3, RefreshCw } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";

function fmt(n: number | string | null | undefined, decimals = 2) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-NG", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function PnlBar({ pnl, margin }: { pnl: number; margin: number }) {
  const pct = margin > 0 ? Math.min(Math.abs(pnl / margin) * 100, 100) : 0;
  const isLoss = pnl < 0;
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isLoss ? "bg-red-500" : "bg-emerald-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-mono w-16 text-right ${isLoss ? "text-red-400" : "text-emerald-400"}`}>
        {isLoss ? "" : "+"}{fmt(pnl, 0)}
      </span>
    </div>
  );
}

function LiquidationProximity({ currentPrice, liqPrice, side }: { currentPrice: number; liqPrice: number; side: string }) {
  if (!currentPrice || !liqPrice) return <span className="text-muted-foreground text-xs">—</span>;
  const distancePct = side === "LONG"
    ? ((currentPrice - liqPrice) / currentPrice) * 100
    : ((liqPrice - currentPrice) / currentPrice) * 100;
  const color = distancePct < 5 ? "text-red-400" : distancePct < 15 ? "text-amber-400" : "text-emerald-400";
  const bg = distancePct < 5 ? "bg-red-500/20" : distancePct < 15 ? "bg-amber-500/20" : "bg-emerald-500/20";
  return (
    <span className={`text-xs font-mono px-2 py-0.5 rounded ${color} ${bg}`}>
      {distancePct.toFixed(1)}% away
    </span>
  );
}

export default function DerivativesRiskDashboard() {
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [side, setSide] = useState<"LONG" | "SHORT" | "ALL">("ALL");
  const [liqDialog, setLiqDialog] = useState<{ positionId: number; symbol: string; side: string } | null>(null);
  const [liqPrice, setLiqPrice] = useState("");
  const [liqReason, setLiqReason] = useState("Admin force liquidation — margin breach");

  const positionsQuery = trpc.derivatives.adminListAllOpenPositions.useQuery(
    { page, limit: 50, side },
    { refetchInterval: 15_000 }
  );
  const statsQuery = trpc.derivatives.adminGetDerivativesStats.useQuery(
    undefined,
    { refetchInterval: 30_000 }
  );

  const forceLiquidate = trpc.derivatives.adminForceLiquidatePosition.useMutation({
    onSuccess: (data) => {
      toast.success("Position force-liquidated", {
        description: `Realized P&L: ${data.realizedPnl >= 0 ? "+" : ""}${fmt(data.realizedPnl)} NGN`,
      });
      setLiqDialog(null);
      setLiqPrice("");
      utils.derivatives.adminListAllOpenPositions.invalidate();
      utils.derivatives.adminGetDerivativesStats.invalidate();
    },
    onError: (err) => toast.error("Liquidation failed", { description: err.message }),
  });

  const positions = positionsQuery.data?.positions ?? [];
  const total = positionsQuery.data?.total ?? 0;
  const stats = statsQuery.data;

  // Compute aggregate risk metrics from loaded positions
  const totalUnrealizedPnl = positions.reduce((sum, p) => sum + parseFloat(p.position.unrealizedPnl ?? "0"), 0);
  const totalMarginPosted = positions.reduce((sum, p) => sum + parseFloat(p.position.marginPosted ?? "0"), 0);
  const criticalPositions = positions.filter((p) => {
    const mark = parseFloat(p.position.currentMarkPrice ?? "0");
    const liq = parseFloat(p.position.liquidationPrice ?? "0");
    if (!mark || !liq) return false;
    const dist = p.position.side === "LONG"
      ? (mark - liq) / mark
      : (liq - mark) / mark;
    return dist < 0.05;
  });

  if (positionsQuery.isLoading) return <PageSkeleton cards={4} tableRows={6} tableCols={4} showChart />;
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Derivatives Risk Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Monitor all open futures positions, P&L exposure, and liquidation proximity
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              positionsQuery.refetch();
              statsQuery.refetch();
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Critical Alert Banner */}
        {criticalPositions.length > 0 && (
          <div className="flex items-center gap-3 p-4 rounded-lg border border-red-500/40 bg-red-500/10">
            <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-red-400">
                {criticalPositions.length} position{criticalPositions.length > 1 ? "s" : ""} within 5% of liquidation price
              </p>
              <p className="text-xs text-muted-foreground">
                Immediate action may be required to prevent forced liquidation.
              </p>
            </div>
          </div>
        )}

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Open Positions</div>
              <div className="text-2xl font-bold mt-1">{total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Total Unrealized P&L</div>
              <div className={`text-2xl font-bold mt-1 ${totalUnrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {totalUnrealizedPnl >= 0 ? "+" : ""}{fmt(totalUnrealizedPnl, 0)} NGN
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Total Margin Posted</div>
              <div className="text-2xl font-bold mt-1">{fmt(totalMarginPosted, 0)} NGN</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Critical Positions</div>
              <div className={`text-2xl font-bold mt-1 ${criticalPositions.length > 0 ? "text-red-400" : "text-emerald-400"}`}>
                {criticalPositions.length}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="w-40">
            <Select value={side} onValueChange={(v) => { setSide(v as "LONG" | "SHORT" | "ALL"); setPage(1); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Sides</SelectItem>
                <SelectItem value="LONG">Long Only</SelectItem>
                <SelectItem value="SHORT">Short Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <span className="text-sm text-muted-foreground">
            Showing {positions.length} of {total} positions
          </span>
        </div>

        {/* Position Heat-Map Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Open Positions — Risk Heat-Map
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {positionsQuery.isLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Loading positions…</div>
            ) : positions.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No open positions found.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contract</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Entry</TableHead>
                      <TableHead className="text-right">Mark</TableHead>
                      <TableHead className="text-right">Liq. Price</TableHead>
                      <TableHead>Liq. Proximity</TableHead>
                      <TableHead>Unrealized P&L</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positions.map(({ position, contract }) => {
                      const mark = parseFloat(position.currentMarkPrice ?? "0");
                      const liq = parseFloat(position.liquidationPrice ?? "0");
                      const pnl = parseFloat(position.unrealizedPnl ?? "0");
                      const margin = parseFloat(position.marginPosted ?? "0");
                      const distancePct = mark && liq
                        ? position.side === "LONG"
                          ? (mark - liq) / mark * 100
                          : (liq - mark) / mark * 100
                        : 100;
                      const rowBg = distancePct < 5
                        ? "bg-red-500/5 hover:bg-red-500/10"
                        : distancePct < 15
                          ? "bg-amber-500/5 hover:bg-amber-500/10"
                          : "";

                      return (
                        <TableRow key={position.id} className={rowBg}>
                          <TableCell className="font-mono text-sm font-semibold">
                            {contract.symbol}
                          </TableCell>
                          <TableCell>
                            <Badge variant={position.side === "LONG" ? "default" : "destructive"} className="text-xs">
                              {position.side === "LONG"
                                ? <><TrendingUp className="h-3 w-3 mr-1 inline" />LONG</>
                                : <><TrendingDown className="h-3 w-3 mr-1 inline" />SHORT</>
                              }
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmt(position.quantity, 0)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmt(position.entryPrice)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmt(mark)}</TableCell>
                          <TableCell className="text-right font-mono text-sm text-amber-400">{fmt(liq)}</TableCell>
                          <TableCell>
                            <LiquidationProximity
                              currentPrice={mark}
                              liqPrice={liq}
                              side={position.side}
                            />
                          </TableCell>
                          <TableCell>
                            <PnlBar pnl={pnl} margin={margin} />
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmt(margin, 0)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => {
                                setLiqDialog({ positionId: position.id, symbol: contract.symbol, side: position.side });
                                setLiqPrice(String(liq));
                              }}
                            >
                              <Zap className="h-3 w-3 mr-1" />
                              Liquidate
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {total > 50 && (
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">Page {page}</span>
            <Button variant="outline" size="sm" disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}>
              Next
            </Button>
          </div>
        )}
      </div>

      {/* Force Liquidate Dialog */}
      <Dialog open={!!liqDialog} onOpenChange={(open) => !open && setLiqDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="h-5 w-5" />
              Force Liquidate Position
            </DialogTitle>
          </DialogHeader>
          {liqDialog && (
            <div className="space-y-4 py-2">
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                <p className="text-sm text-red-400">
                  You are about to force-liquidate a <strong>{liqDialog.side}</strong> position on{" "}
                  <strong>{liqDialog.symbol}</strong>. This action is irreversible.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Liquidation Price (NGN)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={liqPrice}
                  onChange={(e) => setLiqPrice(e.target.value)}
                  placeholder="Enter liquidation price"
                />
              </div>
              <div className="space-y-2">
                <Label>Reason</Label>
                <Input
                  value={liqReason}
                  onChange={(e) => setLiqReason(e.target.value)}
                  placeholder="Reason for liquidation"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLiqDialog(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!liqPrice || !liqDialog || forceLiquidate.isPending}
              onClick={() => {
                if (!liqDialog || !liqPrice) return;
                forceLiquidate.mutate({
                  positionId: liqDialog.positionId,
                  liquidationPrice: parseFloat(liqPrice),
                  reason: liqReason,
                });
              }}
            >
              {forceLiquidate.isPending ? "Liquidating…" : "Confirm Liquidation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
