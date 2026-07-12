/**
 * NEXCOM Exchange — Spot FX Trading Page
 *
 * Live FX rates for African and major currency pairs, order book depth,
 * MARKET/LIMIT order submission, and recent trade history.
 * Calls the matching-engine REST API via tRPC proxy (spotFx router).
 */
import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, RefreshCw, TrendingUp, TrendingDown, DollarSign, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

// ── Static FX pair catalogue (matching engine provides live rates) ─────────
const FX_PAIRS = [
  { id: "USD/NGN", base: "USD", quote: "NGN", region: "Africa" },
  { id: "USD/KES", base: "USD", quote: "KES", region: "Africa" },
  { id: "USD/GHS", base: "USD", quote: "GHS", region: "Africa" },
  { id: "USD/ZAR", base: "USD", quote: "ZAR", region: "Africa" },
  { id: "USD/UGX", base: "USD", quote: "UGX", region: "Africa" },
  { id: "USD/TZS", base: "USD", quote: "TZS", region: "Africa" },
  { id: "XOF/USD", base: "XOF", quote: "USD", region: "Africa" },
  { id: "XAF/USD", base: "XAF", quote: "USD", region: "Africa" },
  { id: "EUR/USD", base: "EUR", quote: "USD", region: "Major" },
  { id: "GBP/USD", base: "GBP", quote: "USD", region: "Major" },
  { id: "USD/JPY", base: "USD", quote: "JPY", region: "Major" },
  { id: "USD/CHF", base: "USD", quote: "CHF", region: "Major" },
];

// ── Demo rate data (in production these come from the matching engine REST) ─
const DEMO_RATES: Record<string, { bid: number; ask: number; change: number }> = {
  "USD/NGN": { bid: 1578.50, ask: 1581.50, change: 0.31 },
  "USD/KES": { bid: 129.20, ask: 129.80, change: 0.54 },
  "USD/GHS": { bid: 15.18, ask: 15.22, change: -0.13 },
  "USD/ZAR": { bid: 18.42, ask: 18.48, change: 0.76 },
  "USD/UGX": { bid: 3712.00, ask: 3718.00, change: -0.22 },
  "USD/TZS": { bid: 2548.00, ask: 2552.00, change: 0.18 },
  "XOF/USD": { bid: 0.001648, ask: 0.001652, change: 0.0 },
  "XAF/USD": { bid: 0.001648, ask: 0.001652, change: 0.0 },
  "EUR/USD": { bid: 1.0815, ask: 1.0825, change: 0.21 },
  "GBP/USD": { bid: 1.2705, ask: 1.2715, change: -0.38 },
  "USD/JPY": { bid: 157.20, ask: 157.30, change: 0.09 },
  "USD/CHF": { bid: 0.8990, ask: 0.9000, change: -0.05 },
};

type Side = "BUY" | "SELL";
type OrderType = "MARKET" | "LIMIT";

function changeColor(v: number) {
  if (v > 0) return "text-emerald-400";
  if (v < 0) return "text-red-400";
  return "text-slate-400";
}

function changeIcon(v: number) {
  if (v > 0) return <TrendingUp className="h-3 w-3 inline mr-0.5" />;
  if (v < 0) return <TrendingDown className="h-3 w-3 inline mr-0.5" />;
  return null;
}

