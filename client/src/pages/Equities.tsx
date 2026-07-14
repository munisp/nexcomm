/**
 * NEXCOM Exchange — Equities Trading Terminal
 * Full trading terminal: NGX + NYSE/NASDAQ stocks, candlestick chart,
 * live order book, recent trades, and order entry form.
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
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  EQUITIES, EQUITY_EXCHANGES, EQUITY_SECTORS, type Equity, type EquityExchange,
  simulateEquityTick,
} from "../../../shared/instruments";

interface EquityTick {
  price: number; change: number; changePct: number; volume: number;
  direction: "up" | "down" | "flat";
}
interface OBLevel { price: number; size: number; total: number; }
interface RecentTrade { id: number; price: number; size: number; side: "BUY" | "SELL"; time: string; }

function generateOrderBook(mid: number) {
  const levels = 14;
  const bids: OBLevel[] = []; const asks: OBLevel[] = [];
  let bt = 0, at = 0;
  const tick = mid > 1000 ? 0.5 : mid > 100 ? 0.1 : mid > 10 ? 0.05 : 0.01;
  const dp = tick < 1 ? 2 : 0;
  for (let i = 0; i < levels; i++) {
    const bp = parseFloat((mid - tick * (i + 1) * (1 + Math.random() * 0.3)).toFixed(dp));
    const ap = parseFloat((mid + tick * (i + 1) * (1 + Math.random() * 0.3)).toFixed(dp));
    const bs = Math.floor(Math.random() * 5000 + 100);
    const as_ = Math.floor(Math.random() * 5000 + 100);
    bt += bs; at += as_;
    bids.push({ price: bp, size: bs, total: bt });
    asks.push({ price: ap, size: as_, total: at });
  }
  return { bids, asks: asks.reverse() };
}

function generateCandles(basePrice: number, count = 120) {
  const candles: { time: Time; open: number; high: number; low: number; close: number }[] = [];
  let price = basePrice * (0.95 + Math.random() * 0.1);
  const now = Math.floor(Date.now() / 1000);
  for (let i = count; i >= 0; i--) {
    const open = price;
    const change = (Math.random() - 0.499) * basePrice * 0.008;
    const close = Math.max(basePrice * 0.3, open + change);
    const high = Math.max(open, close) * (1 + Math.random() * 0.003);
    const low = Math.min(open, close) * (1 - Math.random() * 0.003);
    candles.push({ time: (now - i * 300) as Time, open, high, low, close });
    price = close;
  }
  return candles;
}

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1D"] as const;

function fmtPrice(price: number, currency: string) {
  if (currency === "NGN") return price >= 1000 ? price.toFixed(0) : price.toFixed(2);
  return price.toFixed(2);
}

function fmtSize(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

export default function Equities() {
  const { user, isAuthenticated } = useAuth();
  const { t } = usePreferences();
  const [selectedExchange, setSelectedExchange] = useState<EquityExchange>("NGX");
  const [selectedSector, setSelectedSector] = useState("ALL");
  const [selectedEquity, setSelectedEquity] = useState<Equity>(EQUITIES[0]);
  const [timeframe, setTimeframe] = useState(() =>
    localStorage.getItem("nexcom:chartInterval:equities") ?? "5m"
  );
  const [orderSide, setOrderSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT" | "STOP_LIMIT">("MARKET");
  const [quantity, setQuantity] = useState("100");
  const [limitPrice, setLimitPrice] = useState("");
  const [ticks, setTicks] = useState<Map<string, EquityTick>>(new Map());
  const [orderBook, setOrderBook] = useState<{ bids: OBLevel[]; asks: OBLevel[] }>({ bids: [], asks: [] });
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmDetails, setConfirmDetails] = useState<OrderConfirmDetails | null>(null);
  const [confirmSubmitted, setConfirmSubmitted] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"chart" | "book" | "order">("chart");
  // TOTP challenge state (for large equity orders ≥ ₦5M notional)
  const LARGE_ORDER_THRESHOLD_NGN = 5_000_000;
  const [totpChallengeOpen, setTotpChallengeOpen] = useState(false);
  const [pendingOrderDetails, setPendingOrderDetails] = useState<OrderConfirmDetails | null>(null);
  const { data: totpStatus } = trpc.totp.getStatus.useQuery(undefined, { enabled: !!isAuthenticated });

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);

  const createOrderMutation = trpc.orders.create.useMutation({
    onSuccess: () => { setConfirmSubmitted(true); setIsSubmitting(false); },
    onError: (e) => { toast.error(e.message); setIsSubmitting(false); },
  });

  const filteredEquities = EQUITIES.filter(e => {
    const exchMatch = selectedExchange === "ALL" || e.exchange === selectedExchange;
    const sectMatch = selectedSector === "ALL" || e.sector === selectedSector;
    return exchMatch && sectMatch;
  });

  const currentTick = ticks.get(selectedEquity.symbol);

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
    series.setData(generateCandles(selectedEquity.basePrice));
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => {
      if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth });
    });
    ro.observe(chartContainerRef.current);
    return () => { ro.disconnect(); chart.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEquity.symbol]);

  // Live ticks
  useEffect(() => {
    const update = () => setTicks(prev => {
      const next = new Map(prev);
      EQUITIES.forEach(eq => next.set(eq.symbol, simulateEquityTick(eq, next.get(eq.symbol)?.price)));
      return next;
    });
    update();
    const id = setInterval(update, 2000);
    return () => clearInterval(id);
  }, []);

  // Update chart
  useEffect(() => {
    if (!seriesRef.current || !currentTick) return;
    const spread = currentTick.price * 0.001;
    seriesRef.current.update({
      time: Math.floor(Date.now() / 1000) as Time,
      open: currentTick.price,
      high: currentTick.price + spread,
      low: currentTick.price - spread,
      close: currentTick.price,
    });
  }, [currentTick]);

  // Order book
  useEffect(() => {
    if (!currentTick) return;
    setOrderBook(generateOrderBook(currentTick.price));
  }, [currentTick]);

  // Recent trades
  useEffect(() => {
    if (!currentTick) return;
    setRecentTrades(prev => [{
      id: Date.now(), price: currentTick.price,
      size: Math.floor(Math.random() * 10000 + 100),
      side: (Math.random() > 0.5 ? "BUY" : "SELL") as "BUY" | "SELL",
      time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    }, ...prev].slice(0, 30));
  }, [currentTick]);

  const handleSubmit = useCallback(() => {
    if (!user) { toast.error("Please sign in to trade"); return; }
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) { toast.error("Invalid quantity"); return; }
    const tick = ticks.get(selectedEquity.symbol);
    const px = orderType !== "MARKET" && limitPrice ? parseFloat(limitPrice) : (tick?.price ?? selectedEquity.basePrice);
    setConfirmDetails({
      symbol: selectedEquity.symbol,
      assetClass: `Equity (${selectedEquity.exchange})`,
      side: orderSide,
      orderType: orderType === "STOP_LIMIT" ? "STOP" : orderType,
      quantity: qty,
      price: px,
      unit: "shares",
      estimatedTotal: qty * px,
      settlementDate: new Date(Date.now() + 2 * 86400000).toLocaleDateString(),
      exchange: selectedEquity.exchange,
    });
    setConfirmSubmitted(false);
    setConfirmOpen(true);
  }, [user, quantity, selectedEquity, orderSide, orderType, limitPrice, ticks]);
  const handleConfirmOrder = useCallback(() => {
    if (!confirmDetails) return;
    // If TOTP is enabled and order notional ≥ ₦5M, require TOTP challenge
    const notional = confirmDetails.estimatedTotal ?? 0;
    if (totpStatus?.isEnabled && notional >= LARGE_ORDER_THRESHOLD_NGN) {
      setPendingOrderDetails(confirmDetails);
      setConfirmOpen(false);
      setTotpChallengeOpen(true);
      return;
    }
    setIsSubmitting(true);
    createOrderMutation.mutate({
      symbol: confirmDetails.symbol, assetClass: "EQUITY", side: confirmDetails.side,
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
      symbol: pendingOrderDetails.symbol, assetClass: "EQUITY", side: pendingOrderDetails.side,
      orderType: pendingOrderDetails.orderType === "STOP" ? "STOP_LIMIT" : pendingOrderDetails.orderType,
      quantity: pendingOrderDetails.quantity,
      price: pendingOrderDetails.orderType === "MARKET" ? undefined : pendingOrderDetails.price,
      clientOrderId: crypto.randomUUID(),
    });
    setPendingOrderDetails(null);
  }, [pendingOrderDetails, createOrderMutation]);

  const maxTotal = Math.max(...orderBook.bids.map(b => b.total), ...orderBook.asks.map(a => a.total), 1);
  const exchangeColor = selectedEquity.exchange === "NGX" ? "text-yellow-400"
    : selectedEquity.exchange === "NYSE" ? "text-blue-400" : "text-purple-400";

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
      title="Confirm Large Equity Order"
      description="This equity order exceeds ₦5M notional. Enter your 2FA code to authorise."
      onVerified={handleTotpVerified}
      onCancel={() => { setTotpChallengeOpen(false); setPendingOrderDetails(null); }}
    />
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card flex-shrink-0 flex-wrap gap-y-2">
        {EQUITY_EXCHANGES.map(ex => (
          <button key={ex}
            onClick={() => {
              setSelectedExchange(ex);
              const first = ex === "ALL" ? EQUITIES[0] : EQUITIES.find(e => e.exchange === ex);
              if (first) setSelectedEquity(first);
            }}
            className={"px-2.5 py-1 rounded text-xs font-medium transition-colors " +
              (selectedExchange === ex ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent")}>
            {ex}
          </button>
        ))}
        <Select value={selectedSector} onValueChange={setSelectedSector}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Sector" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Sectors</SelectItem>
            {EQUITY_SECTORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={selectedEquity.symbol} onValueChange={v => {
          const e = EQUITIES.find(x => x.symbol === v);
          if (e) setSelectedEquity(e);
        }}>
          <SelectTrigger className="w-52 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-64">
            {filteredEquities.map(e => (
              <SelectItem key={e.symbol} value={e.symbol}>
                <span className="font-mono font-semibold">{e.symbol}</span>
                <span className="ml-2 text-muted-foreground text-xs truncate">{e.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {currentTick && (
          <div className="flex items-center gap-3 ml-1">
            <span className={"text-xl font-mono font-bold " +
              (currentTick.direction === "up" ? "text-positive" : currentTick.direction === "down" ? "text-negative" : "text-foreground")}>
              {fmtPrice(currentTick.price, selectedEquity.currency)}
            </span>
            <span className="text-xs text-muted-foreground">{selectedEquity.currency}</span>
            <Badge variant={currentTick.changePct >= 0 ? "default" : "destructive"} className="text-xs">
              {currentTick.changePct >= 0 ? "+" : ""}{Math.abs(currentTick.changePct).toFixed(2)}%
            </Badge>
            <span className="text-xs text-muted-foreground hidden sm:block">Vol: {fmtSize(currentTick.volume)}</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          {TIMEFRAMES.map(tf => (
            <button key={tf} onClick={() => { setTimeframe(tf); localStorage.setItem("nexcom:chartInterval:equities", tf); }}
              className={"px-2 py-1 rounded text-xs font-medium transition-colors " +
                (timeframe === tf ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Mobile panel tabs */}
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

      {/* Main layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Stock list sidebar */}
        <div className="hidden xl:flex flex-col w-52 border-r border-border bg-card/50 overflow-y-auto flex-shrink-0">
          <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">
            Stocks
          </div>
          {filteredEquities.map(eq => {
            const tick = ticks.get(eq.symbol);
            const isSel = eq.symbol === selectedEquity.symbol;
            const exColor = eq.exchange === "NGX" ? "text-yellow-400"
              : eq.exchange === "NYSE" ? "text-blue-400" : "text-purple-400";
            return (
              <button key={eq.symbol} onClick={() => setSelectedEquity(eq)}
                className={"w-full text-left px-3 py-2 border-b border-border/50 transition-colors " +
                  (isSel ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-accent")}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-mono font-semibold">{eq.symbol}</span>
                    <span className={"ml-1.5 text-[9px] font-semibold " + exColor}>{eq.exchange}</span>
                  </div>
                  {tick && (
                    <span className={"text-[10px] font-medium " +
                      (tick.direction === "up" ? "text-positive" : tick.direction === "down" ? "text-negative" : "text-muted-foreground")}>
                      {tick.changePct >= 0 ? "+" : ""}{tick.changePct.toFixed(2)}%
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {tick ? fmtPrice(tick.price, eq.currency) : fmtPrice(eq.basePrice, eq.currency)}
                  </span>
                  <span className="text-[9px] text-muted-foreground">{eq.sector.slice(0, 8)}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Chart + order book */}
        <div className={`flex flex-col flex-1 min-w-0 overflow-hidden ${mobilePanel !== "chart" && mobilePanel !== "book" ? "hidden lg:flex" : ""}`}>
          <div className={`flex-shrink-0 border-b border-border bg-card/30 p-2 ${mobilePanel === "book" ? "hidden lg:block" : ""}`}>
            <div ref={chartContainerRef} className="w-full" style={{ height: 260 }} />
          </div>
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Order book */}
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden border-r border-border">
              <div className="px-3 py-1.5 border-b border-border flex items-center justify-between flex-shrink-0">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("trade.orderBook")}</span>
                <span className="text-[10px] text-muted-foreground font-mono">Shares</span>
              </div>
              <div className="grid grid-cols-3 px-3 py-0.5 text-[10px] text-muted-foreground border-b border-border flex-shrink-0">
                <span>Price</span><span className="text-right">Size</span><span className="text-right">Total</span>
              </div>
              <div className="flex-1 overflow-y-auto text-xs font-mono">
                {orderBook.asks.map((l, i) => (
                  <div key={i} className="relative grid grid-cols-3 px-3 py-0.5 hover:bg-accent/50">
                    <div className="absolute inset-y-0 right-0 bg-negative/10" style={{ width: `${(l.total / maxTotal) * 100}%` }} />
                    <span className="text-negative relative z-10">{fmtPrice(l.price, selectedEquity.currency)}</span>
                    <span className="text-right relative z-10">{fmtSize(l.size)}</span>
                    <span className="text-right text-muted-foreground relative z-10">{fmtSize(l.total)}</span>
                  </div>
                ))}
                {currentTick && (
                  <div className="grid grid-cols-3 px-3 py-1 bg-accent/30 border-y border-border">
                    <span className={"font-bold col-span-2 " +
                      (currentTick.direction === "up" ? "text-positive" : currentTick.direction === "down" ? "text-negative" : "text-foreground")}>
                      {fmtPrice(currentTick.price, selectedEquity.currency)}
                    </span>
                    <span className="text-right text-muted-foreground text-[10px]">{selectedEquity.currency}</span>
                  </div>
                )}
                {orderBook.bids.map((l, i) => (
                  <div key={i} className="relative grid grid-cols-3 px-3 py-0.5 hover:bg-accent/50">
                    <div className="absolute inset-y-0 right-0 bg-positive/10" style={{ width: `${(l.total / maxTotal) * 100}%` }} />
                    <span className="text-positive relative z-10">{fmtPrice(l.price, selectedEquity.currency)}</span>
                    <span className="text-right relative z-10">{fmtSize(l.size)}</span>
                    <span className="text-right text-muted-foreground relative z-10">{fmtSize(l.total)}</span>
                  </div>
                ))}
              </div>
              {/* Depth chart */}
              {orderBook.bids.length > 0 && (
                <div className="px-2 pb-2 pt-1 border-t border-border flex-shrink-0">
                  <OrderBookDepthChart
                    book={{
                      bids: orderBook.bids.map(l => ({ price: l.price, qty: l.size, total: l.total, depth: (l.total / maxTotal) * 100 })),
                      asks: orderBook.asks.map(l => ({ price: l.price, qty: l.size, total: l.total, depth: (l.total / maxTotal) * 100 })),
                      spread: currentTick ? (orderBook.asks[orderBook.asks.length - 1]?.price ?? 0) - (orderBook.bids[0]?.price ?? 0) : 0,
                      spreadPct: currentTick && currentTick.price > 0 ? (((orderBook.asks[orderBook.asks.length - 1]?.price ?? 0) - (orderBook.bids[0]?.price ?? 0)) / currentTick.price) * 100 : 0,
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
                <span>Price</span><span className="text-right">Shares</span><span className="text-right">Time</span>
              </div>
              <div className="flex-1 overflow-y-auto text-xs font-mono">
                {recentTrades.map(t => (
                  <div key={t.id} className="grid grid-cols-3 px-3 py-0.5 hover:bg-accent/50">
                    <span className={t.side === "BUY" ? "text-positive" : "text-negative"}>
                      {fmtPrice(t.price, selectedEquity.currency)}
                    </span>
                    <span className="text-right text-muted-foreground">{fmtSize(t.size)}</span>
                    <span className="text-right text-muted-foreground text-[10px]">{t.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Order entry panel */}
        <div className={`flex-shrink-0 border-l border-border bg-card flex flex-col overflow-y-auto w-full lg:w-64 ${mobilePanel !== "order" ? "hidden lg:flex" : "flex"}`}>
          <div className="px-4 py-3 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{selectedEquity.symbol}</span>
              <Badge variant="outline" className={"text-[10px] " + exchangeColor}>{selectedEquity.exchange}</Badge>
            </div>
            <div className="text-xs text-muted-foreground truncate">{selectedEquity.name}</div>
            <div className="text-[10px] text-muted-foreground">{selectedEquity.sector} · MCap: {selectedEquity.marketCap}</div>
          </div>
          <div className="p-4 flex flex-col gap-4 flex-1">
            {/* Buy / Sell toggle */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-lg">
              {(["BUY", "SELL"] as const).map(s => (
                <button key={s} onClick={() => setOrderSide(s)}
                  className={"py-2 rounded-md text-sm font-semibold transition-colors " +
                    (orderSide === s
                      ? s === "BUY" ? "bg-positive text-white shadow-sm" : "bg-negative text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground")}>
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
                Shares (min lot: {selectedEquity.lotSize})
              </label>
              <Input type="number" value={quantity} onChange={e => setQuantity(e.target.value)}
                step={selectedEquity.lotSize} min={selectedEquity.lotSize} className="h-9 text-sm font-mono" />
            </div>

            {/* Limit price */}
            {orderType !== "MARKET" && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  {orderType === "LIMIT" ? t("trade.limitOrder") : t("trade.stopLimit")} {t("label.price")} ({selectedEquity.currency})
                </label>
                <Input type="number" value={limitPrice} onChange={e => setLimitPrice(e.target.value)}
                  className="h-9 text-sm font-mono"
                  placeholder={currentTick
                    ? fmtPrice(currentTick.price, selectedEquity.currency)
                    : fmtPrice(selectedEquity.basePrice, selectedEquity.currency)} />
              </div>
            )}

            {/* Summary */}
            {currentTick && (
              <div className="rounded-lg bg-muted/50 p-3 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Market Price</span>
                  <span className="font-mono font-semibold">
                    {fmtPrice(currentTick.price, selectedEquity.currency)} {selectedEquity.currency}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Est. Value</span>
                  <span className="font-mono">
                    {(parseFloat(quantity || "0") * currentTick.price).toLocaleString(undefined, { maximumFractionDigits: 0 })} {selectedEquity.currency}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Day Change</span>
                  <span className={"font-mono " + (currentTick.changePct >= 0 ? "text-positive" : "text-negative")}>
                    {currentTick.changePct >= 0 ? "+" : ""}{currentTick.changePct.toFixed(2)}%
                  </span>
                </div>
              </div>
            )}

            <Button onClick={handleSubmit} disabled={isSubmitting}
              className={"w-full font-semibold " +
                (orderSide === "BUY" ? "bg-positive hover:bg-positive/90 text-white" : "bg-negative hover:bg-negative/90 text-white")}>
              {orderSide === "BUY" ? `${t("trade.buy")} Shares` : `${t("trade.sell")} Shares`}
            </Button>

            {!user && (
              <p className="text-xs text-muted-foreground text-center">
                <a href="/api/oauth/login" className="text-primary hover:underline">{t("trade.signInRequired")}</a>
              </p>
            )}

            {/* Stock info */}
            <div className="rounded-lg border border-border p-3 text-xs space-y-1.5 mt-auto">
              <div className="flex items-center gap-1 text-muted-foreground font-semibold mb-2">
                <Info className="w-3.5 h-3.5" /> Stock Details
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Exchange</span>
                <span className={exchangeColor + " font-semibold"}>{selectedEquity.exchange}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Sector</span>
                <span className="truncate max-w-[120px]">{selectedEquity.sector}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Market Cap</span>
                <span className="font-mono">{selectedEquity.marketCap}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Currency</span>
                <span>{selectedEquity.currency}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Lot Size</span>
                <span className="font-mono">{selectedEquity.lotSize} shares</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
