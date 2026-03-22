/**
 * NEXCOM Exchange — Digital Assets Trading Terminal
 * Full terminal: crypto pairs, tokenized commodities, DeFi tokens,
 * candlestick chart, live order book, recent trades, and order entry.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { createChart, CandlestickSeries } from "lightweight-charts";
import type { IChartApi, Time } from "lightweight-charts";
import { Info, Zap } from "lucide-react";
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
  CRYPTO_ASSETS, CRYPTO_CATEGORIES, type CryptoAsset, type CryptoCategory,
  simulateCryptoTick,
} from "../../../shared/instruments";

interface CryptoTick {
  price: number; bid: number; ask: number; change: number; changePct: number;
  volume: number; direction: "up" | "down" | "flat";
}
interface OBLevel { price: number; size: number; total: number; }
interface RecentTrade { id: number; price: number; size: number; side: "BUY" | "SELL"; time: string; }

function generateOrderBook(mid: number) {
  const levels = 14; const bids: OBLevel[] = []; const asks: OBLevel[] = []; let bt = 0, at = 0;
  const tick = mid > 10000 ? 1 : mid > 1000 ? 0.1 : mid > 100 ? 0.01 : mid > 1 ? 0.001 : 0.0001;
  const dp = mid > 1000 ? 2 : mid > 1 ? 4 : 6;
  for (let i = 0; i < levels; i++) {
    const bp = parseFloat((mid - tick * (i + 1) * (1 + Math.random() * 0.5)).toFixed(dp));
    const ap = parseFloat((mid + tick * (i + 1) * (1 + Math.random() * 0.5)).toFixed(dp));
    const bs = parseFloat((Math.random() * 5 + 0.01).toFixed(4));
    const as_ = parseFloat((Math.random() * 5 + 0.01).toFixed(4));
    bt += bs; at += as_;
    bids.push({ price: bp, size: bs, total: bt });
    asks.push({ price: ap, size: as_, total: at });
  }
  return { bids, asks: asks.reverse() };
}

function generateCandles(basePrice: number, count = 120) {
  const candles: { time: Time; open: number; high: number; low: number; close: number }[] = [];
  let price = basePrice * (0.92 + Math.random() * 0.16);
  const now = Math.floor(Date.now() / 1000);
  for (let i = count; i >= 0; i--) {
    const open = price; const change = (Math.random() - 0.498) * basePrice * 0.015;
    const close = Math.max(basePrice * 0.1, open + change);
    const high = Math.max(open, close) * (1 + Math.random() * 0.005);
    const low = Math.min(open, close) * (1 - Math.random() * 0.005);
    candles.push({ time: (now - i * 300) as Time, open, high, low, close }); price = close;
  }
  return candles;
}

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1D"] as const;

function fmtPrice(price: number) {
  if (price >= 1000) return price.toFixed(2);
  if (price >= 100) return price.toFixed(3);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

function fmtSize(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

const CATEGORY_COLORS: Record<string, string> = {
  LAYER1: "text-purple-400", LAYER2: "text-blue-400", DEFI: "text-emerald-400",
  STABLECOIN: "text-yellow-400", TOKENIZED: "text-orange-400", MEME: "text-pink-400",
};

export default function DigitalAssets() {
  const { user, isAuthenticated } = useAuth();
  const { t } = usePreferences();
  const [selectedCategory, setSelectedCategory] = useState<CryptoCategory>("ALL");
  const [selectedAsset, setSelectedAsset] = useState<CryptoAsset>(CRYPTO_ASSETS[0]);
  const [timeframe, setTimeframe] = useState(() =>
    localStorage.getItem("nexcom:chartInterval:digital") ?? "5m"
  );
  const [orderSide, setOrderSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT" | "STOP_LIMIT">("MARKET");
  const [quantity, setQuantity] = useState("0.01");
  const [limitPrice, setLimitPrice] = useState("");
  const [ticks, setTicks] = useState<Map<string, CryptoTick>>(new Map());
  const [orderBook, setOrderBook] = useState<{ bids: OBLevel[]; asks: OBLevel[] }>({ bids: [], asks: [] });
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmDetails, setConfirmDetails] = useState<OrderConfirmDetails | null>(null);
  const [confirmSubmitted, setConfirmSubmitted] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"chart" | "book" | "order">("chart");
  // TOTP challenge state (for large crypto orders ≥ $3,000 notional)
  const LARGE_ORDER_THRESHOLD_USD = 3_000;
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

  const filteredAssets = CRYPTO_ASSETS.filter(a =>
    selectedCategory === "ALL" || a.category === selectedCategory
  );
  const currentTick = ticks.get(selectedAsset.symbol);

  // Chart init — re-runs when instrument changes
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const chart = createChart(chartContainerRef.current, {
      layout: { background: { color: "transparent" }, textColor: "#9ca3af" },
      grid: { vertLines: { color: "#1f2937" }, horzLines: { color: "#1f2937" } },
      crosshair: { mode: 1 }, rightPriceScale: { borderColor: "#374151" },
      timeScale: { borderColor: "#374151", timeVisible: true, secondsVisible: false },
      width: chartContainerRef.current.clientWidth, height: 260,
    });
    chartRef.current = chart;
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981", downColor: "#ef4444",
      borderUpColor: "#10b981", borderDownColor: "#ef4444",
      wickUpColor: "#10b981", wickDownColor: "#ef4444",
    });
    seriesRef.current = series;
    series.setData(generateCandles(selectedAsset.basePrice));
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => {
      if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth });
    });
    ro.observe(chartContainerRef.current);
    return () => { ro.disconnect(); chart.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAsset.symbol]);

  // Live ticks — 1.5s for crypto (faster than equities)
  useEffect(() => {
    const update = () => setTicks(prev => {
      const next = new Map(prev);
      CRYPTO_ASSETS.forEach(a => next.set(a.symbol, simulateCryptoTick(a, next.get(a.symbol)?.price)));
      return next;
    });
    update();
    const id = setInterval(update, 1500);
    return () => clearInterval(id);
  }, []);

  // Push latest tick to chart
  useEffect(() => {
    if (!seriesRef.current || !currentTick) return;
    const spread = currentTick.price * 0.002;
    seriesRef.current.update({
      time: Math.floor(Date.now() / 1000) as Time,
      open: currentTick.price, high: currentTick.price + spread,
      low: currentTick.price - spread, close: currentTick.price,
    });
  }, [currentTick]);

  // Regenerate order book on tick
  useEffect(() => {
    if (!currentTick) return;
    setOrderBook(generateOrderBook(currentTick.price));
  }, [currentTick]);

  // Append to recent trades
  useEffect(() => {
    if (!currentTick) return;
    setRecentTrades(prev => [{
      id: Date.now(), price: currentTick.price,
      size: parseFloat((Math.random() * 2 + 0.001).toFixed(4)),
      side: (Math.random() > 0.5 ? "BUY" : "SELL") as "BUY" | "SELL",
      time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    }, ...prev].slice(0, 30));
  }, [currentTick]);

  const handleSubmit = useCallback(() => {
    if (!user) { toast.error("Please sign in to trade"); return; }
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) { toast.error("Invalid quantity"); return; }
    const tick = ticks.get(selectedAsset.symbol);
    const px = orderType !== "MARKET" && limitPrice ? parseFloat(limitPrice) : (tick?.price ?? selectedAsset.basePrice);
    setConfirmDetails({
      symbol: selectedAsset.symbol,
      assetClass: `Digital Asset (${selectedAsset.category})`,
      side: orderSide,
      orderType: orderType === "STOP_LIMIT" ? "STOP" : orderType,
      quantity: qty,
      price: px,
      unit: selectedAsset.symbol.replace("/USDT", "").replace("/USD", ""),
      estimatedTotal: qty * px,
      settlementDate: new Date(Date.now() + 86400000).toLocaleDateString(),
      exchange: "NEXCOM Digital",
    });
    setConfirmSubmitted(false);
    setConfirmOpen(true);
  }, [user, quantity, selectedAsset, orderSide, orderType, limitPrice, ticks]);
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
      symbol: confirmDetails.symbol, assetClass: "DIGITAL_ASSET", side: confirmDetails.side,
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
      symbol: pendingOrderDetails.symbol, assetClass: "DIGITAL_ASSET", side: pendingOrderDetails.side,
      orderType: pendingOrderDetails.orderType === "STOP" ? "STOP_LIMIT" : pendingOrderDetails.orderType,
      quantity: pendingOrderDetails.quantity,
      price: pendingOrderDetails.orderType === "MARKET" ? undefined : pendingOrderDetails.price,
      clientOrderId: crypto.randomUUID(),
    });
    setPendingOrderDetails(null);
  }, [pendingOrderDetails, createOrderMutation]);

  const maxTotal = Math.max(...orderBook.bids.map(b => b.total), ...orderBook.asks.map(a => a.total), 1);
  const catColor = CATEGORY_COLORS[selectedAsset.category] ?? "text-muted-foreground";

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
      title="Confirm Large Crypto Order"
      description="This crypto order exceeds $3,000 notional. Enter your 2FA code to authorise."
      onVerified={handleTotpVerified}
      onCancel={() => { setTotpChallengeOpen(false); setPendingOrderDetails(null); }}
    />
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card flex-shrink-0 flex-wrap gap-y-2">
        {CRYPTO_CATEGORIES.map(cat => (
          <button key={cat}
            onClick={() => {
              setSelectedCategory(cat);
              const first = cat === "ALL" ? CRYPTO_ASSETS[0] : CRYPTO_ASSETS.find(a => a.category === cat);
              if (first) setSelectedAsset(first);
            }}
            className={"px-2.5 py-1 rounded text-xs font-medium transition-colors " +
              (selectedCategory === cat ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent")}>
            {cat}
          </button>
        ))}
        <Select value={selectedAsset.symbol} onValueChange={v => {
          const a = CRYPTO_ASSETS.find(x => x.symbol === v);
          if (a) setSelectedAsset(a);
        }}>
          <SelectTrigger className="w-52 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-64">
            {filteredAssets.map(a => (
              <SelectItem key={a.symbol} value={a.symbol}>
                <span className="font-mono font-semibold">{a.symbol}</span>
                <span className="ml-2 text-muted-foreground text-xs truncate">{a.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {currentTick && (
          <div className="flex items-center gap-3 ml-1">
            <span className={"text-xl font-mono font-bold " +
              (currentTick.direction === "up" ? "text-positive" : currentTick.direction === "down" ? "text-negative" : "text-foreground")}>
              ${fmtPrice(currentTick.price)}
            </span>
            <Badge variant={currentTick.changePct >= 0 ? "default" : "destructive"} className="text-xs">
              {currentTick.changePct >= 0 ? "+" : ""}{Math.abs(currentTick.changePct).toFixed(2)}%
            </Badge>
            <span className="text-xs text-muted-foreground hidden sm:block">
              Bid: ${fmtPrice(currentTick.bid)} · Ask: ${fmtPrice(currentTick.ask)}
            </span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-positive">
            <Zap className="w-3 h-3" /><span>Live 1.5s</span>
          </div>
          {TIMEFRAMES.map(tf => (
            <button key={tf} onClick={() => { setTimeframe(tf); localStorage.setItem("nexcom:chartInterval:digital", tf); }}
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
        {/* Asset list sidebar */}
        <div className="hidden xl:flex flex-col w-52 border-r border-border bg-card/50 overflow-y-auto flex-shrink-0">
          <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">
            Digital Assets
          </div>
          {filteredAssets.map(asset => {
            const tick = ticks.get(asset.symbol);
            const isSel = asset.symbol === selectedAsset.symbol;
            const cc = CATEGORY_COLORS[asset.category] ?? "text-muted-foreground";
            return (
              <button key={asset.symbol} onClick={() => setSelectedAsset(asset)}
                className={"w-full text-left px-3 py-2 border-b border-border/50 transition-colors " +
                  (isSel ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-accent")}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-mono font-semibold">{asset.symbol.replace("USDT", "")}</span>
                    <span className={"ml-1.5 text-[9px] font-semibold " + cc}>{asset.category.slice(0, 6)}</span>
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
                    ${tick ? fmtPrice(tick.price) : fmtPrice(asset.basePrice)}
                  </span>
                  <span className="text-[9px] text-muted-foreground">USDT</span>
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
                <span className="text-[10px] text-muted-foreground font-mono">
                  {selectedAsset.symbol.replace("USDT", "")} / USDT
                </span>
              </div>
              <div className="grid grid-cols-3 px-3 py-0.5 text-[10px] text-muted-foreground border-b border-border flex-shrink-0">
                <span>Price (USDT)</span><span className="text-right">Size</span><span className="text-right">Total</span>
              </div>
              <div className="flex-1 overflow-y-auto text-xs font-mono">
                {orderBook.asks.map((l, i) => (
                  <div key={i} className="relative grid grid-cols-3 px-3 py-0.5 hover:bg-accent/50">
                    <div className="absolute inset-y-0 right-0 bg-negative/10" style={{ width: `${(l.total / maxTotal) * 100}%` }} />
                    <span className="text-negative relative z-10">{fmtPrice(l.price)}</span>
                    <span className="text-right relative z-10">{fmtSize(l.size)}</span>
                    <span className="text-right text-muted-foreground relative z-10">{fmtSize(l.total)}</span>
                  </div>
                ))}
                {currentTick && (
                  <div className="grid grid-cols-3 px-3 py-1 bg-accent/30 border-y border-border">
                    <span className={"font-bold col-span-2 " +
                      (currentTick.direction === "up" ? "text-positive" : currentTick.direction === "down" ? "text-negative" : "text-foreground")}>
                      ${fmtPrice(currentTick.price)}
                    </span>
                    <span className="text-right text-muted-foreground text-[10px]">USDT</span>
                  </div>
                )}
                {orderBook.bids.map((l, i) => (
                  <div key={i} className="relative grid grid-cols-3 px-3 py-0.5 hover:bg-accent/50">
                    <div className="absolute inset-y-0 right-0 bg-positive/10" style={{ width: `${(l.total / maxTotal) * 100}%` }} />
                    <span className="text-positive relative z-10">{fmtPrice(l.price)}</span>
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
                      spread: orderBook.bids.length > 0 && orderBook.asks.length > 0
                        ? (orderBook.asks[orderBook.asks.length - 1]?.price ?? 0) - (orderBook.bids[0]?.price ?? 0)
                        : 0,
                      spreadPct: currentTick && currentTick.price > 0 && orderBook.bids.length > 0 && orderBook.asks.length > 0
                        ? (((orderBook.asks[orderBook.asks.length - 1]?.price ?? 0) - (orderBook.bids[0]?.price ?? 0)) / currentTick.price) * 100
                        : 0,
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
                <span>Price</span><span className="text-right">Size</span><span className="text-right">Time</span>
              </div>
              <div className="flex-1 overflow-y-auto text-xs font-mono">
                {recentTrades.map(t => (
                  <div key={t.id} className="grid grid-cols-3 px-3 py-0.5 hover:bg-accent/50">
                    <span className={t.side === "BUY" ? "text-positive" : "text-negative"}>
                      {fmtPrice(t.price)}
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
              <span className="text-sm font-semibold">{selectedAsset.symbol}</span>
              <Badge variant="outline" className={"text-[10px] " + catColor}>{selectedAsset.category}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">{selectedAsset.name}</div>
            <div className="text-[10px] text-muted-foreground">
              Supply: {selectedAsset.circulatingSupply} · ATH: ${selectedAsset.allTimeHigh.toLocaleString()}
            </div>
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
                Amount ({selectedAsset.symbol.replace("USDT", "")})
              </label>
              <Input type="number" value={quantity} onChange={e => setQuantity(e.target.value)}
                step="0.001" min="0.001" className="h-9 text-sm font-mono" />
            </div>
            {/* Limit price */}
            {orderType !== "MARKET" && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  {orderType === "LIMIT" ? t("trade.limitOrder") : t("trade.stopLimit")} {t("label.price")} (USDT)
                </label>
                <Input type="number" value={limitPrice} onChange={e => setLimitPrice(e.target.value)}
                  className="h-9 text-sm font-mono"
                  placeholder={currentTick ? fmtPrice(currentTick.price) : fmtPrice(selectedAsset.basePrice)} />
              </div>
            )}
            {/* Summary */}
            {currentTick && (
              <div className="rounded-lg bg-muted/50 p-3 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Mark Price</span>
                  <span className="font-mono font-semibold">${fmtPrice(currentTick.price)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bid / Ask</span>
                  <span className="font-mono text-[10px]">
                    <span className="text-positive">{fmtPrice(currentTick.bid)}</span>
                    {" / "}
                    <span className="text-negative">{fmtPrice(currentTick.ask)}</span>
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Est. Value</span>
                  <span className="font-mono">
                    ${(parseFloat(quantity || "0") * currentTick.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">24h Change</span>
                  <span className={"font-mono " + (currentTick.changePct >= 0 ? "text-positive" : "text-negative")}>
                    {currentTick.changePct >= 0 ? "+" : ""}{currentTick.changePct.toFixed(2)}%
                  </span>
                </div>
              </div>
            )}
            <Button onClick={handleSubmit} disabled={isSubmitting}
              className={"w-full font-semibold " +
                (orderSide === "BUY" ? "bg-positive hover:bg-positive/90 text-white" : "bg-negative hover:bg-negative/90 text-white")}>
              {orderSide === "BUY"
                ? `${t("trade.buy")} ${selectedAsset.symbol.replace("USDT", "")}`
                : `${t("trade.sell")} ${selectedAsset.symbol.replace("USDT", "")}`}
            </Button>
            {!user && (
              <p className="text-xs text-muted-foreground text-center">
                <a href="/api/oauth/login" className="text-primary hover:underline">{t("trade.signInRequired")}</a>
              </p>
            )}
            {/* Asset info */}
            <div className="rounded-lg border border-border p-3 text-xs space-y-1.5 mt-auto">
              <div className="flex items-center gap-1 text-muted-foreground font-semibold mb-2">
                <Info className="w-3.5 h-3.5" /> Asset Details
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Category</span>
                <span className={catColor + " font-semibold"}>{selectedAsset.category}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pair</span>
                <span className="font-mono">{selectedAsset.symbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Circulating</span>
                <span className="font-mono">{selectedAsset.circulatingSupply}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">All-Time High</span>
                <span className="font-mono">${selectedAsset.allTimeHigh.toLocaleString()}</span>
              </div>
              {currentTick && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ATH Distance</span>
                  <span className={"font-mono " + (currentTick.price >= selectedAsset.allTimeHigh ? "text-positive" : "text-negative")}>
                    {((currentTick.price / selectedAsset.allTimeHigh - 1) * 100).toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
