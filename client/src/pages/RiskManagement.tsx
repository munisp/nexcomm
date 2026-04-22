/**
 * NEXCOM Exchange — Risk Management Dashboard
 * Uses riskManagementRouter: getPositions, getRiskSummary,
 * checkOrder, getCircuitBreakers, getMarginRequirements.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ShieldAlert, TrendingDown, AlertTriangle, Activity, Zap, BarChart2, RefreshCw, CheckCircle, XCircle } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PASS: "bg-green-500/10 text-green-400 border-green-500/30",
    FAIL: "bg-red-500/10 text-red-400 border-red-500/30",
    TRIGGERED: "bg-red-500/10 text-red-400 border-red-500/30",
    ACTIVE: "bg-green-500/10 text-green-400 border-green-500/30",
  };
  return <Badge variant="outline" className={map[status] ?? "bg-muted/50 text-muted-foreground"}>{status}</Badge>;
}

export default function RiskManagement() {
  const { user } = useAuth();
  const [preTradeSymbol, setPreTradeSymbol] = useState("MAIZE");
  const [preTradeQty, setPreTradeQty] = useState("100");
  const [preTradeSide, setPreTradeSide] = useState<"BUY" | "SELL">("BUY");
  const [preTradePrice, setPreTradePrice] = useState("450");
  const [checkResult, setCheckResult] = useState<null | { approved: boolean; reason: string | null; marginRequired: number | null; source: string }>(null);
  const [marginSymbol, setMarginSymbol] = useState("MAIZE");

  const { data: positions, refetch: refetchPositions, isLoading: positionsLoading } = trpc.riskManagement.getPositions.useQuery(undefined, { enabled: !!user, refetchInterval: 30000 });
  const { data: riskSummary } = trpc.riskManagement.getRiskSummary.useQuery(undefined, { enabled: !!user, refetchInterval: 30000 });
  const { data: circuitBreakers, refetch: refetchCB } = trpc.riskManagement.getCircuitBreakers.useQuery(undefined, { refetchInterval: 30000 });
  const { data: marginReqs } = trpc.riskManagement.getMarginRequirements.useQuery({ symbol: marginSymbol }, { refetchInterval: 60000 });

  const checkOrderMutation = trpc.riskManagement.checkOrder.useMutation({
    onSuccess: (data) => {
      setCheckResult(data);
      if (data.approved) toast.success("Pre-trade risk check passed — order approved");
      else toast.error(`Risk check failed: ${data.reason ?? "Order rejected"}`);
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const positionsArr = Array.isArray(positions?.positions) ? positions.positions : [];
  const cbData = circuitBreakers as { circuit_breakers?: Record<string, unknown>[]; global_halt?: boolean; source?: string } | undefined;
  const cbArr = Array.isArray(cbData?.circuit_breakers) ? cbData.circuit_breakers : [];
  const summary = riskSummary as Record<string, unknown> | undefined;
  const marginData = marginReqs as Record<string, unknown> | undefined;

  if (positionsLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-orange-400" />
            Risk Management
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Pre-trade checks, position limits, margin requirements, and circuit breakers</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs text-muted-foreground">Source: {String(summary?.source ?? "—")}</Badge>
          <Button variant="outline" size="sm" onClick={() => { refetchPositions(); refetchCB(); }}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border"><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Open Positions</p><p className="text-2xl font-bold text-foreground">{positionsArr.length}</p></div><BarChart2 className="w-8 h-8 text-blue-400 opacity-60" /></div></CardContent></Card>
        <Card className="bg-card border-border"><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Risk Score</p><p className="text-2xl font-bold text-foreground">{summary?.riskScore != null ? `${summary.riskScore}/100` : "—"}</p></div><TrendingDown className="w-8 h-8 text-red-400 opacity-60" /></div></CardContent></Card>
        <Card className="bg-card border-border"><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Margin Used</p><p className="text-2xl font-bold text-yellow-400">{summary?.marginUsed != null ? `₦${Number(summary.marginUsed).toLocaleString()}` : "—"}</p></div><AlertTriangle className="w-8 h-8 text-yellow-400 opacity-60" /></div></CardContent></Card>
        <Card className="bg-card border-border"><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Circuit Breakers</p><p className="text-2xl font-bold text-foreground">{cbArr.length} configured</p></div><Zap className="w-8 h-8 text-orange-400 opacity-60" /></div></CardContent></Card>
      </div>

      <Tabs defaultValue="pretrade">
        <TabsList className="bg-muted/30">
          <TabsTrigger value="pretrade">Pre-Trade Check</TabsTrigger>
          <TabsTrigger value="positions">Positions</TabsTrigger>
          <TabsTrigger value="margin">Margin</TabsTrigger>
          <TabsTrigger value="circuit">Circuit Breakers</TabsTrigger>
        </TabsList>

        <TabsContent value="pretrade" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-card border-border">
              <CardHeader><CardTitle className="text-base">Pre-Trade Risk Check</CardTitle><CardDescription>Validate an order against risk limits before submission</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs text-muted-foreground">Symbol</Label><Input value={preTradeSymbol} onChange={(e) => setPreTradeSymbol(e.target.value.toUpperCase())} placeholder="MAIZE" className="mt-1" /></div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Side</Label>
                    <Select value={preTradeSide} onValueChange={(v) => setPreTradeSide(v as "BUY" | "SELL")}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="BUY">BUY</SelectItem><SelectItem value="SELL">SELL</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div><Label className="text-xs text-muted-foreground">Quantity</Label><Input type="number" value={preTradeQty} onChange={(e) => setPreTradeQty(e.target.value)} className="mt-1" /></div>
                  <div><Label className="text-xs text-muted-foreground">Price (₦)</Label><Input type="number" value={preTradePrice} onChange={(e) => setPreTradePrice(e.target.value)} className="mt-1" /></div>
                </div>
                <div className="text-xs text-muted-foreground bg-muted/20 p-2 rounded">Notional: ₦{(parseFloat(preTradeQty || "0") * parseFloat(preTradePrice || "0")).toLocaleString()}</div>
                <Button className="w-full" onClick={() => checkOrderMutation.mutate({ symbol: preTradeSymbol, side: preTradeSide, quantity: preTradeQty, price: preTradePrice })} disabled={checkOrderMutation.isPending}>
                  {checkOrderMutation.isPending ? "Checking..." : "Run Risk Check"}
                </Button>
              </CardContent>
            </Card>
            {checkResult && (
              <Card className={`border ${checkResult.approved ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    {checkResult.approved ? <CheckCircle className="w-5 h-5 text-green-400" /> : <XCircle className="w-5 h-5 text-red-400" />}
                    {checkResult.approved ? "Order Approved" : "Order Rejected"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Decision</span><StatusBadge status={checkResult.approved ? "PASS" : "FAIL"} /></div>
                  {checkResult.reason && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Reason</span><span className="text-foreground text-right max-w-xs">{checkResult.reason}</span></div>}
                  {checkResult.marginRequired != null && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Margin Required</span><span className="font-semibold">₦{Number(checkResult.marginRequired).toLocaleString()}</span></div>}
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Source</span><span className="text-xs text-muted-foreground/60">{checkResult.source}</span></div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="positions" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader><div className="flex items-center justify-between"><CardTitle className="text-base">Open Positions</CardTitle><Badge variant="outline" className="text-xs">Total: ₦{Number(summary?.totalPositionValue ?? 0).toLocaleString()}</Badge></div></CardHeader>
            <CardContent>
              {positionsArr.length === 0 ? <p className="text-center text-muted-foreground py-8">No open positions</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Symbol</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Avg Cost</TableHead><TableHead className="text-right">Current Value</TableHead><TableHead className="text-right">Unrealized P&L</TableHead><TableHead className="text-right">Realized P&L</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(positionsArr as Record<string, unknown>[]).map((pos, i: number) => {
                      const pnl = Number(pos.unrealizedPnl ?? pos.unrealized_pnl ?? 0);
                      return (
                        <TableRow key={i}>
                          <TableCell className="font-mono font-semibold">{String(pos.symbol ?? "")}</TableCell>
                          <TableCell className="text-right">{Number(pos.quantity ?? 0).toLocaleString()}</TableCell>
                          <TableCell className="text-right">₦{Number(pos.averageCost ?? pos.avg_price ?? 0).toLocaleString()}</TableCell>
                          <TableCell className="text-right">₦{Number(pos.currentValue ?? pos.market_value ?? 0).toLocaleString()}</TableCell>
                          <TableCell className={`text-right font-semibold ${pnl >= 0 ? "text-green-400" : "text-red-400"}`}>{pnl >= 0 ? "+" : ""}₦{pnl.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-muted-foreground">₦{Number(pos.realizedPnl ?? pos.realized_pnl ?? 0).toLocaleString()}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="margin" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-card border-border">
              <CardHeader><CardTitle className="text-base">Margin Requirements</CardTitle><CardDescription>Initial and maintenance margin rates per commodity</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div><Label className="text-xs text-muted-foreground">Symbol</Label><Input value={marginSymbol} onChange={(e) => setMarginSymbol(e.target.value.toUpperCase())} placeholder="MAIZE" className="mt-1" /></div>
                {marginData && (
                  <div className="space-y-3 mt-4">
                    {[
                      { label: "Symbol", value: String(marginData.symbol ?? marginSymbol) },
                      { label: "Initial Margin Rate", value: `${(Number(marginData.initial_margin_rate ?? 0) * 100).toFixed(1)}%` },
                      { label: "Maintenance Margin Rate", value: `${(Number(marginData.maintenance_margin_rate ?? 0) * 100).toFixed(1)}%` },
                      { label: "Max Position Size", value: Number(marginData.max_position_size ?? 0).toLocaleString() },
                      { label: "Source", value: String(marginData.source ?? "—") },
                    ].map((row) => (
                      <div key={row.label} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{row.label}</span>
                        <span className="font-semibold text-foreground">{row.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardHeader><CardTitle className="text-base">Account Risk Summary</CardTitle></CardHeader>
              <CardContent>
                {!summary ? <p className="text-center text-muted-foreground py-8">Loading...</p> : (
                  <div className="space-y-3">
                    {[
                      { label: "Total Position Value", value: `₦${Number(summary.totalPositionValue ?? 0).toLocaleString()}` },
                      { label: "Margin Used", value: `₦${Number(summary.marginUsed ?? 0).toLocaleString()}` },
                      { label: "Margin Available", value: `₦${Number(summary.marginAvailable ?? 0).toLocaleString()}` },
                      { label: "Unrealized P&L", value: `₦${Number(summary.unrealizedPnl ?? 0).toLocaleString()}` },
                      { label: "Realized P&L", value: `₦${Number(summary.realizedPnl ?? 0).toLocaleString()}` },
                      { label: "Open Orders", value: String(summary.openOrderCount ?? 0) },
                      { label: "Risk Score", value: `${summary.riskScore ?? 0}/100` },
                    ].map((row) => (
                      <div key={row.label} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{row.label}</span>
                        <span className="font-semibold text-foreground">{row.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="circuit" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div><CardTitle className="text-base">Circuit Breakers</CardTitle><CardDescription>Automatic trading halts triggered by extreme price movements</CardDescription></div>
                {cbData?.global_halt && <Badge variant="destructive">GLOBAL HALT ACTIVE</Badge>}
              </div>
            </CardHeader>
            <CardContent>
              {cbArr.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Activity className="w-10 h-10 mb-2 text-green-400" />
                  <p>No circuit breakers triggered</p>
                  <p className="text-xs mt-1">Source: {cbData?.source ?? "—"}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Symbol</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Threshold</TableHead><TableHead>Status</TableHead><TableHead>Triggered At</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {cbArr.map((cb: Record<string, unknown>, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono font-semibold">{String(cb.symbol ?? "ALL")}</TableCell>
                        <TableCell className="text-muted-foreground">{String(cb.type ?? "PRICE_LIMIT")}</TableCell>
                        <TableCell className="text-right">{Number(cb.threshold ?? 0)}%</TableCell>
                        <TableCell><StatusBadge status={String(cb.status ?? "ACTIVE")} /></TableCell>
                        <TableCell className="text-muted-foreground text-sm">{cb.triggered_at ? new Date(Number(cb.triggered_at)).toLocaleString() : "Never"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
