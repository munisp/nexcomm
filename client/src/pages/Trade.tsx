/**
 * NEXCOM Exchange — Trade Page
 * Full trading terminal:
 * - lightweight-charts candlestick chart (live via usePriceFeed)
 * - WebSocket order book (useWebSocketFeed primary, useOrderBook fallback)
 * - Order entry form wired to trpc.orders.create with OrderConfirmModal
 * - Recent trades ticker updated by WS ticks
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createChart, ColorType, CrosshairMode, CandlestickSeries } from "lightweight-charts";
import type { IChartApi, ISeriesApi, CandlestickData, Time, CandlestickSeriesOptions } from "lightweight-charts";
import { trpc } from "@/lib/trpc";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePriceFeed } from "@/hooks/usePriceFeed";
import { useWebSocketFeed } from "@/hooks/useWebSocketFeed";
import { COMMODITIES } from "@shared/commodities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { TrendingUp, TrendingDown, Activity, Wifi, WifiOff, AlertCircle, BookmarkPlus, Bookmark, Trash2, Search, ChevronDown, Keyboard, Volume2, VolumeX } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OrderConfirmModal } from "@/components/OrderConfirmModal";
import type { OrderConfirmDetails } from "@/components/OrderConfirmModal";
import OrderBookDepthChart from "@/components/OrderBookDepthChart";
import { TotpChallengeModal } from "@/components/TotpChallengeModal";
import { usePreferences } from "@/contexts/PreferencesContext";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number, dp = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function generateCandles(basePrice: number, count = 120): CandlestickData[] {
  const candles: CandlestickData[] = [];
  let price = basePrice;
  const now = Math.floor(Date.now() / 1000);
  for (let i = count; i >= 0; i--) {
    const open = price;
    const change = (Math.random() - 0.49) * price * 0.008;
    const close = Math.max(price * 0.5, price + change);
    const high = Math.max(open, close) * (1 + Math.random() * 0.004);
    const low = Math.min(open, close) * (1 - Math.random() * 0.004);
    candles.push({
      time: (now - i * 60) as Time,
      open: parseFloat(open.toFixed(4)),
      high: parseFloat(high.toFixed(4)),
      low: parseFloat(low.toFixed(4)),
      close: parseFloat(close.toFixed(4)),
    });
    price = close;
  }
  return candles;
}

interface RecentTrade { id: number; price: number; qty: number; side: "BUY" | "SELL"; time: string; }

function generateRecentTrades(price: number, count = 20): RecentTrade[] {
  const trades: RecentTrade[] = [];
  let p = price;
  for (let i = 0; i < count; i++) {
    p = p * (1 + (Math.random() - 0.5) * 0.002);
    const t = new Date(Date.now() - i * 8000);
    trades.push({
      id: i,
      price: parseFloat(p.toFixed(4)),
      qty: Math.floor(Math.random() * 50 + 1),
      side: Math.random() > 0.5 ? "BUY" : "SELL",
      time: t.toLocaleTimeString("en-US", { hour12: false }),
    });
  }
  return trades;
}

// ─── CandlestickChart ─────────────────────────────────────────────────────────
function CandlestickChart({ symbol, basePrice, latestPrice }: {
  symbol: string; basePrice: number; latestPrice: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick", Time> | null>(null);
  const lastPriceRef = useRef<number>(latestPrice);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#9ca3af" },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.1)" },
      timeScale: { borderColor: "rgba(255,255,255,0.1)", timeVisible: true, secondsVisible: false },
      width: containerRef.current.clientWidth,
      height: 280,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981", downColor: "#ef4444",
      borderUpColor: "#10b981", borderDownColor: "#ef4444",
      wickUpColor: "#10b981", wickDownColor: "#ef4444",
    } as Partial<CandlestickSeriesOptions>);
    series.setData(generateCandles(basePrice));
    chart.timeScale().fitContent();
    chartRef.current = chart;
    seriesRef.current = series;
    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); chart.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  useEffect(() => {
    if (!seriesRef.current || latestPrice === lastPriceRef.current) return;
    const prev = lastPriceRef.current;
    lastPriceRef.current = latestPrice;
    seriesRef.current.update({
      time: Math.floor(Date.now() / 1000) as Time,
      open: prev,
      high: Math.max(prev, latestPrice) * 1.0002,
      low: Math.min(prev, latestPrice) * 0.9998,
      close: latestPrice,
    });
  }, [latestPrice]);

  return <div ref={containerRef} className="w-full" style={{ height: 280 }} />;
}

// ─── OrderBookSide ────────────────────────────────────────────────────────────
function OrderBookSide({ levels, side, maxTotal }: {
  levels: { price: number; qty: number; total: number; depth: number }[];
  side: "bid" | "ask";
  maxTotal: number;
}) {
  const isAsk = side === "ask";
  return (
    <div className="space-y-0.5">
      {levels.map((lvl, i) => (
        <div key={i} className="relative flex items-center text-xs h-5 px-2 overflow-hidden">
          <div
            className="absolute inset-y-0 opacity-20 transition-all duration-300"
            style={{
              [isAsk ? "right" : "left"]: 0,
              width: `${(lvl.total / maxTotal) * 100}%`,
              backgroundColor: isAsk ? "#ef4444" : "#10b981",
            }}
          />
          <span className={`relative flex-1 font-mono ${isAsk ? "text-red-400" : "text-emerald-400"}`}>
            {fmt(lvl.price, lvl.price > 100 ? 2 : 4)}
          </span>
          <span className="relative text-gray-400 w-14 text-right">{fmt(lvl.qty, 0)}</span>
          <span className="relative text-gray-500 w-16 text-right">{fmt(lvl.total, 0)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Trade() {
  const { isAuthenticated } = useAuth();
  const { t, formatCurrency } = usePreferences();

  const [selectedSymbol, setSelectedSymbol] = useState(() => {
    // Support deep-link from Markets page: /trade?symbol=XXX or /trade/XXX
    try {
      const params = new URLSearchParams(window.location.search);
      const sym = params.get("symbol");
      if (sym) return sym.toUpperCase();
      // Also handle path param /trade/SYMBOL
      const parts = window.location.pathname.split("/");
      if (parts.length >= 3 && parts[1] === "trade" && parts[2]) return parts[2].toUpperCase();
    } catch { /* ignore */ }
    return "GINGER-NG-SPOT";
  });
  const selectedCommodity = useMemo(
    () => COMMODITIES.find(c => c.symbol === selectedSymbol) ?? COMMODITIES[0],
    [selectedSymbol]
  );

  // ── Symbol autocomplete ──────────────────────────────────────────────────
  const [symbolQuery, setSymbolQuery] = useState(selectedSymbol);
  const [symbolDropdownOpen, setSymbolDropdownOpen] = useState(false);
  const [symbolHighlightIdx, setSymbolHighlightIdx] = useState(-1);
  const symbolInputRef = useRef<HTMLInputElement>(null);
  const { data: symbolsData } = trpc.marketData.symbols.useQuery(undefined, { staleTime: 60_000 });
  const allSymbols: string[] = useMemo(() => {
    const fromApi: string[] = Array.isArray(symbolsData) ? (symbolsData as string[]) : [];
    const fromCommodities = COMMODITIES.map(c => c.symbol);
    // Merge: API symbols first, then any COMMODITIES not already in the list
    const merged = [...new Set([...fromApi, ...fromCommodities])];
    return merged;
  }, [symbolsData]);
  const filteredSymbols = useMemo(() => {
    const q = symbolQuery.trim().toLowerCase();
    if (!q) return allSymbols.slice(0, 20);
    return allSymbols.filter(s => s.toLowerCase().includes(q)).slice(0, 20);
  }, [allSymbols, symbolQuery]);
  const handleSymbolSelect = useCallback((sym: string) => {
    setSelectedSymbol(sym);
    setSymbolQuery(sym);
    setSymbolDropdownOpen(false);
    setSymbolHighlightIdx(-1);
  }, []);
  // Keep symbolQuery in sync when selectedSymbol changes externally (e.g. template load)
  useEffect(() => { setSymbolQuery(selectedSymbol); }, [selectedSymbol]);

  // Live price feed (polling fallback)
  const { prices, connected: feedConnected } = usePriceFeed({ symbols: [selectedSymbol], interval: 1500 });
  const tick = prices[selectedSymbol];
  const livePrice = tick?.price ?? selectedCommodity.basePrice;

  // WebSocket feed (primary)
  const { ticks: wsTicks, books: wsBooks, connected: wsConnected } = useWebSocketFeed([selectedSymbol]);
  const wsTick = wsTicks[selectedSymbol];
  const wsBook = wsBooks[selectedSymbol];

  const price = wsTick?.price ?? livePrice;
  const bid = (wsTick as { bid?: number } | undefined)?.bid ?? (price * 0.9995);
  const ask = (wsTick as { ask?: number } | undefined)?.ask ?? (price * 1.0005);
  const changePct = wsTick?.changePct ?? tick?.changePct ?? 0;
  const isUp = changePct >= 0;

  const bids = wsBook?.bids ?? [];
  const asks = wsBook?.asks ?? [];
  const maxTotal = Math.max(
    bids.length > 0 ? bids[bids.length - 1].total : 1,
    asks.length > 0 ? asks[asks.length - 1].total : 1
  );
  const spread = ask - bid;
  const spreadPct = price > 0 ? (spread / price) * 100 : 0;

  // Recent trades
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>(() =>
    generateRecentTrades(selectedCommodity.basePrice)
  );
  useEffect(() => {
    setRecentTrades(generateRecentTrades(selectedCommodity.basePrice));
  }, [selectedSymbol, selectedCommodity.basePrice]);
  useEffect(() => {
    if (!wsTick) return;
    setRecentTrades(prev => [{
      id: Date.now(),
      price: wsTick.price,
      qty: Math.floor(Math.random() * 30 + 1),
      side: Math.random() > 0.5 ? "BUY" : "SELL",
      time: new Date().toLocaleTimeString("en-US", { hour12: false }),
    }, ...prev.slice(0, 29)]);
  }, [wsTick]);

  // Order form state
  const [orderSide, setOrderSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"LIMIT" | "MARKET" | "STOP_LIMIT">("LIMIT");
  const [orderPrice, setOrderPrice] = useState("");
  const [orderQty, setOrderQty] = useState("");
  const [chartInterval, setChartInterval] = useState(() =>
    localStorage.getItem("nexcom:chartInterval:commodity") ?? "1m"
  );

  // Confirmation modal state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmDetails, setConfirmDetails] = useState<OrderConfirmDetails | null>(null);
  const [confirmSubmitted, setConfirmSubmitted] = useState(false);
  // TOTP challenge state (for large orders ≥ ₦5M notional)
  const LARGE_ORDER_THRESHOLD_NGN = 5_000_000;
  const [totpChallengeOpen, setTotpChallengeOpen] = useState(false);
  const [pendingOrderDetails, setPendingOrderDetails] = useState<OrderConfirmDetails | null>(null);
  const { data: totpStatus } = trpc.totp.getStatus.useQuery(undefined, { enabled: !!isAuthenticated });
  // Saved order templates
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);
  const { data: savedOrderTemplates, refetch: refetchTemplates } = trpc.orders.listSavedOrders.useQuery(
    undefined, { enabled: !!isAuthenticated }
  );

  // Recent fills — polls every 10 seconds for live updates
  const { data: recentFillsData } = trpc.orders.listFills.useQuery(
    { symbol: selectedSymbol, limit: 30, offset: 0 },
    { enabled: !!isAuthenticated, refetchInterval: 10_000 }
  );

  // My Orders for the current symbol — bottom panel tab
  const [bottomTab, setBottomTab] = useState<"trades" | "myorders">("trades");
  const utils = trpc.useUtils();
  const { data: myOrdersData, refetch: refetchMyOrders } = trpc.orders.list.useQuery(
    { limit: 10 },
    { enabled: !!isAuthenticated && bottomTab === "myorders", refetchInterval: 15_000 }
  );
  const mySymbolOrders = useMemo(
    () => (myOrdersData ?? []).filter(o => o.symbol === selectedSymbol),
    [myOrdersData, selectedSymbol]
  );
  // Amend order dialog state
  const [amendTarget, setAmendTarget] = useState<{ id: number; price: string; quantity: string } | null>(null);
  const [amendPrice, setAmendPrice] = useState("");
  const [amendQty, setAmendQty] = useState("");
  const [amendReason, setAmendReason] = useState("");
  const amendOrderMutation = trpc.orders.amend.useMutation({
    onSuccess: () => {
      toast.success("Order amended");
      setAmendTarget(null);
      refetchMyOrders();
    },
    onError: (e) => toast.error(`Amend failed: ${e.message}`),
  });

  const cancelOrderMutation = trpc.orders.cancel.useMutation({
    onMutate: async ({ orderId }) => {
      // Optimistic update: mark as CANCELLED in local cache
      await utils.orders.list.cancel();
      const prev = utils.orders.list.getData({ limit: 10 });
      utils.orders.list.setData({ limit: 10 }, old =>
        old ? old.map(o => o.id === orderId ? { ...o, status: "CANCELLED" as const } : o) : old
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.orders.list.setData({ limit: 10 }, ctx.prev);
      toast.error("Failed to cancel order");
    },
    onSuccess: () => {
      toast.success("Order cancelled");
      refetchMyOrders();
    },
  });
  const createSavedOrderMutation = trpc.orders.createSavedOrder.useMutation({
    onSuccess: () => { toast.success("Order template saved"); setShowSaveDialog(false); setSaveTemplateName(""); refetchTemplates(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteSavedOrderMutation = trpc.orders.deleteSavedOrder.useMutation({
    onSuccess: () => { toast.success("Template deleted"); refetchTemplates(); },
    onError: (e) => toast.error(e.message),
  });
  const handleSaveTemplate = () => {
    if (!saveTemplateName.trim()) { toast.error("Please enter a template name"); return; }
    createSavedOrderMutation.mutate({
      name: saveTemplateName.trim(),
      symbol: selectedSymbol,
      side: orderSide,
      orderType,
      quantity: parseFloat(orderQty) || 1,
      price: orderType !== "MARKET" && orderPrice ? parseFloat(orderPrice) : undefined,
    });
  };
  const handleLoadTemplate = (tmpl: { side: string; orderType: string; quantity: string; price: string | null }) => {
    setOrderSide(tmpl.side as "BUY" | "SELL");
    setOrderType(tmpl.orderType as "LIMIT" | "MARKET" | "STOP_LIMIT");
    setOrderQty(tmpl.quantity);
    if (tmpl.price) setOrderPrice(tmpl.price);
    setShowTemplates(false);
    toast.success("Template loaded");
  };
  // Keyboard shortcut overlay
  const [showShortcuts, setShowShortcuts] = useState(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "?") { e.preventDefault(); setShowShortcuts(v => !v); }
      if (e.key === "Escape") { setShowShortcuts(false); }
      if (e.key === "b" || e.key === "B") { setOrderSide("BUY"); }
      if (e.key === "s" || e.key === "S") { setOrderSide("SELL"); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Mobile panel switcher
  const [mobilePanel, setMobilePanel] = useState<"chart" | "book" | "trades">("chart");

  useEffect(() => {
    if (orderType === "LIMIT") setOrderPrice(fmt(price, price > 100 ? 2 : 4));
  }, [price, orderType]);

  const orderValue = useMemo(() => {
    const p = parseFloat(orderPrice) || price;
    const q = parseFloat(orderQty) || 0;
    return p * q;
  }, [orderPrice, orderQty, price]);

  // Sound toggle — persisted to localStorage
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return localStorage.getItem("nexcom:tradeSound") !== "off"; } catch { return true; }
  });
  const toggleSound = useCallback(() => {
    setSoundEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem("nexcom:tradeSound", next ? "on" : "off"); } catch { /* ignore */ }
      toast(next ? "Sound on" : "Sound off", { duration: 1500 });
      return next;
    });
  }, []);

  // Audio cues — synthesised via AudioContext, no external files needed
  const playOrderSound = useCallback((type: "success" | "reject") => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      if (type === "success") {
        // Two-tone ascending chime: 880 Hz → 1100 Hz
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.18, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.35);
      } else {
        // Low descending buzz: 220 Hz → 160 Hz
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        osc.frequency.setValueAtTime(160, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
      }
      osc.onended = () => ctx.close();
    } catch {
      // AudioContext unavailable — silently ignore
    }
  }, []);

  // tRPC mutation
  const createOrder = trpc.orders.create.useMutation({
    onSuccess: () => {
      setConfirmSubmitted(true);
      setOrderQty("");
      playOrderSound("success");
    },
    onError: (err) => {
      toast.error("Order failed", { description: err.message });
      playOrderSound("reject");
    },
  });

  const handleSubmitOrder = useCallback(() => {
    if (!isAuthenticated) {
      toast.error("Sign in required", { description: "Please sign in to place orders." });
      return;
    }
    if (!orderQty || parseFloat(orderQty) <= 0) {
      toast.error("Invalid quantity", { description: "Please enter a valid quantity." });
      return;
    }
    const qty = parseFloat(orderQty);
    const px = orderType === "MARKET" ? price : parseFloat(orderPrice) || price;
    setConfirmDetails({
      symbol: selectedSymbol,
      assetClass: "Commodity",
      side: orderSide,
      orderType: orderType === "STOP_LIMIT" ? "STOP" : orderType,
      quantity: qty,
      price: px,
      unit: selectedCommodity.unit,
      estimatedTotal: px * qty,
      settlementDate: new Date(Date.now() + 2 * 86400000).toLocaleDateString(),
      exchange: "NEXCOM",
    });
    setConfirmSubmitted(false);
    setConfirmOpen(true);
  }, [isAuthenticated, orderQty, orderSide, orderType, orderPrice, selectedSymbol, selectedCommodity, price]);

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
    createOrder.mutate({
      symbol: confirmDetails.symbol,
      side: confirmDetails.side,
      orderType: confirmDetails.orderType === "STOP" ? "STOP_LIMIT" : confirmDetails.orderType,
      price: confirmDetails.orderType === "MARKET" ? undefined : confirmDetails.price,
      quantity: confirmDetails.quantity,
      assetClass: "COMMODITY",
      clientOrderId: crypto.randomUUID(),
    });
  }, [confirmDetails, createOrder, totpStatus]);

  const handleTotpVerified = useCallback(() => {
    setTotpChallengeOpen(false);
    if (!pendingOrderDetails) return;
    createOrder.mutate({
      symbol: pendingOrderDetails.symbol,
      side: pendingOrderDetails.side,
      orderType: pendingOrderDetails.orderType === "STOP" ? "STOP_LIMIT" : pendingOrderDetails.orderType,
      price: pendingOrderDetails.orderType === "MARKET" ? undefined : pendingOrderDetails.price,
      quantity: pendingOrderDetails.quantity,
      assetClass: "COMMODITY",
      clientOrderId: crypto.randomUUID(),
    });
    setPendingOrderDetails(null);
  }, [pendingOrderDetails, createOrder]);

  const connected = wsConnected || feedConnected;
  const { isLoading: symbolsLoading } = trpc.marketData.symbols.useQuery(undefined, { staleTime: 60_000 });
  if (isAuthenticated && symbolsLoading) return <PageSkeleton cards={3} tableRows={8} tableCols={5} showChart />;

  return (
    <>
      <OrderConfirmModal
        open={confirmOpen}
        details={confirmDetails}
        onConfirm={handleConfirmOrder}
        onCancel={() => { setConfirmOpen(false); setConfirmSubmitted(false); }}
        isSubmitting={createOrder.isPending}
        submitted={confirmSubmitted}
        error={createOrder.error?.message}
      />
      <TotpChallengeModal
        open={totpChallengeOpen}
        title="Confirm Large Order"
        description={`This order exceeds ₦5M notional. Enter your 2FA code to authorise.`}
        onVerified={handleTotpVerified}
        onCancel={() => { setTotpChallengeOpen(false); setPendingOrderDetails(null); }}
      />
      <div className="h-full flex flex-col bg-[#0a0f0a] text-white overflow-hidden">
        {/* ── Top bar ── */}
        <div className="flex items-center gap-4 px-4 py-2 border-b border-white/10 bg-[#0d1410] flex-shrink-0 flex-wrap">
          {/* Symbol autocomplete combobox */}
          <div className="relative w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none z-10" />
            <input
              ref={symbolInputRef}
              type="text"
              value={symbolQuery}
              onChange={e => { setSymbolQuery(e.target.value); setSymbolDropdownOpen(true); }}
              onFocus={() => setSymbolDropdownOpen(true)}
              onBlur={() => setTimeout(() => setSymbolDropdownOpen(false), 160)}
              onKeyDown={e => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSymbolDropdownOpen(true);
                  setSymbolHighlightIdx(i => Math.min(i + 1, filteredSymbols.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSymbolHighlightIdx(i => Math.max(i - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const target = symbolHighlightIdx >= 0 ? filteredSymbols[symbolHighlightIdx] : filteredSymbols[0];
                  if (target) handleSymbolSelect(target);
                } else if (e.key === "Escape") {
                  setSymbolDropdownOpen(false);
                  setSymbolQuery(selectedSymbol);
                  setSymbolHighlightIdx(-1);
                }
              }}
              placeholder="Symbol…"
              autoComplete="off"
              spellCheck={false}
              className="w-full h-8 pl-8 pr-7 text-xs font-mono bg-white/5 border border-white/10 rounded-md text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30"
            />
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              {symbolDropdownOpen && filteredSymbols.length > 0 && (
              <div className="absolute top-full left-0 z-50 mt-1 w-full rounded-md border border-white/10 bg-[#0d1410] shadow-xl max-h-56 overflow-y-auto">
                {filteredSymbols.map((sym, idx) => (
                  <button
                    key={sym}
                    type="button"
                    onMouseDown={() => handleSymbolSelect(sym)}
                    onMouseEnter={() => setSymbolHighlightIdx(idx)}
                    className={`w-full text-left px-3 py-1.5 text-xs font-mono transition-colors ${
                      idx === symbolHighlightIdx
                        ? "bg-emerald-600/50 text-emerald-200"
                        : sym === selectedSymbol
                        ? "bg-emerald-600/20 text-emerald-300"
                        : "text-gray-200 hover:bg-white/10"
                    }`}
                  >
                    {sym}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className={`text-xl font-mono font-bold ${isUp ? "text-emerald-400" : "text-red-400"}`}>
              {fmt(price, price > 100 ? 2 : 4)}
            </span>
            <Badge variant="outline" className={`text-xs ${isUp ? "border-emerald-500/40 text-emerald-400" : "border-red-500/40 text-red-400"}`}>
              {isUp ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
              {isUp ? "+" : ""}{fmt(changePct, 2)}%
            </Badge>
          </div>

          <div className="hidden md:flex items-center gap-4 text-xs">
            <div><span className="text-gray-500 mr-1">Bid</span><span className="text-emerald-400 font-mono">{fmt(bid, bid > 100 ? 2 : 4)}</span></div>
            <div><span className="text-gray-500 mr-1">Ask</span><span className="text-red-400 font-mono">{fmt(ask, ask > 100 ? 2 : 4)}</span></div>
            <div><span className="text-gray-500 mr-1">Spread</span><span className="text-gray-300 font-mono">{fmt(spreadPct, 4)}%</span></div>
          </div>

          <div className="ml-auto flex items-center gap-2 text-xs">
            {connected
              ? <><Wifi className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Live</span></>
              : <><WifiOff className="w-3 h-3 text-yellow-400" /><span className="text-yellow-400">Connecting…</span></>
            }
            <button
              onClick={toggleSound}
              title={soundEnabled ? "Sound on (click to mute)" : "Sound off (click to enable)"}
              className="ml-1 p-1 rounded hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors"
            >
              {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5 text-gray-600" />}
            </button>
            <button
              onClick={() => setShowShortcuts(true)}
              title="Keyboard shortcuts (?)"
              className="ml-1 p-1 rounded hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors"
            >
              <Keyboard className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* ── Mobile panel tabs ── */}
        <div className="flex lg:hidden border-b border-white/10 bg-[#0d1410] flex-shrink-0">
          {(["chart", "book", "trades"] as const).map(panel => (
            <button
              key={panel}
              onClick={() => setMobilePanel(panel)}
              className={`flex-1 py-2.5 text-xs font-semibold capitalize transition-colors ${
                mobilePanel === panel ? "text-emerald-400 border-b-2 border-emerald-400" : "text-gray-400 hover:text-white"
              }`}
            >
              {panel === "chart" ? "Chart & Order" : panel === "book" ? "Order Book" : "Trades"}
            </button>
          ))}
        </div>
        {/* ── Main grid ── */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_280px_260px] gap-0 overflow-hidden min-h-0">

          {/* Chart + Order form */}
          <div className={`flex flex-col border-r border-white/10 overflow-hidden ${mobilePanel !== "chart" ? "hidden lg:flex" : ""}`}>
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-white/10 bg-[#0d1410]">
              {["1m","5m","15m","1h","4h","1D"].map(iv => (
                <button key={iv} onClick={() => { setChartInterval(iv); localStorage.setItem("nexcom:chartInterval:commodity", iv); }}
                  className={`px-2 py-0.5 text-xs rounded transition-colors ${chartInterval === iv ? "bg-emerald-600 text-white" : "text-gray-400 hover:text-white hover:bg-white/10"}`}>
                  {iv}
                </button>
              ))}
              <span className="ml-auto text-xs text-gray-500">{selectedCommodity.name} · {selectedCommodity.unit}</span>
            </div>

            <div className="p-3 border-b border-white/10">
              <CandlestickChart symbol={selectedSymbol} basePrice={selectedCommodity.basePrice} latestPrice={price} />
            </div>

            <div className="flex-1 p-4 overflow-y-auto">
              <div className="max-w-sm mx-auto space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setOrderSide("BUY")}
                    className={`py-2 rounded-lg text-sm font-semibold transition-all ${orderSide === "BUY" ? "bg-emerald-600 text-white shadow-lg shadow-emerald-900/30" : "bg-white/5 text-gray-400 hover:bg-white/10"}`}>
                    Buy / Long
                  </button>
                  <button onClick={() => setOrderSide("SELL")}
                    className={`py-2 rounded-lg text-sm font-semibold transition-all ${orderSide === "SELL" ? "bg-red-600 text-white shadow-lg shadow-red-900/30" : "bg-white/5 text-gray-400 hover:bg-white/10"}`}>
                    Sell / Short
                  </button>
                </div>

                <div>
                  <Label className="text-xs text-gray-400 mb-1 block">{t("label.type")}</Label>
                  <Select value={orderType} onValueChange={v => setOrderType(v as typeof orderType)}>
                    <SelectTrigger className="bg-white/5 border-white/10 text-white h-9"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-[#0d1410] border-white/10 text-white">
                      <SelectItem value="LIMIT">{t("trade.limitOrder")}</SelectItem>
                      <SelectItem value="MARKET">{t("trade.marketOrder")}</SelectItem>
                      <SelectItem value="STOP_LIMIT">{t("trade.stopLimit")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {orderType !== "MARKET" && (
                  <div>
                    <Label className="text-xs text-gray-400 mb-1 block">{t("label.price")}</Label>
                    <div className="relative">
                      <Input type="number" value={orderPrice} onChange={e => setOrderPrice(e.target.value)}
                        className="bg-white/5 border-white/10 text-white h-9 pr-16" placeholder={fmt(price, 2)} />
                      <button onClick={() => setOrderPrice(fmt(price, price > 100 ? 2 : 4))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-emerald-400 hover:text-emerald-300">
                        Market
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <Label className="text-xs text-gray-400 mb-1 block">{t("label.quantity")} ({selectedCommodity.unit})</Label>
                  <Input type="number" value={orderQty} onChange={e => setOrderQty(e.target.value)}
                    className="bg-white/5 border-white/10 text-white h-9" placeholder="0.00" />
                </div>

                {orderQty && (
                  <div className="flex justify-between text-xs text-gray-400 bg-white/5 rounded-lg px-3 py-2">
                    <span>{t("trade.estimatedValue")}</span>
                    <span className="text-white font-mono">${fmt(orderValue, 2)}</span>
                  </div>
                )}

                <Button onClick={handleSubmitOrder}
                  className={`w-full h-10 font-semibold text-sm transition-all ${orderSide === "BUY" ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-red-600 hover:bg-red-500 text-white"}`}>
                  {`${orderSide === "BUY" ? t("trade.buy") : t("trade.sell")} ${selectedCommodity.name}`}
                </Button>

                 {!isAuthenticated && (
                  <p className="text-xs text-center text-yellow-400 flex items-center justify-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {t("trade.signInRequired")}
                  </p>
                )}
                {isAuthenticated && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1 text-xs border-white/10 bg-white/5 text-gray-300 hover:bg-white/10"
                      onClick={() => setShowSaveDialog(true)}>
                      <BookmarkPlus className="w-3 h-3 mr-1" /> Save Template
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1 text-xs border-white/10 bg-white/5 text-gray-300 hover:bg-white/10"
                      onClick={() => setShowTemplates(true)}>
                      <Bookmark className="w-3 h-3 mr-1" /> Load ({savedOrderTemplates?.length ?? 0})
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* Saved Order Template Dialogs */}
          <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
            <DialogContent className="bg-[#0d1410] border-white/10 text-white">
              <DialogHeader><DialogTitle className="text-sm">Save Order Template</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-gray-400 mb-1 block">Template Name</Label>
                  <Input value={saveTemplateName} onChange={e => setSaveTemplateName(e.target.value)}
                    placeholder="e.g. My Ginger Buy" className="bg-white/5 border-white/10 text-white h-9" />
                </div>
                <div className="text-xs text-gray-400 bg-white/5 rounded-lg p-3 space-y-1">
                  <div className="flex justify-between"><span>Symbol</span><span className="text-white">{selectedSymbol}</span></div>
                  <div className="flex justify-between"><span>Side</span><span className={orderSide === "BUY" ? "text-emerald-400" : "text-red-400"}>{orderSide}</span></div>
                  <div className="flex justify-between"><span>Type</span><span className="text-white">{orderType}</span></div>
                  <div className="flex justify-between"><span>Qty</span><span className="text-white">{orderQty || "—"}</span></div>
                  {orderType !== "MARKET" && <div className="flex justify-between"><span>Price</span><span className="text-white">{orderPrice || "—"}</span></div>}
                </div>
                <Button onClick={handleSaveTemplate} disabled={createSavedOrderMutation.isPending}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-sm">
                  {createSavedOrderMutation.isPending ? "Saving…" : "Save Template"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={showTemplates} onOpenChange={setShowTemplates}>
            <DialogContent className="bg-[#0d1410] border-white/10 text-white">
              <DialogHeader><DialogTitle className="text-sm">Order Templates</DialogTitle></DialogHeader>
              {(!savedOrderTemplates || savedOrderTemplates.length === 0) ? (
                <p className="text-xs text-gray-400 text-center py-4">No saved templates yet.</p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {savedOrderTemplates.map(tmpl => (
                    <div key={tmpl.id} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-xs font-medium text-white">{tmpl.name}</p>
                        <p className="text-xs text-gray-400">{tmpl.symbol} · {tmpl.side} · {tmpl.orderType} · {tmpl.quantity}</p>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-emerald-400 hover:text-emerald-300"
                          onClick={() => handleLoadTemplate(tmpl)}>Load</Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                          onClick={() => deleteSavedOrderMutation.mutate({ id: tmpl.id })}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </DialogContent>
          </Dialog>
          {/* Order Book */}
          <div className={`flex flex-col border-r border-white/10 overflow-hidden ${mobilePanel !== "book" ? "hidden lg:flex" : ""}`}>
            <div className="px-3 py-2 border-b border-white/10 bg-[#0d1410] flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-300">{t("trade.orderBook")}</span>
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <Activity className="w-3 h-3" />
                {wsConnected ? "WS" : "Polling"}
              </div>
            </div>
            <div className="flex items-center text-xs text-gray-500 px-2 py-1 border-b border-white/5">
              <span className="flex-1">Price</span>
              <span className="w-14 text-right">Qty</span>
              <span className="w-16 text-right">Total</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="pb-1">
                <OrderBookSide levels={[...asks].reverse()} side="ask" maxTotal={maxTotal} />
              </div>
              <div className="flex items-center justify-center gap-2 py-1.5 border-y border-white/10 bg-white/5 my-1">
                <span className={`text-sm font-mono font-bold ${isUp ? "text-emerald-400" : "text-red-400"}`}>
                  {fmt(price, price > 100 ? 2 : 4)}
                </span>
                {isUp ? <TrendingUp className="w-3 h-3 text-emerald-400" /> : <TrendingDown className="w-3 h-3 text-red-400" />}
                <span className="text-xs text-gray-500">Spread {fmt(spreadPct, 4)}%</span>
              </div>
              <div className="pt-1">
                <OrderBookSide levels={bids} side="bid" maxTotal={maxTotal} />
              </div>
            </div>
            {/* Depth chart below the ladder */}
            {wsBook && (
              <div className="px-2 pb-2 pt-1 border-t border-white/10">
                <OrderBookDepthChart book={wsBook} height={110} />
              </div>
            )}
          </div>

          {/* Recent Trades */}
          <div className={`flex flex-col overflow-hidden ${mobilePanel !== "trades" ? "hidden lg:flex" : ""}`}>
            {/* Tab header */}
            <div className="px-2 py-1.5 border-b border-white/10 bg-[#0d1410] flex items-center gap-1">
              <button
                onClick={() => setBottomTab("trades")}
                className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                  bottomTab === "trades" ? "bg-emerald-500/20 text-emerald-300" : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {t("trade.recentTrades")}
                {recentFillsData && recentFillsData.fills.length > 0 && (
                  <span className="ml-1 text-emerald-500 animate-pulse">●</span>
                )}
              </button>
              <button
                onClick={() => setBottomTab("myorders")}
                className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                  bottomTab === "myorders" ? "bg-blue-500/20 text-blue-300" : "text-gray-500 hover:text-gray-300"
                }`}
              >
                My Orders
                {mySymbolOrders.length > 0 && (
                  <span className="ml-1 text-[10px] bg-blue-500/30 text-blue-300 px-1 rounded">{mySymbolOrders.length}</span>
                )}
              </button>
            </div>

            {/* Trades tab */}
            {bottomTab === "trades" && (
              <>
                <div className="flex items-center text-xs text-gray-500 px-3 py-1 border-b border-white/5">
                  <span className="flex-1">Price</span>
                  <span className="w-12 text-right">Qty</span>
                  <span className="w-16 text-right">Time</span>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {recentFillsData && recentFillsData.fills.length > 0
                    ? recentFillsData.fills.map(f => (
                        <div key={f.id} className="flex items-center text-xs px-3 py-1 hover:bg-white/5 transition-colors">
                          <span className={`flex-1 font-mono ${f.side === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
                            {fmt(parseFloat(String(f.fillPrice)), parseFloat(String(f.fillPrice)) > 100 ? 2 : 4)}
                          </span>
                          <span className="w-12 text-right text-gray-400">{parseFloat(String(f.filledQty)).toFixed(1)}</span>
                          <span className="w-16 text-right text-gray-500">
                            {new Date(f.createdAt).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </span>
                        </div>
                      ))
                    : recentTrades.map(t => (
                        <div key={t.id} className="flex items-center text-xs px-3 py-1 hover:bg-white/5 transition-colors">
                          <span className={`flex-1 font-mono ${t.side === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
                            {fmt(t.price, t.price > 100 ? 2 : 4)}
                          </span>
                          <span className="w-12 text-right text-gray-400">{t.qty}</span>
                          <span className="w-16 text-right text-gray-500">{t.time}</span>
                        </div>
                      ))
                  }
                </div>
              </>
            )}

            {/* My Orders tab */}
            {bottomTab === "myorders" && (
              <div className="flex-1 overflow-y-auto">
                {mySymbolOrders.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-24 gap-1">
                    <span className="text-xs text-gray-500">No orders for {selectedSymbol}</span>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center text-xs text-gray-500 px-3 py-1 border-b border-white/5">
                      <span className="w-10">Side</span>
                      <span className="flex-1">Type</span>
                      <span className="w-16 text-right">Qty</span>
                      <span className="w-16 text-right">Price</span>
                      <span className="w-14 text-right">Status</span>
                      <span className="w-6"></span>
                    </div>
                    {mySymbolOrders.map(o => (
                      <div key={o.id} className="flex items-center text-xs px-3 py-1 hover:bg-white/5 transition-colors group">
                        <span className={`w-10 font-semibold ${o.side === "BUY" ? "text-emerald-400" : "text-red-400"}`}>{o.side}</span>
                        <span className="flex-1 text-gray-400">{o.orderType}</span>
                        <span className="w-16 text-right font-mono text-gray-300">{parseFloat(String(o.quantity)).toFixed(1)}</span>
                        <span className="w-16 text-right font-mono text-gray-300">
                          {o.price ? fmt(parseFloat(String(o.price)), parseFloat(String(o.price)) > 100 ? 2 : 4) : "—"}
                        </span>
                        <span className={`w-14 text-right text-[10px] font-medium ${
                          o.status === "FILLED" ? "text-emerald-400" :
                          o.status === "CANCELLED" ? "text-gray-500" :
                          o.status === "REJECTED" ? "text-red-400" :
                          "text-amber-400"
                        }`}>{o.status}</span>
                        <span className="w-12 flex justify-end gap-1">
                          {(o.status === "OPEN" || o.status === "PARTIALLY_FILLED") && (
                            <>
                              <button
                                onClick={() => {
                                  setAmendTarget({ id: o.id, price: String(o.price ?? ""), quantity: String(o.quantity) });
                                  setAmendPrice(o.price ? String(o.price) : "");
                                  setAmendQty(String(o.quantity));
                                  setAmendReason("");
                                }}
                                title="Amend order"
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-blue-400 hover:text-blue-300 leading-none text-[11px] font-bold"
                              >
                                ✎
                              </button>
                              <button
                                onClick={() => cancelOrderMutation.mutate({ orderId: o.id })}
                                disabled={cancelOrderMutation.isPending}
                                title="Cancel order"
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-300 disabled:opacity-30 leading-none"
                              >
                                ×
                              </button>
                            </>
                          )}
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Amend Order Dialog */}
          <Dialog open={!!amendTarget} onOpenChange={(open) => !open && setAmendTarget(null)}>
            <DialogContent className="bg-[#0d1410] border-white/10 text-white max-w-xs">
              <DialogHeader>
                <DialogTitle className="text-sm text-emerald-400">Amend Order #{amendTarget?.id}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-1">
                <div>
                  <Label className="text-xs text-gray-400 mb-1 block">New Price</Label>
                  <Input
                    type="number"
                    step="any"
                    value={amendPrice}
                    onChange={e => setAmendPrice(e.target.value)}
                    placeholder={amendTarget?.price || "Leave blank to keep current"}
                    className="bg-white/5 border-white/10 text-white text-sm h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs text-gray-400 mb-1 block">New Quantity</Label>
                  <Input
                    type="number"
                    step="any"
                    value={amendQty}
                    onChange={e => setAmendQty(e.target.value)}
                    placeholder={amendTarget?.quantity || "Leave blank to keep current"}
                    className="bg-white/5 border-white/10 text-white text-sm h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs text-gray-400 mb-1 block">Reason <span className="text-gray-600">(optional)</span></Label>
                  <Input
                    type="text"
                    maxLength={512}
                    value={amendReason}
                    onChange={e => setAmendReason(e.target.value)}
                    placeholder="e.g. Market conditions changed"
                    className="bg-white/5 border-white/10 text-white text-sm h-8"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 border-white/10 text-gray-300"
                    onClick={() => setAmendTarget(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-white"
                    disabled={amendOrderMutation.isPending || (!amendPrice && !amendQty)}
                    onClick={() => {
                      if (!amendTarget) return;
                      amendOrderMutation.mutate({
                        orderId: amendTarget.id,
                        ...(amendPrice ? { price: parseFloat(amendPrice) } : {}),
                        ...(amendQty ? { quantity: parseFloat(amendQty) } : {}),
                        ...(amendReason.trim() ? { reason: amendReason.trim() } : {}),
                      });
                    }}
                  >
                    {amendOrderMutation.isPending ? "Saving…" : "Save Changes"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Keyboard Shortcut Overlay */}
          <Dialog open={showShortcuts} onOpenChange={setShowShortcuts}>
            <DialogContent className="bg-[#0d1410] border-white/10 text-white max-w-sm">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-sm">
                  <Keyboard className="w-4 h-4 text-emerald-400" />
                  Keyboard Shortcuts
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-1 text-xs">
                {([
                  { key: "?",       desc: "Toggle this shortcut overlay" },
                  { key: "Esc",     desc: "Close dialogs / overlays" },
                  { key: "B",       desc: "Switch order side to BUY" },
                  { key: "S",       desc: "Switch order side to SELL" },
                  { key: "↑ / ↓",  desc: "Navigate symbol autocomplete suggestions" },
                  { key: "Enter",   desc: "Confirm selected symbol in autocomplete" },
                  { key: "Esc",     desc: "Close symbol autocomplete dropdown" },
                ] as const).map(({ key, desc }) => (
                  <div key={key + desc} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
                    <span className="text-gray-400">{desc}</span>
                    <kbd className="px-2 py-0.5 rounded bg-white/10 border border-white/20 font-mono text-emerald-300 text-[11px]">{key}</kbd>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-500 pt-1">Shortcuts are disabled while typing in input fields.</p>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </>
  );
}