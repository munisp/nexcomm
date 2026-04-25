/**
 * Watchlist.tsx
 * Full-page watchlist for NEXCOM Exchange — shows pinned instruments with
 * live prices, 24h OHLCV data, mini sparklines, and a "Trade" quick-action.
 *
 * Data sources:
 *  - trpc.watchlist.list      → user's pinned symbols
 *  - trpc.watchlist.add/remove → add/remove from watchlist
 *  - trpc.livePrices.getBySymbols → live price rows for pinned symbols
 *  - trpc.livePrices.getAll   → full instrument universe for the add-symbol search
 */
import { useState, useMemo, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Star,
  StarOff,
  Search,
  RefreshCw,
  ArrowLeft,
  BarChart2,
  Zap,
  Plus,
  ShoppingCart,
  LayoutDashboard,
  Bell,
  Settings2,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { LivePrice } from "../../../drizzle/schema";
import OrderBookDepthPanel from "@/components/OrderBookDepthPanel";
import CandleChart from "@/components/CandleChart";
import { PageSkeleton } from "@/components/PageSkeleton";

// ─── Inline Trade Modal ───────────────────────────────────────────────────────
// Fee rates (basis points)
const MAKER_FEE_BPS = 10; // 0.10%
const TAKER_FEE_BPS = 15; // 0.15%

interface TradeModalProps {
  symbol: string;
  currentPrice: number | null;
  open: boolean;
  onClose: () => void;
}

function TradeModal({ symbol, currentPrice, open, onClose }: TradeModalProps) {
  const utils = trpc.useUtils();

  // ── Step: "entry" | "confirm" ────────────────────────────────────────────────
  const [step, setStep] = useState<"entry" | "confirm">("entry");
  const [instrumentSearch, setInstrumentSearch] = useState("");

  // ── Order fields ─────────────────────────────────────────────────────────────
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT" | "STOP_LIMIT">("LIMIT");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState(currentPrice ? String(currentPrice) : "");
  const [tif, setTif] = useState<"GTC" | "DAY" | "IOC" | "FOK">("GTC");

  // ── Live SSE price feed ───────────────────────────────────────────────────────
  const [livePrice, setLivePrice] = useState<number | null>(currentPrice);
  const [sseConnected, setSseConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!open) return;
    // Connect to Fluvio SSE stream for price-updates
    const es = new EventSource(`/api/v1/fluvio/stream/price-updates`);
    esRef.current = es;
    es.onopen = () => setSseConnected(true);
    es.onmessage = (evt) => {
      try {
        const payload = JSON.parse(evt.data) as { symbol?: string; price?: number };
        if (payload.symbol === symbol && typeof payload.price === "number") {
          setLivePrice(payload.price);
          // Auto-update limit price field only if user hasn't manually edited it
          setPrice((prev) => {
            const prevNum = parseFloat(prev);
            // Only auto-update if the field is empty or matches the last known price
            if (!prev || prevNum === currentPrice) return String(payload.price);
            return prev;
          });
        }
      } catch { /* ignore malformed events */ }
    };
    es.onerror = () => setSseConnected(false);
    return () => { es.close(); esRef.current = null; setSseConnected(false); };
  }, [open, symbol, currentPrice]);

  // Reset step when modal opens
  useEffect(() => { if (open) setStep("entry"); }, [open]);

  // ── Margin summary for confirmation step ─────────────────────────────────────
  const marginQuery = trpc.margin.getSummary.useQuery(undefined, {
    enabled: step === "confirm",
  });

  // ── Derived calculations ──────────────────────────────────────────────────────
  const effectivePrice = livePrice ?? currentPrice ?? 0;
  const qty = parseFloat(quantity) || 0;
  const limitPx = parseFloat(price) || effectivePrice;
  const execPrice = orderType === "MARKET" ? effectivePrice : limitPx;
  const notional = qty * execPrice;
  // Maker fee for LIMIT orders, taker fee for MARKET/STOP_LIMIT
  const feeBps = orderType === "LIMIT" ? MAKER_FEE_BPS : TAKER_FEE_BPS;
  const estimatedFee = notional * (feeBps / 10_000);
  const totalCost = side === "BUY" ? notional + estimatedFee : notional - estimatedFee;

  // Margin impact: how much available margin will be consumed
  const availableMargin = marginQuery.data?.availableMargin ?? null;
  const marginImpact = notional * 0.1; // 10% initial margin requirement
  const marginAfter = availableMargin !== null ? availableMargin - marginImpact : null;
  const marginWarning = marginAfter !== null && marginAfter < 0;

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const createOrder = trpc.orders.create.useMutation({
    onSuccess: (data) => {
      toast.success(`Order placed — ID ${String(data.id).slice(0, 8)}…`);
      utils.orders.list.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleReview = () => {
    const qty = parseFloat(quantity);
    const lmt = parseFloat(price);
    if (isNaN(qty) || qty <= 0) { toast.error("Enter a valid quantity"); return; }
    if (orderType !== "MARKET" && (isNaN(lmt) || lmt <= 0)) { toast.error("Enter a valid price"); return; }
    setStep("confirm");
  };

  const handleSubmit = () => {
    const qty = parseFloat(quantity);
    const lmt = parseFloat(price);
    createOrder.mutate({
      symbol,
      side,
      orderType,
      quantity: qty,
      price: orderType !== "MARKET" ? lmt : undefined,
      timeInForce: tif,
    });
  };

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-emerald-400" />
            {step === "entry" ? `Trade ${symbol}` : `Confirm ${side} — ${symbol}`}
          </DialogTitle>
        </DialogHeader>

        {/* ── Live price indicator ── */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400">Live price:</span>
          <span className={cn("font-mono font-semibold", sseConnected ? "text-emerald-400" : "text-gray-300")}>
            {livePrice !== null ? livePrice.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"}
            {sseConnected && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
          </span>
        </div>

        {step === "entry" ? (
          <>
            {/* Side */}
            <div className="grid grid-cols-2 gap-2">
              <button
                className={cn(
                  "py-2 rounded-lg text-sm font-semibold transition-colors",
                  side === "BUY" ? "bg-emerald-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                )}
                onClick={() => setSide("BUY")}
              >BUY</button>
              <button
                className={cn(
                  "py-2 rounded-lg text-sm font-semibold transition-colors",
                  side === "SELL" ? "bg-red-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                )}
                onClick={() => setSide("SELL")}
              >SELL</button>
            </div>

            {/* Order type */}
            <div className="space-y-1">
              <Label className="text-xs text-gray-400">Order Type</Label>
              <Select value={orderType} onValueChange={(v) => setOrderType(v as typeof orderType)}>
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">
                  <SelectItem value="LIMIT">Limit ({MAKER_FEE_BPS / 100}% maker fee)</SelectItem>
                  <SelectItem value="MARKET">Market ({TAKER_FEE_BPS / 100}% taker fee)</SelectItem>
                  <SelectItem value="STOP_LIMIT">Stop Limit ({TAKER_FEE_BPS / 100}% taker fee)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Quantity */}
            <div className="space-y-1">
              <Label className="text-xs text-gray-400">Quantity</Label>
              <Input
                type="number"
                min="0"
                step="any"
                placeholder="0.00"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="bg-gray-800 border-gray-700 text-white h-9"
              />
            </div>

            {/* Price (hidden for MARKET) */}
            {orderType !== "MARKET" && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-gray-400">Limit Price</Label>
                  {livePrice !== null && (
                    <button
                      className="text-[10px] text-emerald-400 hover:text-emerald-300"
                      onClick={() => setPrice(String(livePrice))}
                    >
                      Use live ↑{livePrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </button>
                  )}
                </div>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  placeholder={livePrice ? String(livePrice) : "0.00"}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="bg-gray-800 border-gray-700 text-white h-9"
                />
              </div>
            )}

            {/* Time in Force */}
            <div className="space-y-1">
              <Label className="text-xs text-gray-400">Time in Force</Label>
              <Select value={tif} onValueChange={(v) => setTif(v as typeof tif)}>
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">
                  <SelectItem value="GTC">GTC — Good Till Cancelled</SelectItem>
                  <SelectItem value="DAY">DAY — Day Order</SelectItem>
                  <SelectItem value="IOC">IOC — Immediate or Cancel</SelectItem>
                  <SelectItem value="FOK">FOK — Fill or Kill</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Live notional preview */}
            {qty > 0 && execPrice > 0 && (
              <div className="bg-gray-800/60 rounded-lg p-3 text-xs space-y-1">
                <div className="flex justify-between text-gray-400">
                  <span>Est. notional</span>
                  <span className="text-white font-mono">₦{fmt(notional)}</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Est. fee ({feeBps / 100}%)</span>
                  <span className="text-amber-300 font-mono">₦{fmt(estimatedFee)}</span>
                </div>
                <div className="flex justify-between border-t border-gray-700 pt-1 font-semibold">
                  <span className="text-gray-300">{side === "BUY" ? "Total cost" : "Net proceeds"}</span>
                  <span className={cn("font-mono", side === "BUY" ? "text-red-300" : "text-emerald-300")}>₦{fmt(totalCost)}</span>
                </div>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={onClose}
                className="border-gray-700 text-gray-300 bg-transparent hover:bg-gray-800">
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleReview}
                className={cn(
                  "font-semibold",
                  side === "BUY" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-red-600 hover:bg-red-500"
                )}
              >
                Review Order →
              </Button>
            </DialogFooter>
          </>
        ) : (
          /* ── Confirmation step ── */
          <>
            <div className="space-y-3">
              {/* Order summary table */}
              <div className="bg-gray-800/60 rounded-lg p-3 text-xs space-y-2">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {[
                    ["Symbol", symbol],
                    ["Side", side],
                    ["Type", orderType],
                    ["Quantity", qty.toLocaleString()],
                    ["Exec price", orderType === "MARKET" ? "Market" : `₦${fmt(limitPx)}`],
                    ["TIF", tif],
                  ].map(([label, val]) => (
                    <>
                      <span key={`l-${label}`} className="text-gray-400">{label}</span>
                      <span key={`v-${label}`} className="text-white font-mono text-right">{val}</span>
                    </>
                  ))}
                </div>
              </div>

              {/* Cost breakdown */}
              <div className="bg-gray-800/60 rounded-lg p-3 text-xs space-y-1.5">
                <p className="text-gray-400 font-semibold mb-1">Cost Breakdown</p>
                <div className="flex justify-between">
                  <span className="text-gray-400">Notional value</span>
                  <span className="text-white font-mono">₦{fmt(notional)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">{orderType === "LIMIT" ? "Maker" : "Taker"} fee ({feeBps / 100}%)</span>
                  <span className="text-amber-300 font-mono">₦{fmt(estimatedFee)}</span>
                </div>
                <div className="flex justify-between border-t border-gray-700 pt-1 font-bold">
                  <span className="text-gray-200">{side === "BUY" ? "Total debit" : "Net credit"}</span>
                  <span className={cn("font-mono", side === "BUY" ? "text-red-300" : "text-emerald-300")}>₦{fmt(totalCost)}</span>
                </div>
              </div>

              {/* Margin impact */}
              <div className={cn(
                "rounded-lg p-3 text-xs space-y-1.5 border",
                marginWarning
                  ? "bg-red-900/30 border-red-700"
                  : "bg-gray-800/60 border-gray-700"
              )}>
                <p className="text-gray-400 font-semibold mb-1">Margin Impact (10% req.)</p>
                {marginQuery.isLoading ? (
                  <p className="text-gray-500">Loading margin data…</p>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Available margin</span>
                      <span className="text-white font-mono">
                        {availableMargin !== null ? `₦${fmt(availableMargin)}` : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Margin required</span>
                      <span className="text-amber-300 font-mono">₦{fmt(marginImpact)}</span>
                    </div>
                    <div className="flex justify-between border-t border-gray-700 pt-1 font-bold">
                      <span className="text-gray-200">Margin after</span>
                      <span className={cn("font-mono", marginWarning ? "text-red-400" : "text-emerald-300")}>
                        {marginAfter !== null ? `₦${fmt(marginAfter)}` : "—"}
                      </span>
                    </div>
                    {marginWarning && (
                      <p className="text-red-400 text-[10px] pt-1">
                        ⚠ Insufficient margin — this order may be rejected by the matching engine.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={() => setStep("entry")}
                className="border-gray-700 text-gray-300 bg-transparent hover:bg-gray-800">
                ← Back
              </Button>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={createOrder.isPending}
                className={cn(
                  "font-semibold",
                  side === "BUY" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-red-600 hover:bg-red-500"
                )}
              >
                {createOrder.isPending ? "Placing…" : `Confirm ${side}`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Sparkline (inline SVG) ──────────────────────────────────────────────────
function Sparkline({
  data,
  positive,
  width = 80,
  height = 32,
}: {
  data: number[];
  positive: boolean;
  width?: number;
  height?: number;
}) {
  if (!data || data.length < 2) {
    return <div style={{ width, height }} className="opacity-30 text-xs text-gray-500 flex items-center justify-center">—</div>;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");
  const color = positive ? "#34d399" : "#f87171";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Simulated intraday sparkline from OHLCV ─────────────────────────────────
function buildSparklineData(
  open: number,
  high: number,
  low: number,
  close: number,
  points = 20
): number[] {
  // Simulate a plausible intraday path between open → high/low → close
  const data: number[] = [open];
  for (let i = 1; i < points - 1; i++) {
    const t = i / (points - 1);
    // Lerp between open and close with noise bounded by [low, high]
    const base = open + (close - open) * t;
    const noise = (Math.random() - 0.5) * (high - low) * 0.3;
    data.push(Math.min(high, Math.max(low, base + noise)));
  }
  data.push(close);
  return data;
}

// ─── Asset class colour ───────────────────────────────────────────────────────
function assetClassBadge(cls: string) {
  const map: Record<string, string> = {
    COMMODITY: "bg-amber-900/50 text-amber-300 border-amber-700",
    FOREX: "bg-blue-900/50 text-blue-300 border-blue-700",
    CRYPTO: "bg-purple-900/50 text-purple-300 border-purple-700",
    EQUITY: "bg-green-900/50 text-green-300 border-green-700",
    INDEX: "bg-cyan-900/50 text-cyan-300 border-cyan-700",
  };
  return map[cls?.toUpperCase()] ?? "bg-gray-800 text-gray-300 border-gray-600";
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function WatchlistPage() {
  const [currentPath, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [showAddPanel, setShowAddPanel] = useState(false);

  // ── Display options (column customisation) persisted to localStorage ──────────
  const DISPLAY_OPTS_KEY = "nexcom_watchlist_display_opts";
  const [displayOpts, setDisplayOpts] = useState(() => {
    try {
      const saved = localStorage.getItem(DISPLAY_OPTS_KEY);
      if (saved) return JSON.parse(saved) as Record<string, boolean>;
    } catch { /* ignore */ }
    return { showOHLCV: true, showSparkline: true, showVolume: true, showBidAsk: true };
  });
  const toggleDisplayOpt = (key: string) => {
    setDisplayOpts(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(DISPLAY_OPTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const [tradeModal, setTradeModal] = useState<{ symbol: string; price: number | null } | null>(null);
  // Track which symbol has its order book depth panel expanded
  const [expandedBook, setExpandedBook] = useState<string | null>(null);
  // Track which symbol has its candle chart expanded
  const [expandedChart, setExpandedChart] = useState<string | null>(null);
  // Quick-add price alert state
  const [alertSymbol, setAlertSymbol] = useState<string | null>(null);
  const [alertPrice, setAlertPrice] = useState("");
  const [alertCondition, setAlertCondition] = useState<"ABOVE" | "BELOW" | "CROSS_ABOVE" | "CROSS_BELOW">("ABOVE");

  // ── Data queries ────────────────────────────────────────────────────────────
  const { data: watchlistData, isLoading: wlLoading } = trpc.watchlist.list.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  // watchlist.list returns string[] directly
  const watchedSymbols: string[] = useMemo(
    () => (watchlistData ?? []) as string[],
    [watchlistData]
  );

  const { data: livePriceRows, isLoading: pricesLoading, refetch } = trpc.livePrices.getBySymbols.useQuery(
    { symbols: watchedSymbols },
    { enabled: watchedSymbols.length > 0, refetchInterval: 30_000 }
  );

  const { data: allPricesData } = trpc.livePrices.getAll.useQuery(undefined, {
    enabled: showAddPanel,
  });

  // Alert count badge per symbol — refetch when watchedSymbols change
  const { data: alertCounts, refetch: refetchAlertCounts } = trpc.priceAlerts.countBySymbols.useQuery(
    { symbols: watchedSymbols },
    { enabled: watchedSymbols.length > 0, refetchInterval: 60_000 }
  );

  // ── Mutations ────────────────────────────────────────────────────────────────
  const addMutation = trpc.watchlist.add.useMutation({
    onSuccess: (data) => {
      if (data.added) {
        toast.success("Added to watchlist");
        utils.watchlist.list.invalidate();
      } else {
        toast.info("Already in watchlist");
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const createAlertMutation = trpc.priceAlerts.create.useMutation({
    onSuccess: () => {
      toast.success("Price alert set");
      setAlertSymbol(null);
      setAlertPrice("");
      void refetchAlertCounts();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteManyAlertsMutation = trpc.priceAlerts.deleteMany.useMutation({
    onSuccess: (data) => {
      toast.success(`Cleared ${data.deleted} alert${data.deleted !== 1 ? "s" : ""}`);
      void refetchAlertCounts();
    },
    onError: (e) => toast.error(e.message),
  });

  const removeMutation = trpc.watchlist.remove.useMutation({
    onMutate: async ({ symbol }) => {
      // Optimistic update — list returns string[]
      await utils.watchlist.list.cancel();
      const prev = utils.watchlist.list.getData();
      utils.watchlist.list.setData(undefined, (old) =>
        (old ?? [] as string[]).filter((s: string) => s !== symbol)
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) utils.watchlist.list.setData(undefined, ctx.prev);
      toast.error("Failed to remove from watchlist");
    },
    onSettled: () => utils.watchlist.list.invalidate(),
  });

  // ── Derived data ─────────────────────────────────────────────────────────────
  const priceMap = useMemo(() => {
    const m: Record<string, LivePrice> = {};
    (livePriceRows ?? [] as LivePrice[]).forEach((r: LivePrice) => { m[r.symbol] = r; });
    return m;
  }, [livePriceRows]);

  const filteredAll = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return (allPricesData?.prices ?? [] as LivePrice[]).filter(
      (p: LivePrice) =>
        !watchedSymbols.includes(p.symbol) &&
        (p.symbol.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
    ) as LivePrice[];
  }, [allPricesData, watchedSymbols, searchQuery]);

  const isLoading = wlLoading || pricesLoading;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 to-gray-900 text-white pb-24">
      {/* ── Header ── */}
      <div className="sticky top-0 z-20 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1 as unknown as string)}
            className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
              My Watchlist
            </h1>
            <p className="text-xs text-gray-400">
              {watchedSymbols.length} instrument{watchedSymbols.length !== 1 ? "s" : ""} pinned
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
            title="Refresh prices"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {/* Gear: display options popover */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
                title="Customise display"
              >
                <Settings2 className="w-4 h-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="bg-gray-900 border-gray-700 text-white w-56 p-3" align="end">
              <p className="text-xs font-semibold text-gray-300 mb-2">Display options</p>
              {([
                { key: "showOHLCV",    label: "OHLCV mini-row" },
                { key: "showSparkline", label: "Sparkline chart" },
                { key: "showVolume",   label: "Volume data" },
                { key: "showBidAsk",   label: "Bid / Ask spread" },
              ] as { key: string; label: string }[]).map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 py-1 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!displayOpts[key]}
                    onChange={() => toggleDisplayOpt(key)}
                    className="accent-emerald-500"
                  />
                  <span className="text-xs text-gray-300">{label}</span>
                </label>
              ))}
              {/* Bulk alert management */}
              {alertCounts && Object.values(alertCounts).some(c => c > 0) && (
                <>
                  <hr className="border-gray-700 my-2" />
                  <p className="text-xs font-semibold text-gray-300 mb-1">Alert management</p>
                  <button
                    className="w-full text-left text-xs text-red-400 hover:text-red-300 py-1 flex items-center gap-1.5 disabled:opacity-40"
                    disabled={deleteManyAlertsMutation.isPending}
                    onClick={() => {
                      void utils.priceAlerts.list.fetch().then(data => {
                        const ids = data.active.map((a: { id: number }) => a.id);
                        if (ids.length > 0) {
                          deleteManyAlertsMutation.mutate({ ids });
                        } else {
                          toast.info("No active alerts to clear");
                        }
                      });
                    }}
                  >
                    Clear all alerts ({Object.values(alertCounts).reduce((s, c) => s + c, 0)})
                  </button>
                </>
              )}
            </PopoverContent>
          </Popover>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-3 h-8"
            onClick={() => { setShowAddPanel(!showAddPanel); setSearchQuery(""); }}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Add
          </Button>
        </div>
      </div>

      {/* ── Add symbol panel ── */}
      {showAddPanel && (
        <div className="mx-4 mt-3 bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
          <div className="p-3 border-b border-gray-800">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                className="pl-9 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 h-9 text-sm"
                placeholder="Search instruments to add…" value={instrumentSearch} onChange={(e) => setInstrumentSearch(e.target.value)}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-gray-800">
            {filteredAll.length === 0 ? (
              <p className="text-center text-gray-500 text-sm py-6">
                {searchQuery ? "No matching instruments" : "All instruments are already in your watchlist"}
              </p>
            ) : (
                  filteredAll.slice(0, 30).map((p: LivePrice) => (
                <button
                  key={p.symbol}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-800 transition-colors text-left"
                  onClick={() => {
                    addMutation.mutate({ symbol: p.symbol });
                    setShowAddPanel(false);
                    setSearchQuery("");
                  }}
                >
                  <div>
                    <p className="text-sm font-semibold text-white">{p.symbol}</p>
                    <p className="text-xs text-gray-400 truncate max-w-[180px]">{p.name}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-xs font-medium",
                      Number(p.changePct) >= 0 ? "text-emerald-400" : "text-red-400"
                    )}>
                      {Number(p.changePct) >= 0 ? "+" : ""}{Number(p.changePct ?? 0).toFixed(2)}%
                    </span>
                    <Plus className="w-4 h-4 text-emerald-400" />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {!isLoading && watchedSymbols.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 px-8 text-center">
          <Star className="w-14 h-14 text-gray-700 mb-4" />
          <h2 className="text-xl font-semibold text-gray-300 mb-2">Your watchlist is empty</h2>
          <p className="text-gray-500 text-sm mb-6">
            Pin instruments to monitor their prices, OHLCV data, and trade directly from here.
          </p>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => setShowAddPanel(true)}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add your first instrument
          </Button>
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {isLoading && watchedSymbols.length > 0 && (
        <div className="px-4 pt-4 space-y-3">
          {watchedSymbols.map((sym) => (
            <div key={sym} className="h-20 bg-gray-800/50 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* ── Watchlist rows ── */}
      {!isLoading && watchedSymbols.length > 0 && (
        <div className="px-4 pt-4 space-y-2">
          {watchedSymbols.map((symbol: string) => {
            const row: LivePrice | undefined = priceMap[symbol];
            const price = row ? Number(row.price) : null;
            const prevClose = row ? Number(row.previousClose ?? row.price) : null;
            const change = row ? Number(row.change ?? 0) : 0;
            const changePct = row ? Number(row.changePct ?? 0) : 0;
            const high = row ? Number(row.high ?? row.price) : null;
            const low = row ? Number(row.low ?? row.price) : null;
            const open = prevClose ?? price ?? 0;
            const isPositive = changePct >= 0;
            const sparkData = price && high && low
              ? buildSparklineData(open, high, low, price)
              : [];

            return (
              <div
                key={symbol}
                className="bg-gray-900 border border-gray-800 rounded-xl p-3 hover:border-gray-700 transition-colors"
              >
                <div className="flex items-start gap-3">
                  {/* Left: symbol + name + badge */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-bold text-white text-sm">{symbol}</span>
                      {row && (
                        <span className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded border font-medium",
                          assetClassBadge(row.assetClass)
                        )}>
                          {row.assetClass}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 truncate">{row?.name ?? symbol}</p>

                    {/* OHLCV mini row */}
                    {displayOpts.showOHLCV && row && high && low && (
                      <div className="flex gap-3 mt-1.5 text-[10px] text-gray-500">
                        <span>H <span className="text-gray-300">{high.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></span>
                        <span>L <span className="text-gray-300">{low.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></span>
                        <span>O <span className="text-gray-300">{open.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></span>
                        <span className="text-gray-600">{row.currency}</span>
                      </div>
                    )}
                  </div>

                  {/* Middle: sparkline */}
                  {displayOpts.showSparkline && (
                    <div className="flex-shrink-0 flex items-center">
                      <Sparkline data={sparkData} positive={isPositive} />
                    </div>
                  )}

                  {/* Right: price + change */}
                  <div className="flex-shrink-0 text-right min-w-[80px]">
                    {price !== null ? (
                      <>
                        <p className="font-bold text-white text-sm">
                          {price.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </p>
                        <div className={cn(
                          "flex items-center justify-end gap-0.5 text-xs font-medium",
                          isPositive ? "text-emerald-400" : "text-red-400"
                        )}>
                          {isPositive ? (
                            <TrendingUp className="w-3 h-3" />
                          ) : changePct < 0 ? (
                            <TrendingDown className="w-3 h-3" />
                          ) : (
                            <Minus className="w-3 h-3" />
                          )}
                          <span>{isPositive ? "+" : ""}{changePct.toFixed(2)}%</span>
                        </div>
                        <p className={cn(
                          "text-[10px]",
                          isPositive ? "text-emerald-500" : "text-red-500"
                        )}>
                          {change >= 0 ? "+" : ""}{change.toFixed(4)}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-gray-500">No data</p>
                    )}
                  </div>
                </div>

                {/* Action row */}
                <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-gray-800">
                  <Button
                    size="sm"
                    className="flex-1 h-7 text-xs bg-emerald-700 hover:bg-emerald-600 text-white"
                    onClick={() => setTradeModal({
                      symbol,
                      price: row ? parseFloat(String(row.price ?? 0)) : null,
                    })}
                  >
                    <Zap className="w-3 h-3 mr-1" />
                    Trade
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className={cn(
                      "flex-1 h-7 text-xs border-gray-700 hover:bg-gray-800 bg-transparent",
                      expandedBook === symbol
                        ? "text-emerald-400 border-emerald-700/50"
                        : "text-gray-300"
                    )}
                    onClick={() => setExpandedBook(expandedBook === symbol ? null : symbol)}
                  >
                    <BarChart2 className="w-3 h-3 mr-1" />
                    {expandedBook === symbol ? "Hide Book" : "Order Book"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className={cn(
                      "flex-1 h-7 text-xs border-gray-700 hover:bg-gray-800 bg-transparent",
                      expandedChart === symbol
                        ? "text-amber-400 border-amber-700/50"
                        : "text-gray-300"
                    )}
                    onClick={() => setExpandedChart(expandedChart === symbol ? null : symbol)}
                  >
                    <BarChart2 className="w-3 h-3 mr-1" />
                    {expandedChart === symbol ? "Hide Chart" : "Candles"}
                  </Button>
                  <div className="relative">
                    <button
                      className="p-1.5 rounded-lg hover:bg-gray-800 text-yellow-400 hover:text-yellow-300 transition-colors"
                      title="Set price alert"
                      onClick={() => {
                        setAlertSymbol(symbol);
                        setAlertPrice(price !== null ? price.toFixed(4) : "");
                        setAlertCondition("ABOVE");
                      }}
                    >
                      <Bell className="w-4 h-4" />
                    </button>
                    {alertCounts && (alertCounts[symbol] ?? 0) > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] rounded-full bg-yellow-500 text-black text-[9px] font-bold flex items-center justify-center px-0.5 leading-none">
                        {alertCounts[symbol]}
                      </span>
                    )}
                  </div>
                  <button
                    className="p-1.5 rounded-lg hover:bg-gray-800 text-amber-400 hover:text-red-400 transition-colors"
                    title="Remove from watchlist"
                    onClick={() => removeMutation.mutate({ symbol })}
                    disabled={removeMutation.isPending}
                  >
                    <StarOff className="w-4 h-4" />
                  </button>
                </div>

                {/* Alert summary row — shown when symbol has active alerts */}
                {alertCounts && (alertCounts[symbol] ?? 0) > 0 && (
                  <div
                    className="mt-1.5 flex items-center gap-1.5 text-[11px] text-yellow-400 cursor-pointer hover:text-yellow-300 transition-colors"
                    onClick={() => navigate("/alerts")}
                    title="View price alerts for this symbol"
                  >
                    <Bell className="w-3 h-3" />
                    <span>{alertCounts[symbol]} active alert{(alertCounts[symbol] ?? 0) !== 1 ? "s" : ""} — tap to manage</span>
                  </div>
                )}

                {/* Inline order book depth panel */}
                {expandedBook === symbol && (
                  <div className="mt-2">
                    <OrderBookDepthPanel symbol={symbol} maxLevels={8} />
                  </div>
                )}
                {/* Inline OHLCV candle chart */}
                {expandedChart === symbol && (
                  <div className="mt-2">
                    <CandleChart symbol={symbol} interval="5m" limit={60} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Footer summary ── */}
      {watchedSymbols.length > 0 && (
        <div className="mx-4 mt-6 p-3 bg-gray-900/50 border border-gray-800 rounded-xl">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xs text-gray-500">Pinned</p>
              <p className="text-lg font-bold text-white">{watchedSymbols.length}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Gainers</p>
              <p className="text-lg font-bold text-emerald-400">
                {(livePriceRows ?? [] as LivePrice[]).filter((r: LivePrice) => Number(r.changePct ?? 0) >= 0).length}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Losers</p>
              <p className="text-lg font-bold text-red-400">
                {(livePriceRows ?? [] as LivePrice[]).filter((r: LivePrice) => Number(r.changePct ?? 0) < 0).length}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Inline Trade Modal ── */}
      {tradeModal && (
        <TradeModal
          symbol={tradeModal.symbol}
          currentPrice={tradeModal.price}
          open={!!tradeModal}
          onClose={() => setTradeModal(null)}
        />
      )}

      {/* ── Quick-add Price Alert Dialog ── */}
      <Dialog open={!!alertSymbol} onOpenChange={(open) => { if (!open) setAlertSymbol(null); }}>
        <DialogContent className="sm:max-w-sm bg-gray-900 border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Bell className="w-4 h-4 text-yellow-400" />
              Set Price Alert — {alertSymbol}
            </DialogTitle>
            <DialogDescription className="text-gray-400">
              Get notified when the price crosses your target.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-xs">Condition</Label>
              <Select
                value={alertCondition}
                onValueChange={(v) => setAlertCondition(v as typeof alertCondition)}
              >
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">
                  <SelectItem value="ABOVE">Price rises above</SelectItem>
                  <SelectItem value="BELOW">Price falls below</SelectItem>
                  <SelectItem value="CROSS_ABOVE">Crosses above (once)</SelectItem>
                  <SelectItem value="CROSS_BELOW">Crosses below (once)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-xs">Target Price</Label>
              <Input
                type="number"
                step="any"
                value={alertPrice}
                onChange={(e) => setAlertPrice(e.target.value)}
                placeholder="Enter target price"
                className="bg-gray-800 border-gray-700 text-white"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1 border-gray-700 bg-transparent text-gray-300 hover:bg-gray-800"
                onClick={() => setAlertSymbol(null)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-yellow-600 hover:bg-yellow-500 text-white"
                disabled={!alertPrice || isNaN(parseFloat(alertPrice)) || createAlertMutation.isPending}
                onClick={() => {
                  if (!alertSymbol || !alertPrice) return;
                  createAlertMutation.mutate({
                    symbol: alertSymbol,
                    condition: alertCondition,
                    targetPrice: parseFloat(alertPrice),
                  });
                }}
              >
                <Bell className="w-4 h-4 mr-1.5" />
                {createAlertMutation.isPending ? "Setting…" : "Set Alert"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Mobile Bottom Nav with active-state indicators ── */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-950/95 backdrop-blur border-t border-gray-800 px-2 py-1.5 flex gap-1">
        {([
          { label: "Dashboard", path: "/trader-dashboard", Icon: LayoutDashboard },
          { label: "Watchlist", path: "/watchlist",        Icon: Star },
          { label: "Trade",     path: "/trade",            Icon: TrendingUp },
          { label: "Alerts",    path: "/alerts",           Icon: Bell },
        ] as const).map(item => {
          const isActive = currentPath === item.path || currentPath.startsWith(item.path + "/");
  if (wlLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                "flex-1 h-14 text-xs rounded-lg flex flex-col items-center justify-center gap-1 relative transition-colors",
                isActive
                  ? "text-emerald-400 font-semibold bg-emerald-400/10"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50",
              )}
            >
              {isActive && (
                <span className="absolute top-0 inset-x-3 h-0.5 rounded-full bg-emerald-400" />
              )}
              <item.Icon className="w-5 h-5" />
              <span className="text-[10px] leading-none">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