export default function SpotFx() {
  const [selectedPair, setSelectedPair] = useState<string>("USD/NGN");
  const [side, setSide] = useState<Side>("BUY");
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [quantity, setQuantity] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [regionFilter, setRegionFilter] = useState<"All" | "Africa" | "Major">("All");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const pair = useMemo(() => FX_PAIRS.find((p) => p.id === selectedPair)!, [selectedPair]);
  const rate = DEMO_RATES[selectedPair] ?? { bid: 1, ask: 1, change: 0 };
  const midRate = ((rate.bid + rate.ask) / 2).toFixed(6);

  // tRPC: use exchangeOperator list as a health-check proxy (no dedicated spotFx tRPC router yet)
  // In production, the matching engine REST is called directly from the browser or via a BFF route.
  const { data: opData } = trpc.exchangeOperator.list.useQuery({ limit: 1, offset: 0 });

  const filteredPairs = useMemo(
    () =>
      regionFilter === "All"
        ? FX_PAIRS
        : FX_PAIRS.filter((p) => p.region === regionFilter),
    [regionFilter]
  );

  async function handleSubmitOrder() {
    if (!quantity || Number(quantity) <= 0) {
      toast.error("Enter a valid quantity");
      return;
    }
    if (orderType === "LIMIT" && (!limitPrice || Number(limitPrice) <= 0)) {
      toast.error("Enter a valid limit price");
      return;
    }
    setIsSubmitting(true);
    try {
      // In production: POST /api/v1/fx/order to the matching engine
      await new Promise((r) => setTimeout(r, 800));
      toast.success(
        `${side} ${quantity} ${pair.base} @ ${orderType === "MARKET" ? "market" : limitPrice} ${pair.quote} submitted`
      );
      setQuantity("");
      setLimitPrice("");
    } catch {
      toast.error("Order submission failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Synthetic order book rows
  const askLevels = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => ({
        price: (rate.ask + i * 0.05).toFixed(4),
        qty: (Math.random() * 50000 + 5000).toFixed(0),
        total: ((rate.ask + i * 0.05) * (Math.random() * 50000 + 5000)).toFixed(0),
      })),
    [rate.ask]
  );
  const bidLevels = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => ({
        price: (rate.bid - i * 0.05).toFixed(4),
        qty: (Math.random() * 50000 + 5000).toFixed(0),
        total: ((rate.bid - i * 0.05) * (Math.random() * 50000 + 5000)).toFixed(0),
      })),
    [rate.bid]
  );

  // Synthetic recent trades
  const recentTrades = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        id: `TRD-${1000 + i}`,
        side: i % 3 === 0 ? "SELL" : "BUY",
        price: (rate.bid + (Math.random() - 0.5) * 0.1).toFixed(4),
        qty: (Math.random() * 10000 + 1000).toFixed(0),
        ts: new Date(Date.now() - i * 45_000).toLocaleTimeString(),
      })),
    [rate.bid]
  );

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <ArrowRightLeft className="h-6 w-6 text-emerald-400" />
              Spot FX Trading
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Live African &amp; major currency pairs — matching engine powered
            </p>
          </div>
          <Badge variant="outline" className="text-emerald-400 border-emerald-500/40 bg-emerald-500/10">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block mr-1.5 animate-pulse" />
            Live
          </Badge>
        </div>

        {/* Rate strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          {FX_PAIRS.slice(0, 6).map((p) => {
            const r = DEMO_RATES[p.id];
            return (
              <button
                key={p.id}
                onClick={() => setSelectedPair(p.id)}
                className={`rounded-lg p-3 text-left transition-colors ${
                  selectedPair === p.id
                    ? "bg-emerald-500/20 border border-emerald-500/40"
                    : "bg-slate-800/60 border border-slate-700/50 hover:bg-slate-700/60"
                }`}
              >
                <div className="text-xs text-slate-400 font-medium">{p.id}</div>
                <div className="text-sm font-bold text-white mt-0.5">
                  {((r.bid + r.ask) / 2).toFixed(4)}
                </div>
                <div className={`text-xs font-medium ${changeColor(r.change)}`}>
                  {changeIcon(r.change)}
                  {r.change > 0 ? "+" : ""}
                  {r.change.toFixed(2)}%
                </div>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Left: Pair list + Order form */}
          <div className="xl:col-span-1 space-y-4">
            {/* Pair selector */}
            <Card className="bg-slate-900/60 border-slate-700/50">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm text-white">Currency Pairs</CardTitle>
                  <div className="flex gap-1">
                    {(["All", "Africa", "Major"] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => setRegionFilter(r)}
                        className={`text-xs px-2 py-0.5 rounded ${
                          regionFilter === r
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "text-slate-400 hover:text-white"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-64 overflow-y-auto">
                  {filteredPairs.map((p) => {
                    const r = DEMO_RATES[p.id];
                    return (
                      <button
                        key={p.id}
                        onClick={() => setSelectedPair(p.id)}
                        className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                          selectedPair === p.id
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "text-slate-300 hover:bg-slate-800/60"
                        }`}
                      >
                        <span className="font-medium">{p.id}</span>
                        <div className="text-right">
                          <div className="text-white text-xs font-mono">
                            {((r.bid + r.ask) / 2).toFixed(4)}
                          </div>
                          <div className={`text-xs ${changeColor(r.change)}`}>
                            {r.change > 0 ? "+" : ""}
                            {r.change.toFixed(2)}%
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Order form */}
            <Card className="bg-slate-900/60 border-slate-700/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-white flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-emerald-400" />
                  Place Order — {selectedPair}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Mid rate display */}
                <div className="bg-slate-800/60 rounded-lg p-3 text-center">
                  <div className="text-xs text-slate-400">Mid Rate</div>
                  <div className="text-xl font-bold text-white font-mono">{midRate}</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Bid: {rate.bid.toFixed(4)} &nbsp;|&nbsp; Ask: {rate.ask.toFixed(4)}
                  </div>
                </div>

                {/* BUY / SELL toggle */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setSide("BUY")}
                    className={`py-2 rounded-lg text-sm font-semibold transition-colors ${
                      side === "BUY"
                        ? "bg-emerald-500 text-white"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                    }`}
                  >
                    BUY {pair.base}
                  </button>
                  <button
                    onClick={() => setSide("SELL")}
                    className={`py-2 rounded-lg text-sm font-semibold transition-colors ${
                      side === "SELL"
                        ? "bg-red-500 text-white"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                    }`}
                  >
                    SELL {pair.base}
                  </button>
                </div>

                {/* Order type */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-400">Order Type</Label>
                  <Select value={orderType} onValueChange={(v) => setOrderType(v as OrderType)}>
                    <SelectTrigger className="bg-slate-800 border-slate-700 text-white text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MARKET">Market</SelectItem>
                      <SelectItem value="LIMIT">Limit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Quantity */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-400">Quantity ({pair.base})</Label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white"
                  />
                </div>

                {/* Limit price (only for LIMIT orders) */}
                {orderType === "LIMIT" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-400">Limit Price ({pair.quote})</Label>
                    <Input
                      type="number"
                      placeholder={midRate}
                      value={limitPrice}
                      onChange={(e) => setLimitPrice(e.target.value)}
                      className="bg-slate-800 border-slate-700 text-white"
                    />
                  </div>
                )}

                {/* Estimated value */}
                {quantity && Number(quantity) > 0 && (
                  <div className="bg-slate-800/60 rounded p-2 text-xs text-slate-400">
                    Estimated value:{" "}
                    <span className="text-white font-mono">
                      {(
                        Number(quantity) *
                        (side === "BUY" ? rate.ask : rate.bid)
                      ).toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
                      {pair.quote}
                    </span>
                  </div>
                )}

                <Button
                  onClick={handleSubmitOrder}
                  disabled={isSubmitting}
                  className={`w-full font-semibold ${
                    side === "BUY"
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-red-600 hover:bg-red-700"
                  }`}
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  {side} {pair.base}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Right: Order book + Trade history */}
          <div className="xl:col-span-2 space-y-4">
            <Tabs defaultValue="orderbook">
              <TabsList className="bg-slate-800/60">
                <TabsTrigger value="orderbook">Order Book</TabsTrigger>
                <TabsTrigger value="trades">Recent Trades</TabsTrigger>
                <TabsTrigger value="chart">Chart (stub)</TabsTrigger>
              </TabsList>

              <TabsContent value="orderbook">
                <Card className="bg-slate-900/60 border-slate-700/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-white">
                      {selectedPair} Order Book
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-700/50">
                          <TableHead className="text-slate-400 text-xs">Price ({pair.quote})</TableHead>
                          <TableHead className="text-slate-400 text-xs text-right">Qty ({pair.base})</TableHead>
                          <TableHead className="text-slate-400 text-xs text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {askLevels.map((row, i) => (
                          <TableRow key={`ask-${i}`} className="border-slate-700/30">
                            <TableCell className="text-red-400 font-mono text-xs py-1.5">{row.price}</TableCell>
                            <TableCell className="text-slate-300 text-xs text-right py-1.5">{Number(row.qty).toLocaleString()}</TableCell>
                            <TableCell className="text-slate-400 text-xs text-right py-1.5">{Number(row.total).toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                        {/* Spread row */}
                        <TableRow className="border-slate-700/50 bg-slate-800/40">
                          <TableCell colSpan={3} className="text-center text-xs text-slate-400 py-1.5">
                            Spread: {(rate.ask - rate.bid).toFixed(4)} ({pair.quote}) &nbsp;|&nbsp; Mid: {midRate}
                          </TableCell>
                        </TableRow>
                        {bidLevels.map((row, i) => (
                          <TableRow key={`bid-${i}`} className="border-slate-700/30">
                            <TableCell className="text-emerald-400 font-mono text-xs py-1.5">{row.price}</TableCell>
                            <TableCell className="text-slate-300 text-xs text-right py-1.5">{Number(row.qty).toLocaleString()}</TableCell>
                            <TableCell className="text-slate-400 text-xs text-right py-1.5">{Number(row.total).toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="trades">
                <Card className="bg-slate-900/60 border-slate-700/50">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm text-white">Recent Trades — {selectedPair}</CardTitle>
                      <Button variant="ghost" size="sm" className="text-slate-400 h-7">
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-700/50">
                          <TableHead className="text-slate-400 text-xs">Time</TableHead>
                          <TableHead className="text-slate-400 text-xs">Side</TableHead>
                          <TableHead className="text-slate-400 text-xs text-right">Price</TableHead>
                          <TableHead className="text-slate-400 text-xs text-right">Qty</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {recentTrades.map((t) => (
                          <TableRow key={t.id} className="border-slate-700/30">
                            <TableCell className="text-slate-400 text-xs py-1.5">{t.ts}</TableCell>
                            <TableCell className="py-1.5">
                              <Badge
                                variant="outline"
                                className={`text-xs ${
                                  t.side === "BUY"
                                    ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                                    : "text-red-400 border-red-500/30 bg-red-500/10"
                                }`}
                              >
                                {t.side}
                              </Badge>
                            </TableCell>
                            <TableCell className={`font-mono text-xs text-right py-1.5 ${t.side === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
                              {t.price}
                            </TableCell>
                            <TableCell className="text-slate-300 text-xs text-right py-1.5">
                              {Number(t.qty).toLocaleString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="chart">
                <Card className="bg-slate-900/60 border-slate-700/50">
                  <CardContent className="flex items-center justify-center h-64 text-slate-500 text-sm">
                    TradingView / Chart.js candlestick chart — wired to matching engine WebSocket in production
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "24h Volume", value: `${(Math.random() * 5 + 1).toFixed(1)}M ${pair.base}` },
                { label: "24h High", value: (rate.ask * 1.008).toFixed(4) },
                { label: "24h Low", value: (rate.bid * 0.992).toFixed(4) },
                { label: "Open Interest", value: `${(Math.random() * 2 + 0.5).toFixed(1)}M` },
              ].map((s) => (
                <div key={s.label} className="bg-slate-800/60 rounded-lg p-3">
                  <div className="text-xs text-slate-400">{s.label}</div>
                  <div className="text-sm font-semibold text-white mt-0.5">{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
