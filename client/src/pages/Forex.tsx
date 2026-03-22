/**
 * NEXCOM Exchange — Forex / Currency Trading Terminal
 * Full trading terminal: instrument selector, candlestick chart,
 * live order book, recent trades, and order entry form.
 * 60+ pairs: majors, minors, NGN crosses, exotics.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { createChart, CandlestickSeries } from "lightweight-charts";
import type { IChartApi, Time } from "lightweight-charts";
import { Info } from "lucide-react";
import { OrderConfirmModal } from "@/components/OrderConfirmModal";
import type { OrderConfirmDetails } from "@/components/OrderConfirmModal";
import { TotpChallengeModal } from "@/components/TotpChallengeModal";
import OrderBookDepthChart from "@/components/OrderBookDepthChart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePreferences } from "@/contexts/PreferencesContext";
import {
  FX_PAIRS, FX_CATEGORIES, type FxPair, type FxCategory,
  simulateFxTick,
} from "../../../shared/instruments";

interface FxTick {
  price: number; bid: number; ask: number;
  change: number; changePct: number; direction: "up" | "down" | "flat";
}
interface OBLevel { price: number; size: number; total: number; }
interface RecentTrade { id: number; price: number; size: number; side: "BUY" | "SELL"; time: string; }

function generateOrderBook(mid: number, pipSize: number) {
  const levels = 14;
  const bids: OBLevel[] = []; const asks: OBLevel[] = [];
  let bt = 0, at = 0;
  const dp = pipSize < 0.001 ? 4 : pipSize < 0.01 ? 4 : 2;
  for (let i = 0; i < levels; i++) {
    const bp = parseFloat((mid - pipSize * (i + 1) * (1 + Math.random() * 0.5)).toFixed(dp));
    const ap = parseFloat((mid + pipSize * (i + 1) * (1 + Math.random() * 0.5)).toFixed(dp));
    const bs = parseFloat((Math.random() * 5 + 0.1).toFixed(2));
    const as_ = parseFloat((Math.random() * 5 + 0.1).toFixed(2));
    bt += bs; at += as_;
    bids.push({ price: bp, size: bs, total: parseFloat(bt.toFixed(2)) });
    asks.push({ price: ap, size: as_, total: parseFloat(at.toFixed(2)) });
  }
  return { bids, asks: asks.reverse() };
}

function generateCandles(basePrice: number, count = 120) {
  const candles: { time: Time; open: number; high: number; low: number; close: number }[] = [];
  let price = basePrice * (0.97 + Math.random() * 0.06);
  const now = Math.floor(Date.now() / 1000);
  for (let i = count; i >= 0; i--) {
    const open = price;
    const change = (Math.random() - 0.499) * basePrice * 0.004;
    const close = Math.max(basePrice * 0.5, open + change);
    const high = Math.max(open, close) + Math.random() * basePrice * 0.002;
    const low = Math.min(open, close) - Math.random() * basePrice * 0.002;
    candles.push({ time: (now - i * 300) as Time, open, high, low, close });
    price = close;
  }
  return candles;
}

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1D"] as const;

export default function Forex() {
  const { user, isAuthenticated } = useAuth();
  const { t } = usePreferences();
  const [selectedCategory, setSelectedCategory] = useState<FxCategory>("MAJOR");
  const [selectedPair, setSelectedPair] = useState<FxPair>(FX_PAIRS[0]);
  const [timeframe, setTimeframe] = useState(() =>
    localStorage.getItem("nexcom:chartInterval:forex") ?? "5m"
  );
  const [orderSide, setOrderSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT" | "STOP_LIMIT">("MARKET");
  const [quantity, setQuantity] = useState("0.10");
  const [limitPrice, setLimitPrice] = useState("");
  const [ticks, setTicks] = useState<Map<string, FxTick>>(new Map());
  const [orderBook, setOrderBook] = useState<{ bids: OBLevel[]; asks: OBLevel[] }>({ bids: [], asks: [] });
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmDetails, setConfirmDetails] = useState<OrderConfirmDetails | null>(null);
  const [confirmSubmitted, setConfirmSubmitted] = useState(false);
  // TOTP challenge state (for large FX orders ≥ $3,000 notional)
  const LARGE_ORDER_THRESHOLD_USD = 3_000;
  const [totpChallengeOpen, setTotpChallengeOpen] = useState(false);
  const [pendingOrderDetails, setPendingOrderDetails] = useState<OrderConfirmDetails | null>(null);
  const { data: totpStatus } = trpc.totp.getStatus.useQuery(undefined, { enabled: !!isAuthenticated });
  const [mobilePanel, setMobilePanel] = useState<"chart" | "book" | "order">("chart");

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);

  const createOrderMutation = trpc.orders.create.useMutation({
    onSuccess: () => { setConfirmSubmitted(true); setIsSubmitting(false); },
    onError: (e) => { toast.error(e.message); setIsSubmitting(false); },
  });

  const filteredPairs = selectedCategory === "ALL" ? FX_PAIRS : FX_PAIRS.filter(p => p.category === selectedCategory);
  const currentTick = ticks.get(selectedPair.symbol);
  const dp = selectedPair.pipSize < 0.001 ? 4 : selectedPair.pipSize < 0.01 ? 4 : 2;

  // Chart init
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const chart = createChart(chartContainerRef.current, {
      layout: { background: { color: "transparent" }, textColor: "#9ca3af" },
      grid: { vertLines: { color: "#1f2937" }, horzLines: { color: "#1f2937" } },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: "#374151" },
      timeScale: { borderColor: "#374151", timeVisible: true, secondsVisible: false },
      width: chartContainerRef.current.clientWidth,
      height: 260,
    });
    chartRef.current = chart;
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981", downColor: "#ef4444",
      borderUpColor: "#10b981", borderDownColor: "#ef4444",
      wickUpColor: "#10b981", wickDownColor: "#ef4444",
    });
    seriesRef.current = series;
    series.setData(generateCandles(selectedPair.basePrice));
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => {
      if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth });
    });
    ro.observe(chartContainerRef.current);
    return () => { ro.disconnect(); chart.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPair.symbol]);

  // Live ticks
  useEffect(() => {
    const update = () => setTicks(prev => {
      const next = new Map(prev);
      FX_PAIRS.forEach(pair => next.set(pair.symbol, simulateFxTick(pair, next.get(pair.symbol)?.price)));
      return next;
    });
    update();
    const id = setInterval(update, 1500);
    return () => clearInterval(id);
  }, []);

  // Update chart candle
  useEffect(() => {
    if (!seriesRef.current || !currentTick) return;
    seriesRef.current.update({
      time: Math.floor(Date.now() / 1000) as Time,
      open: currentTick.price, high: currentTick.ask,
      low: currentTick.bid, close: currentTick.price,
    });
  }, [currentTick]);

  // Order book
  useEffect(() => {
    if (!currentTick) return;
    setOrderBook(generateOrderBook(currentTick.price, selectedPair.pipSize));
  }, [currentTick, selectedPair.pipSize]);

  // Recent trades feed
  useEffect(() => {
    if (!currentTick) return;
    setRecentTrades(prev => [{
      id: Date.now(), price: currentTick.price,
      size: parseFloat((Math.random() * 2 + 0.01).toFixed(2)),
      side: (Math.random() > 0.5 ? "BUY" : "SELL") as "BUY" | "SELL",
      time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    }, ...prev].slice(0, 30));
  }, [currentTick]);

  const handleSubmit = useCallback(() => {
    if (!user) { toast.error("Please sign in to trade"); return; }
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) { toast.error("Invalid quantity"); return; }
    const tick = ticks.get(selectedPair.symbol);
    const px = orderType !== "MARKET" && limitPrice ? parseFloat(limitPrice) : (tick?.price ?? selectedPair.basePrice);
    setConfirmDetails({
      symbol: selectedPair.symbol,
      assetClass: "Forex",
      side: orderSide,
      orderType: orderType === "STOP_LIMIT" ? "STOP" : orderType,
      quantity: qty,
      price: px,
      unit: "lots",
      estimatedTotal: qty * selectedPair.lotSize * px,
      settlementDate: new Date(Date.now() + 2 * 86400000).toLocaleDateString(),
      exchange: "NEXCOM FX",
    });
    setConfirmSubmitted(false);
    setConfirmOpen(true);
  }, [user, quantity, selectedPair, orderSide, orderType, limitPrice, ticks]);
  const handleConfirmOrder = useCallback(() => {
    if (!confirmDetails) return;
    // If TOTP is enabled and order notional ≥ $3,000, require TOTP challenge
    const notional = confirmDetails.estimatedTotal ?? 0;
    if (totpStatus?.isEnabled && notional >= LARGE_ORDER_THRESHOLD_USD) {
      setPendingOrderDetails(confirmDetails);
      setConfirmOpen(false);
      setTotpChallengeOpen(true);
      return;
    }
    setIsSubmitting(true);
    createOrderMutation.mutate({
      symbol: confirmDetails.symbol, assetClass: "FOREX", side: confirmDetails.side,
      orderType: confirmDetails.orderType === "STOP" ? "STOP_LIMIT" : confirmDetails.orderType,
      quantity: confirmDetails.quantity,
      price: confirmDetails.orderType === "MARKET" ? undefined : confirmDetails.price,
      clientOrderId: crypto.randomUUID(),
    });
  }, [confirmDetails, createOrderMutation, totpStatus]);
  const handleTotpVerified = useCallback(() => {
    setTotpChallengeOpen(false);
    if (!pendingOrderDetails) return;
    setIsSubmitting(true);
    createOrderMutation.mutate({
      symbol: pendingOrderDetails.symbol, assetClass: "FOREX", side: pendingOrderDetails.side,
      orderType: pendingOrderDetails.orderType === "STOP" ? "STOP_LIMIT" : pendingOrderDetails.orderType,
      quantity: pendingOrderDetails.quantity,
      price: pendingOrderDetails.orderType === "MARKET" ? undefined : pendingOrderDetails.price,
      clientOrderId: crypto.randomUUID(),
    });
    setPendingOrderDetails(null);
  }, [pendingOrderDetails, createOrderMutation]);

  const maxTotal = Math.max(...orderBook.bids.map(b => b.total), ...orderBook.asks.map(a => a.total), 1);

  return (
    <>
    <OrderConfirmModal
      open={confirmOpen}
      details={confirmDetails}
      onConfirm={handleConfirmOrder}
      onCancel={() => { setConfirmOpen(false); setConfirmSubmitted(false); }}
      isSubmitting={createOrderMutation.isPending}
      submitted={confirmSubmitted}
      error={createOrderMutation.error?.message}
    />
    <TotpChallengeModal
      open={totpChallengeOpen}
      title="Confirm Large FX Order"
      description="This FX order exceeds $3,000 notional. Enter your 2FA code to authorise."
      onVerified={handleTotpVerified}
      onCancel={() => { setTotpChallengeOpen(false); setPendingOrderDetails(null); }}
    />
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card flex-shrink-0 flex-wrap gap-y-2">
        {FX_CATEGORIES.map(cat => (
          <button key={cat}
            onClick={() => {
              setSelectedCategory(cat);
              const first = cat === "ALL" ? FX_PAIRS[0] : FX_PAIRS.find(p => p.category === cat);
              if (first) setSelectedPair(first);
            }}
            className={"px-2.5 py-1 rounded text-xs font-medium transition-colors " + (selectedCategory === cat ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent")}>
            {cat === "NGN_CROSS" ? "NGN" : cat}
          </button>
        ))}

        <Select value={selectedPair.symbol} onValueChange={v => { const p = FX_PAIRS.find(x => x.symbol === v); if (p) setSelectedPair(p); }}>
          <SelectTrigger className="w-44 h-8 text-sm ml-1"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-64">
            {filteredPairs.map(p => (
              <SelectItem key={p.symbol} value={p.symbol}>
                <span className="font-mono font-semibold">{p.symbol}</span>
                <span className="ml-2 text-muted-foreground text-xs">{p.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {currentTick && (
          <div className="flex items-center gap-3 ml-1">
            <span className={"text-xl font-mono font-bold " + (currentTick.direction === "up" ? "text-positive" : currentTick.direction === "down" ? "text-negative" : "text-foreground")}>
              {currentTick.price.toFixed(dp)}
            </span>
            <div className="text-xs leading-tight">
                <div className="text-muted-foreground">{t("trade.bidPrice")} <span className="font-mono text-negative">{currentTick.bid.toFixed(dp)}</span></div>
              <div className="text-muted-foreground">{t("trade.askPrice")} <span className="font-mono text-positive">{currentTick.ask.toFixed(dp)}</span></div>
            </div>
            <Badge variant={currentTick.changePct >= 0 ? "default" : "destructive"} className="text-xs">
              {currentTick.changePct >= 0 ? "▲" : "▼"}{Math.abs(currentTick.changePct).toFixed(3)}%
            </Badge>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          {TIMEFRAMES.map(tf => (
            <button key={tf} onClick={() => { setTimeframe(tf); localStorage.setItem("nexcom:chartInterval:forex", tf); }}
              className={"px-2 py-1 rounded text-xs font-medium transition-colors " + (timeframe === tf ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* ── Mobile panel tabs ── */}
      <div className="flex lg:hidden border-b border-border bg-card flex-shrink-0">
        {(["chart", "book", "order"] as const).map(panel => (
          <button
            key={panel}
            onClick={() => setMobilePanel(panel)}
            className={`flex-1 py-2.5 text-xs font-semibold capitalize transition-colors ${
              mobilePanel === panel ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {panel === "chart" ? "Chart" : panel === "book" ? "Order Book" : "Order Entry"}
          </button>
        ))}
      </div>

      {/* ── Main layout ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Instrument list */}
        <div className="hidden xl:flex flex-col w-48 border-r border-border bg-card/50 overflow-y-auto flex-shrink-0">
          <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">Pairs</div>
          {filteredPairs.map(pair => {
            const tick = ticks.get(pair.symbol);
            const isSel = pair.symbol === selectedPair.symbol;
            return (
              <button key={pair.symbol} onClick={() => setSelectedPair(pair)}
                className={"w-full text-left px-3 py-2 border-b border-border/50 transition-colors " + (isSel ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-accent")}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-semibold truncate">{pair.symbol}</span>
                  {tick && (
                    <span className={"text-[10px] font-medium " + (tick.direction === "up" ? "text-positive" : tick.direction === "down" ? "text-negative" : "text-muted-foreground")}>
                      {tick.changePct >= 0 ? "+" : ""}{tick.changePct.toFixed(2)}%
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-mono text-muted-foreground">
                  {tick ? tick.price.toFixed(dp) : pair.basePrice.toFixed(dp)}
                </div>
              </button>
            );
          })}
        </div>

        {/* Chart + order book + recent trades */}
        <div className={`flex flex-col flex-1 min-w-0 overflow-hidden ${mobilePanel !== "chart" && mobilePanel !== "book" ? "hidden lg:flex" : ""}`}>
          {/* Candlestick chart */}
          <div className={`flex-shrink-0 border-b border-border bg-card/30 p-2 ${mobilePanel === "book" ? "hidden lg:block" : ""}`}>
            <div ref={chartContainerRef} className="w-full" style={{ height: 260 }} />
          </div>

          {/* Order book + recent trades */}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Order book */}
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden border-r border-border">
              <div className="px-3 py-1.5 border-b border-border flex items-center justify-between flex-shrink-0">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("trade.orderBook")}</span>
                <span className="text-[10px] text-muted-foreground font-mono">Lots</span>
              </div>
              <div className="grid grid-cols-3 px-3 py-0.5 text-[10px] text-muted-foreground border-b border-border flex-shrink-0">
                <span>Price</span><span className="text-right">Size</span><span className="text-right">Total</span>
              </div>
              <div className="flex-1 overflow-y-auto text-xs font-mono">
                {orderBook.asks.map((l, i) => (
                  <div key={i} className="relative grid grid-cols-3 px-3 py-0.5 hover:bg-accent/50">
                    <div className="absolute inset-y-0 right-0 bg-negative/10" style={{ width: `${(l.total / maxTotal) * 100}%` }} />
                    <span className="text-negative relative z-10">{l.price.toFixed(dp)}</span>
                    <span className="text-right relative z-10">{l.size.toFixed(2)}</span>
                    <span className="text-right text-muted-foreground relative z-10">{l.total.toFixed(2)}</span>
                  </div>
                ))}
                {currentTick && (
                  <div className="grid grid-cols-3 px-3 py-1 bg-accent/30 border-y border-border">
                    <span className="text-foreground font-bold col-span-2">{currentTick.price.toFixed(dp)}</span>
                    <span className="text-right text-muted-foreground text-[10px]">
                      {((currentTick.ask - currentTick.bid) / selectedPair.pipSize).toFixed(1)}p
                    </span>
                  </div>
                )}
                {orderBook.bids.map((l, i) => (
                  <div key={i} className="relative grid grid-cols-3 px-3 py-0.5 hover:bg-accent/50">
                    <div className="absolute inset-y-0 right-0 bg-positive/10" style={{ width: `${(l.total / maxTotal) * 100}%` }} />
                    <span className="text-positive relative z-10">{l.price.toFixed(dp)}</span>
                    <span className="text-right relative z-10">{l.size.toFixed(2)}</span>
                    <span className="text-right text-muted-foreground relative z-10">{l.total.toFixed(2)}</span>
                  </div>
                ))}
              </div>
              {/* Depth chart */}
              {orderBook.bids.length > 0 && (
                <div className="px-2 pb-2 pt-1 border-t border-border flex-shrink-0">
                  <OrderBookDepthChart
                    book={{
                      bids: orderBook.bids.map((l, i) => ({ price: l.price, qty: l.size, total: l.total, depth: (l.total / maxTotal) * 100 })),
                      asks: orderBook.asks.map((l, i) => ({ price: l.price, qty: l.size, total: l.total, depth: (l.total / maxTotal) * 100 })),
                      spread: currentTick ? currentTick.ask - currentTick.bid : 0,
                      spreadPct: currentTick && currentTick.price > 0 ? ((currentTick.ask - currentTick.bid) / currentTick.price) * 100 : 0,
                      midPrice: currentTick?.price ?? 0,
                      lastUpdate: Date.now(),
                    }}
                    height={100}
                  />
                </div>
              )}
            </div>

            {/* Recent trades */}
            <div className="flex flex-col w-44 flex-shrink-0 overflow-hidden">
              <div className="px-3 py-1.5 border-b border-border flex-shrink-0">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("trade.recentTrades")}</span>
              </div>
              <div className="grid grid-cols-3 px-3 py-0.5 text-[10px] text-muted-foreground border-b border-border flex-shrink-0">
                <span>Price</span><span className="text-right">Lots</span><span className="text-right">Time</span>
              </div>
              <div className="flex-1 overflow-y-auto text-xs font-mono">
                {recentTrades.map(t => (
                  <div key={t.id} className="grid grid-cols-3 px-3 py-0.5 hover:bg-accent/50">
                    <span className={t.side === "BUY" ? "text-positive" : "text-negative"}>{t.price.toFixed(dp)}</span>
                    <span className="text-right text-muted-foreground">{t.size.toFixed(2)}</span>
                    <span className="text-right text-muted-foreground text-[10px]">{t.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Order entry panel ── */}
        <div className={`flex-shrink-0 border-l border-border bg-card flex flex-col overflow-y-auto w-full lg:w-64 ${mobilePanel !== "order" ? "hidden lg:flex" : "flex"}`}>
          <div className="px-4 py-3 border-b border-border flex-shrink-0">
            <div className="text-sm font-semibold">{selectedPair.symbol}</div>
            <div className="text-xs text-muted-foreground">{selectedPair.label}</div>
          </div>
          <div className="p-4 flex flex-col gap-4 flex-1">
            {/* Buy / Sell */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-lg">
              {(["BUY", "SELL"] as const).map(s => (                <button key={s} onClick={() => setOrderSide(s)}
                className={"py-2 rounded-md text-sm font-semibold transition-colors capitalize " + (orderSide === s ? (s === "BUY" ? "bg-positive text-white shadow-sm" : "bg-negative text-white shadow-sm") : "text-muted-foreground hover:text-foreground")}>
                  {s}
                </button>
              ))}
            </div>

            {/* Order type */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t("label.type")}</label>
              <Select value={orderType} onValueChange={v => setOrderType(v as typeof orderType)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MARKET">{t("trade.marketOrder")}</SelectItem>
                  <SelectItem value="LIMIT">{t("trade.limitOrder")}</SelectItem>
                  <SelectItem value="STOP_LIMIT">{t("trade.stopLimit")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Quantity */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Lots (1 = {selectedPair.lotSize.toLocaleString()} {selectedPair.base})
              </label>
              <Input type="number" value={quantity} onChange={e => setQuantity(e.target.value)}
                step="0.01" min="0.01" className="h-9 text-sm font-mono" placeholder="0.10" />
            </div>

            {/* Limit/Stop price */}
            {orderType !== "MARKET" && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  {orderType === "LIMIT" ? t("trade.limitOrder") : t("trade.stopLimit")} {t("label.price")}
                </label>
                <Input type="number" value={limitPrice} onChange={e => setLimitPrice(e.target.value)}
                  step={selectedPair.pipSize} className="h-9 text-sm font-mono"
                  placeholder={currentTick?.price.toFixed(dp) ?? selectedPair.basePrice.toFixed(dp)} />
              </div>
            )}

            {/* Summary */}
            {currentTick && (
              <div className="rounded-lg bg-muted/50 p-3 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Exec Price</span>
                  <span className="font-mono font-semibold">
                    {(orderSide === "BUY" ? currentTick.ask : currentTick.bid).toFixed(dp)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Notional</span>
                  <span className="font-mono">
                    {(parseFloat(quantity || "0") * selectedPair.lotSize * currentTick.price).toLocaleString(undefined, { maximumFractionDigits: 0 })} {selectedPair.quote}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("trade.spread")}</span>
                  <span className="font-mono">{((currentTick.ask - currentTick.bid) / selectedPair.pipSize).toFixed(1)} pips</span>
                </div>
              </div>
            )}

            <Button onClick={handleSubmit} disabled={isSubmitting}
              className={"w-full font-semibold " + (orderSide === "BUY" ? "bg-positive hover:bg-positive/90 text-white" : "bg-negative hover:bg-negative/90 text-white")}>
              {orderSide === "BUY" ? `${t("trade.buy")} ${t("trade.placeOrder")}` : `${t("trade.sell")} ${t("trade.placeOrder")}`}
            </Button>

            {!user && (
              <p className="text-xs text-muted-foreground text-center">
                <a href="/api/oauth/login" className="text-primary hover:underline">{t("trade.signInRequired")}</a>
              </p>
            )}

            {/* Pair details */}
            <div className="rounded-lg border border-border p-3 text-xs space-y-1.5 mt-auto">
              <div className="flex items-center gap-1 text-muted-foreground font-semibold mb-2">
                <Info className="w-3.5 h-3.5" /> Pair Details
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Category</span>
                <span>{selectedPair.category.replace("_", " ")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pip Size</span>
                <span className="font-mono">{selectedPair.pipSize}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Lot Size</span>
                <span className="font-mono">{selectedPair.lotSize.toLocaleString()} {selectedPair.base}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
