/**
 * NEXCOM Exchange — Orders Page
 * Full order history across all asset classes with cancel functionality
 * Wired to live tRPC data with mock fallback for unauthenticated preview
 */
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  ClipboardList, Search, Filter, XCircle, CheckCircle2,
  Clock, AlertCircle, RefreshCw, ChevronDown, Download, Edit3, History, Timer,
  SlidersHorizontal, Eye, EyeOff,
} from "lucide-react";
import AmendOrderModal, { type AmendableOrder } from "@/components/AmendOrderModal";
import BulkAmendModal, { type BulkAmendOrder } from "@/components/BulkAmendModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Link } from "wouter";
import { useOfflineQueue } from "@/hooks/useOfflineQueue";
import DataFilterBar from "@/components/DataFilterBar";

type AssetClass = "COMMODITY" | "FOREX" | "EQUITY" | "DIGITAL_ASSET";
type OrderStatus = "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED" | "REJECTED" | "EXPIRED";
type OrderSide = "BUY" | "SELL";
type OrderType = "LIMIT" | "MARKET" | "STOP_LIMIT";

interface DisplayOrder {
  id: number;
  symbol: string;
  assetClass: AssetClass;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  price: number | null;
  filledQty: number;
  avgFillPrice: number | null;
  status: OrderStatus;
  timeInForce: string;
  createdAt: string;
}

const MOCK_ORDERS: DisplayOrder[] = [
  { id: 1001, symbol: "GINGER-NG-SPOT",  assetClass: "COMMODITY",    side: "BUY",  orderType: "LIMIT",      quantity: 5,      price: 1840,   filledQty: 5,    avgFillPrice: 1838.5, status: "FILLED",           timeInForce: "GTC", createdAt: "2026-03-03 09:15" },
  { id: 1002, symbol: "COCOA-SPOT",      assetClass: "COMMODITY",    side: "SELL", orderType: "MARKET",     quantity: 2,      price: null,   filledQty: 2,    avgFillPrice: 8462.0, status: "FILLED",           timeInForce: "DAY", createdAt: "2026-03-03 08:45" },
  { id: 1003, symbol: "EUR/USD",         assetClass: "FOREX",        side: "BUY",  orderType: "LIMIT",      quantity: 100000, price: 1.0850, filledQty: 0,    avgFillPrice: null,   status: "OPEN",             timeInForce: "GTC", createdAt: "2026-03-03 08:30" },
  { id: 1004, symbol: "AAPL",            assetClass: "EQUITY",       side: "BUY",  orderType: "LIMIT",      quantity: 50,     price: 218.50, filledQty: 30,   avgFillPrice: 218.20, status: "PARTIALLY_FILLED", timeInForce: "DAY", createdAt: "2026-03-03 07:00" },
  { id: 1005, symbol: "BTC",             assetClass: "DIGITAL_ASSET",side: "SELL", orderType: "LIMIT",      quantity: 0.5,    price: 68500,  filledQty: 0,    avgFillPrice: null,   status: "OPEN",             timeInForce: "GTC", createdAt: "2026-03-02 22:10" },
];

const STATUS_CONFIG: Record<OrderStatus, { label: string; className: string; icon: React.ElementType }> = {
  OPEN:             { label: "Open",      className: "badge-active",    icon: Clock },
  PARTIALLY_FILLED: { label: "Partial",   className: "badge-pending",   icon: ChevronDown },
  FILLED:           { label: "Filled",    className: "badge-settled",   icon: CheckCircle2 },
  CANCELLED:        { label: "Cancelled", className: "badge-cancelled", icon: XCircle },
  REJECTED:         { label: "Rejected",  className: "badge-cancelled", icon: AlertCircle },
  EXPIRED:          { label: "Expired",   className: "text-muted-foreground border border-border", icon: Clock },
};

const ASSET_CLASS_CONFIG: Record<AssetClass, { label: string; color: string }> = {
  COMMODITY:    { label: "Commodity", color: "text-yellow-400" },
  FOREX:        { label: "Forex",     color: "text-blue-400" },
  EQUITY:       { label: "Equity",    color: "text-purple-400" },
  DIGITAL_ASSET:{ label: "Digital",   color: "text-cyan-400" },
};

// ── DAY Order Expiry Countdown ──────────────────────────────────────────────────
/**
 * Computes the milliseconds remaining until the next market close (17:00 WAT = UTC+1).
 * NEXCOM commodity market closes at 17:00 WAT. For orders created today, the expiry
 * is today's 17:00 WAT. If we are past 17:00 WAT, the order would already be expired.
 */
function getMsUntilMarketClose(): number {
  const now = new Date();
  // 17:00 WAT = 16:00 UTC
  const close = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 16, 0, 0, 0));
  const diff = close.getTime() - now.getTime();
  return diff;
}

function DayOrderCountdown({ createdAt }: { createdAt: string }) {
  const [msLeft, setMsLeft] = useState(() => getMsUntilMarketClose());

  useEffect(() => {
    const tick = () => setMsLeft(getMsUntilMarketClose());
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (msLeft <= 0) {
    return (
      <div className="flex items-center gap-1 text-[10px] text-red-400 font-mono">
        <Timer className="w-3 h-3" />
        <span>Expired</span>
      </div>
    );
  }

  const totalSecs = Math.floor(msLeft / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");

  // Colour: green > 1h, amber 15m-1h, red < 15m
  const colour = h >= 1 ? "text-emerald-400" : m >= 15 ? "text-amber-400" : "text-red-400";

  return (
    <div className={`flex items-center gap-1 text-[10px] font-mono ${colour}`}>
      <Timer className="w-3 h-3" />
      <span title={`DAY order expires at 17:00 WAT. Created: ${createdAt}`}>
        {hh}:{mm}:{ss}
      </span>
    </div>
  );
}

// ── Amendment History Timeline ────────────────────────────────────────────────
function AmendmentTimeline({ orderId }: { orderId: number }) {
  const { data: amendments, isLoading } = trpc.orders.listAmendments.useQuery(
    { orderId },
    { staleTime: 10_000 }
  );
  const { enqueue, queueDepth } = useOfflineQueue();
  const [reasonSearch, setReasonSearch] = useState("");

  if (isLoading) {
    return (
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-3">
          <History className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-muted-foreground">Amendment History</span>
        </div>
        <div className="text-xs text-muted-foreground animate-pulse">Loading history…</div>
      </div>
    );
  }

  if (!amendments || amendments.length === 0) return null;

  const filtered = reasonSearch.trim()
    ? amendments.filter(a =>
        a.reason?.toLowerCase().includes(reasonSearch.toLowerCase())
      )
    : amendments;

  const handleExportCsv = () => {
    if (!amendments || amendments.length === 0) return;
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    const header = ["#", "Amended At", "Old Qty", "New Qty", "Old Price", "New Price", "Bulk", "Reason"].join(",");
    const lines = amendments.map((a, i) => [
      esc(amendments.length - i),
      esc(new Date(a.amendedAt).toISOString()),
      esc(a.oldQty),
      esc(a.newQty),
      esc(a.oldPrice ?? ""),
      esc(a.newPrice ?? ""),
      esc(a.isBulk ? "Yes" : "No"),
      esc(a.reason ?? ""),
    ].join(","));
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `nexcom-amendments-order-${orderId}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-semibold text-muted-foreground">Amendment History</span>
        <span className="text-xs text-muted-foreground">({filtered.length}/{amendments.length})</span>
        <button
          onClick={handleExportCsv}
          title="Export amendment history as CSV"
          className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground hover:text-amber-400 transition-colors px-2 py-0.5 rounded border border-border hover:border-amber-500/40"
        >
          <Download className="w-3 h-3" />
          Export CSV
        </button>
      </div>
      {/* Reason search */}
      <div className="relative mb-3">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          placeholder="Search by reason…" value={reasonSearch} onChange={e => setReasonSearch(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 text-xs bg-secondary/60 border border-border rounded-md text-muted-foreground placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50"
        />
        {reasonSearch && (
          <button
            onClick={() => setReasonSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground"
          >
            ×
          </button>
        )}
      </div>
      {filtered.length === 0 && (
        <div className="text-xs text-muted-foreground italic py-2">No amendments match your search.</div>
      )}
      <div className="relative pl-4 border-l border-border space-y-4">
        {filtered.map((a, i) => (
          <div key={a.id} className="relative">
            {/* Timeline dot */}
            <div className="absolute -left-[1.35rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-500/70 border border-amber-400" />
            <div className="bg-secondary/60 rounded-lg p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide">
                    Amendment #{amendments.length - i}
                  </span>
                  {a.isBulk && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-violet-500/20 text-violet-300 border border-violet-500/30">
                      Bulk
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(a.amendedAt).toLocaleString()}
                </span>
              </div>
              {/* Qty change */}
              {a.oldQty !== a.newQty && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Qty:</span>
                  <span className="font-mono text-red-400 line-through">{parseFloat(a.oldQty).toLocaleString()}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-mono text-emerald-400">{parseFloat(a.newQty).toLocaleString()}</span>
                </div>
              )}
              {/* Price change */}
              {a.oldPrice !== a.newPrice && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Price:</span>
                  <span className="font-mono text-red-400 line-through">
                    {a.oldPrice != null ? parseFloat(a.oldPrice).toLocaleString(undefined, { maximumFractionDigits: 6 }) : "Market"}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-mono text-emerald-400">
                    {a.newPrice != null ? parseFloat(a.newPrice).toLocaleString(undefined, { maximumFractionDigits: 6 }) : "Market"}
                  </span>
                </div>
              )}
              {/* Reason */}
              {a.reason && (
                <div className="text-xs text-muted-foreground italic">"{a.reason}"</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Fill Ledger Component ────────────────────────────────────────────────────
function FillsLedger() {
  const utils = trpc.useUtils();
  const [symbolFilter, setSymbolFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const queryInput = {
    symbol: symbolFilter.trim() || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
  };

  const { data, isLoading } = trpc.orders.listFills.useQuery(
    queryInput,
    { staleTime: 15_000 }
  );

  const fills = data?.fills ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleExportCsv = async () => {
    try {
      const result = await utils.orders.exportFillsCsv.fetch({
        symbol: symbolFilter.trim() || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      });
      if (!result?.csv) { return; }
      const dateTag = fromDate && toDate
        ? `${fromDate}_to_${toDate}`
        : new Date().toISOString().slice(0, 10);
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nexcom-fills-${dateTag}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* silent */ }
  };

  const clearFilters = () => { setSymbolFilter(""); setFromDate(""); setToDate(""); setPage(0); };
  const hasFilters = !!symbolFilter || !!fromDate || !!toDate;

  // ── Symbol autocomplete ────────────────────────────────────────────────
  const { data: symbolsData } = trpc.marketData.symbols.useQuery(undefined, { staleTime: 60_000 });
  const allSymbols: string[] = useMemo(() => {
    if (!symbolsData) return [];
    if (Array.isArray(symbolsData)) return symbolsData as string[];
    return [];
  }, [symbolsData]);
  const [symbolOpen, setSymbolOpen] = useState(false);
  const symbolInputRef = useRef<HTMLInputElement>(null);
  const filteredSymbols = useMemo(() =>
    symbolFilter.trim().length === 0
      ? allSymbols.slice(0, 20)
      : allSymbols.filter(s => s.toLowerCase().includes(symbolFilter.trim().toLowerCase())).slice(0, 20),
    [allSymbols, symbolFilter]
  );
  const handleSymbolSelect = useCallback((sym: string) => {
    setSymbolFilter(sym);
    setSymbolOpen(false);
    setPage(0);
  }, []);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className="flex flex-wrap gap-2 items-center">
            {/* Symbol autocomplete */}
            <div className="relative w-52">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
              <Input
                ref={symbolInputRef}
                placeholder="Symbol…"
                value={symbolFilter}
                onChange={e => { setSymbolFilter(e.target.value); setPage(0); setSymbolOpen(true); }}
                onFocus={() => setSymbolOpen(true)}
                onBlur={() => setTimeout(() => setSymbolOpen(false), 150)}
                className="pl-9 h-9"
                autoComplete="off"
              />
              {symbolOpen && filteredSymbols.length > 0 && (
                <div className="absolute top-full left-0 z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-52 overflow-y-auto">
                  {filteredSymbols.map(sym => (
                    <button
                      key={sym}
                      type="button"
                      onMouseDown={() => handleSymbolSelect(sym)}
                      className={`w-full text-left px-3 py-2 text-sm font-mono hover:bg-accent hover:text-accent-foreground transition-colors ${
                        sym === symbolFilter ? "bg-accent text-accent-foreground" : ""
                      }`}
                    >
                      {sym}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Date range presets */}
            <div className="flex items-center gap-1">
              {([
                { label: "Today", days: 0 },
                { label: "7d", days: 7 },
                { label: "30d", days: 30 },
                { label: "90d", days: 90 },
              ] as { label: string; days: number }[]).map(({ label, days }) => {
                const applyPreset = () => {
                  const now = new Date();
                  const to = now.toISOString().slice(0, 10);
                  const from = days === 0
                    ? to
                    : new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
                  setFromDate(from);
                  setToDate(to);
                  setPage(0);
                };
                const isActive = (() => {
                  if (!fromDate || !toDate) return false;
                  const now = new Date();
                  const expectedTo = now.toISOString().slice(0, 10);
                  const expectedFrom = days === 0
                    ? expectedTo
                    : new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
                  return fromDate === expectedFrom && toDate === expectedTo;
                })();
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={applyPreset}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-emerald-600 text-white"
                        : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-white"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {/* Date range pickers */}
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-muted-foreground whitespace-nowrap">From</label>
              <Input
                type="date"
                value={fromDate}
                onChange={e => { setFromDate(e.target.value); setPage(0); }}
                className="h-9 w-36 text-xs"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-muted-foreground whitespace-nowrap">To</label>
              <Input
                type="date"
                value={toDate}
                onChange={e => { setToDate(e.target.value); setPage(0); }}
                className="h-9 w-36 text-xs"
              />
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" className="h-9 text-xs text-muted-foreground hover:text-white" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{total.toLocaleString()} fills</span>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 max-w-xs"
              onClick={handleExportCsv}
              disabled={total === 0}
              title={hasFilters
                ? `Export ${total.toLocaleString()} fills${symbolFilter ? ` for ${symbolFilter}` : ""}${fromDate ? ` from ${fromDate}` : ""}${toDate ? ` to ${toDate}` : ""}`
                : `Export all ${total.toLocaleString()} fills`
              }
            >
              <Download className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">
                {hasFilters
                  ? `Export${symbolFilter ? ` ${symbolFilter}` : ""}${fromDate && toDate ? ` (${fromDate} – ${toDate})` : fromDate ? ` from ${fromDate}` : toDate ? ` to ${toDate}` : ""}`
                  : "Export CSV"
                }
              </span>
            </Button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="exchange-table">
        <div className="hidden sm:grid grid-cols-[1fr_1fr_80px_100px_100px_100px_80px_120px] gap-3 px-4 py-3 bg-secondary/50 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <span>Symbol</span>
          <span>Asset Class</span>
          <span>Side</span>
          <span className="text-right">Qty</span>
          <span className="text-right">Price</span>
          <span className="text-right">Gross Value</span>
          <span className="text-right">Fee</span>
          <span className="text-right">Filled At</span>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground animate-pulse">Loading fills…</div>
        ) : fills.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {symbolFilter ? `No fills found for "${symbolFilter}"` : "No trade fills yet."}
          </div>
        ) : (
          fills.map((f) => (
            <div
              key={f.id}
              className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_80px_100px_100px_100px_80px_120px] gap-3 px-4 py-3 border-b border-border/50 hover:bg-secondary/30 transition-colors text-sm"
            >
              <span className="font-mono font-semibold text-white">{f.symbol}</span>
              <span className="text-muted-foreground text-xs">{f.assetClass}</span>
              <span className={f.side === "BUY" ? "text-emerald-400 font-semibold" : "text-red-400 font-semibold"}>{f.side}</span>
              <span className="text-right font-mono">{parseFloat(String(f.filledQty)).toLocaleString()}</span>
              <span className="text-right font-mono">{parseFloat(String(f.fillPrice)).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
              <span className="text-right font-mono text-muted-foreground">{parseFloat(String(f.grossValue)).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              <span className="text-right font-mono text-amber-400 text-xs">
                {parseFloat(String(f.side === "BUY" ? f.buyerFee : f.sellerFee)).toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </span>
              <span className="text-right text-xs text-muted-foreground">
                {new Date(f.createdAt).toLocaleString()}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
            ← Prev
          </Button>
          <span className="text-xs text-muted-foreground">Page {page + 1} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
            Next →
          </Button>
        </div>
      )}
    </div>
  );
}

export default function Orders() {
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [assetFilter, setAssetFilter] = useState<AssetClass | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "ALL">("ALL");
  const [activeTab, setActiveTab] = useState("all");
  const [confirmCancel, setConfirmCancel] = useState<DisplayOrder | null>(null);
  const [detailOrder, setDetailOrder] = useState<DisplayOrder | null>(null);
  const [amendOrder, setAmendOrder] = useState<AmendableOrder | null>(null);
  const [bulkAmendOpen, setBulkAmendOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Column visibility
  type ColumnKey = "type" | "qty" | "price" | "filled" | "status";
  const ALL_COLUMNS: { key: ColumnKey; label: string }[] = [
    { key: "type",   label: "Type" },
    { key: "qty",    label: "Qty" },
    { key: "price",  label: "Price" },
    { key: "filled", label: "Filled" },
    { key: "status", label: "Status" },
  ];
  const LS_KEY = "nexcom:orders:visibleCols";
  const [visibleCols, setVisibleCols] = useState<Set<ColumnKey>>(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as ColumnKey[];
        if (Array.isArray(parsed) && parsed.length > 0) return new Set(parsed);
      }
    } catch { /* ignore */ }
    return new Set(["type", "qty", "price", "filled", "status"] as ColumnKey[]);
  });
  const [colPopoverOpen, setColPopoverOpen] = useState(false);
  const toggleCol = (key: ColumnKey) =>
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem(LS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  // Also persist when resetting
  const resetCols = () => {
    const defaults = new Set(["type","qty","price","filled","status"] as ColumnKey[]);
    setVisibleCols(defaults);
    try { localStorage.setItem(LS_KEY, JSON.stringify([...defaults])); } catch { /* ignore */ }
  };

  // Advanced filter/sort state (R70)
  const [filterValues, setFilterValues] = useState<Record<string, string | number | undefined>>({});
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;
  const handleFilterChange = (key: string, value: string | number | undefined) => {
    setFilterValues(prev => ({ ...prev, [key]: value }));
    setPage(0);
  };
  const handleSortChange = (by: string, dir: "asc" | "desc") => { setSortBy(by); setSortDir(dir); setPage(0); };
  const handleFilterReset = () => { setFilterValues({}); setPage(0); };

  // Live tRPC data
  const { data: liveOrdersData, isLoading, refetch } = trpc.orders.list.useQuery(
    {
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      sortBy: sortBy as "createdAt" | "price" | "quantity" | "status" | "symbol",
      sortDir,
      symbol: filterValues.symbol as string | undefined,
      side: filterValues.side as "BUY" | "SELL" | undefined,
      orderType: filterValues.orderType as "LIMIT" | "MARKET" | "STOP_LIMIT" | undefined,
      status: filterValues.status as "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED" | "REJECTED" | "EXPIRED" | undefined,
      assetClass: filterValues.assetClass as "COMMODITY" | "FOREX" | "EQUITY" | "DIGITAL_ASSET" | "INDEX" | undefined,
      priceMin: filterValues.priceMin as number | undefined,
      priceMax: filterValues.priceMax as number | undefined,
      dateFrom: filterValues.dateFrom as string | undefined,
      dateTo: filterValues.dateTo as string | undefined,
    },
    { enabled: isAuthenticated }
  );
  const liveOrders = liveOrdersData?.orders;
  const totalServerCount = liveOrdersData?.total ?? 0;
  const cancelManyMutation = trpc.orders.cancelMany.useMutation({
    onSuccess: (res) => {
      toast.success(`${res.cancelled} order${res.cancelled !== 1 ? 's' : ''} cancelled${res.failed > 0 ? ` (${res.failed} failed)` : ''}`);
      setSelectedIds(new Set());
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const cancelMutation = trpc.orders.cancel.useMutation({
    onSuccess: () => { toast.success("Order cancelled"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  // Use live data if authenticated, fall back to mock for preview
  const allOrders: DisplayOrder[] = isAuthenticated
    ? (liveOrders ?? []).map((o) => ({
        id: o.id,
        symbol: o.symbol,
        assetClass: o.assetClass as AssetClass,
        side: o.side as OrderSide,
        orderType: o.orderType as OrderType,
        quantity: Number(o.quantity),
        price: o.price != null ? Number(o.price) : null,
        filledQty: Number(o.filledQty),
        avgFillPrice: o.avgFillPrice != null ? Number(o.avgFillPrice) : null,
        status: o.status as OrderStatus,
        timeInForce: o.timeInForce,
        createdAt: new Date(o.createdAt).toLocaleString(),
      }))
    : MOCK_ORDERS;

  const filtered = useMemo(() => {
    let rows = allOrders;
    if (activeTab === "open")      rows = rows.filter(o => o.status === "OPEN" || o.status === "PARTIALLY_FILLED");
    if (activeTab === "filled")    rows = rows.filter(o => o.status === "FILLED");
    if (activeTab === "cancelled") rows = rows.filter(o => ["CANCELLED","REJECTED","EXPIRED"].includes(o.status));
    if (assetFilter !== "ALL")     rows = rows.filter(o => o.assetClass === assetFilter);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(o => o.symbol.toLowerCase().includes(q) || String(o.id).includes(q));
    }
    return rows;
  }, [allOrders, activeTab, assetFilter, search]);

  const stats = useMemo(() => ({
    total:     allOrders.length,
    open:      allOrders.filter(o => o.status === "OPEN" || o.status === "PARTIALLY_FILLED").length,
    filled:    allOrders.filter(o => o.status === "FILLED").length,
    cancelled: allOrders.filter(o => ["CANCELLED","REJECTED","EXPIRED"].includes(o.status)).length,
  }), [allOrders]);

  const handleCancel = (order: DisplayOrder) => setConfirmCancel(order);

  const confirmCancelOrder = () => {
    if (!confirmCancel) return;
    if (isAuthenticated) {
      cancelMutation.mutate({ orderId: confirmCancel.id });
    } else {
      toast.success(`Order #${confirmCancel.id} cancelled (preview mode)`);
    }
    setConfirmCancel(null);
  };

  const formatQty = (o: DisplayOrder) => {
    if (o.assetClass === "FOREX") return `${(o.quantity / 1000).toFixed(0)}k`;
    if (o.assetClass === "DIGITAL_ASSET") return o.quantity.toFixed(4).replace(/\.?0+$/, "");
    return o.quantity.toFixed(0);
  };

  const formatPrice = (p: number | null, ac: AssetClass) => {
    if (p == null) return <span className="text-muted-foreground text-xs">MKT</span>;
    if (ac === "FOREX") return p.toFixed(4);
    return `$${p.toLocaleString()}`;
  };

  if (isAuthenticated && isLoading) return <PageSkeleton cards={3} tableRows={10} tableCols={6} />;

  return (
    <div className="page-container space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2" style={{ fontFamily: "'DM Serif Display', serif" }}>
            <ClipboardList className="w-6 h-6 text-primary" />
            Orders
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">All orders across commodities, forex, equities, and digital assets</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={!isAuthenticated}
            onClick={async () => {
              try {
                const result = await utils.orders.exportCsv.fetch({
                  assetClass: assetFilter !== "ALL" ? assetFilter as AssetClass : undefined,
                  status: statusFilter !== "ALL" ? statusFilter as OrderStatus : undefined,
                  columns: Array.from(visibleCols), // respect column visibility preferences
                });
                if (!result?.csv) { toast.error("No data to export"); return; }
                const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `nexcom-orders-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success("Order history downloaded");
              } catch {
                toast.error("Failed to export orders");
              }
            }}
          >
            <Download className="w-3.5 h-3.5" />Download CSV
          </Button>
          {selectedIds.size > 0 && isAuthenticated && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-amber-700/50 text-amber-400 hover:bg-amber-900/20 bg-transparent"
                onClick={() => setBulkAmendOpen(true)}
              >
                <Edit3 className="w-3.5 h-3.5" />
                Amend {selectedIds.size} Order{selectedIds.size !== 1 ? 's' : ''}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="gap-2"
                disabled={cancelManyMutation.isPending}
                onClick={() => cancelManyMutation.mutate({ ids: Array.from(selectedIds) })}
              >
                <XCircle className="w-3.5 h-3.5" />
                Cancel {selectedIds.size} Order{selectedIds.size !== 1 ? 's' : ''}
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" className="gap-2" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5" />Refresh
          </Button>
        </div>
      </div>

      {/* Auth banner */}
      {!isAuthenticated && (
        <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-primary/10 border border-primary/20 text-sm">
          <span className="text-muted-foreground">Showing preview data. <a href={getLoginUrl()} className="text-primary hover:underline">Sign in</a> to see your real orders.</span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Orders",  value: isLoading ? "—" : stats.total,     color: "text-foreground",  icon: ClipboardList },
          { label: "Open",          value: isLoading ? "—" : stats.open,      color: "text-blue-400",    icon: Clock },
          { label: "Filled",        value: isLoading ? "—" : stats.filled,    color: "text-positive",    icon: CheckCircle2 },
          { label: "Cancelled",     value: isLoading ? "—" : stats.cancelled, color: "text-muted-foreground", icon: XCircle },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="stat-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{label}</span>
              <Icon className={"w-4 h-4 " + color} />
            </div>
            <div className={"text-2xl font-bold font-mono " + color}>{value}</div>
          </div>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <TabsList>
            <TabsTrigger value="all">All ({stats.total})</TabsTrigger>
            <TabsTrigger value="open">Open ({stats.open})</TabsTrigger>
            <TabsTrigger value="filled">Filled ({stats.filled})</TabsTrigger>
            <TabsTrigger value="cancelled">Closed ({stats.cancelled})</TabsTrigger>
            <TabsTrigger value="fills">Fill Ledger</TabsTrigger>
          </TabsList>
            <div className="flex gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Symbol or ID..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
            </div>
            <Select value={assetFilter} onValueChange={v => setAssetFilter(v as AssetClass | "ALL")}>
              <SelectTrigger className="w-36 h-9">
                <Filter className="w-3.5 h-3.5 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Classes</SelectItem>
                <SelectItem value="COMMODITY">Commodity</SelectItem>
                <SelectItem value="FOREX">Forex</SelectItem>
                <SelectItem value="EQUITY">Equity</SelectItem>
                <SelectItem value="DIGITAL_ASSET">Digital</SelectItem>
              </SelectContent>
            </Select>
            {/* Column visibility toggle */}
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-2.5 gap-1.5 bg-transparent border-border"
                onClick={() => setColPopoverOpen(v => !v)}
                title="Toggle columns"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span className="hidden sm:inline text-xs">Columns</span>
              </Button>
              {colPopoverOpen && (
                <div className="absolute right-0 top-full mt-1 w-44 rounded-lg bg-popover border border-border shadow-xl z-50 overflow-hidden">
                  <div className="px-3 py-2 border-b border-border">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Show / Hide</p>
                  </div>
                  {ALL_COLUMNS.map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => toggleCol(key)}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent transition-colors"
                    >
                      <span className={visibleCols.has(key) ? "text-foreground" : "text-muted-foreground"}>{label}</span>
                      {visibleCols.has(key)
                        ? <Eye className="w-3.5 h-3.5 text-primary" />
                        : <EyeOff className="w-3.5 h-3.5 text-muted-foreground/50" />}
                    </button>
                  ))}
                  <div className="px-3 py-2 border-t border-border">
                    <button
                      onClick={resetCols}
                      className="text-[11px] text-primary hover:underline"
                    >
                      Reset to default
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Advanced Filter Bar (R70) */}
        {isAuthenticated && (
          <DataFilterBar
            className="mt-3"
            fields={[
              { key: "symbol", label: "Symbol", type: "text", placeholder: "e.g. CORN-NG-SPOT" },
              { key: "side", label: "Side", type: "select", options: [{ label: "Buy", value: "BUY" }, { label: "Sell", value: "SELL" }] },
              { key: "orderType", label: "Order Type", type: "select", options: [{ label: "Limit", value: "LIMIT" }, { label: "Market", value: "MARKET" }, { label: "Stop Limit", value: "STOP_LIMIT" }] },
              { key: "priceMin", label: "Min Price", type: "number", placeholder: "0" },
              { key: "priceMax", label: "Max Price", type: "number", placeholder: "∞" },
              { key: "dateFrom", label: "From Date", type: "date" },
              { key: "dateTo", label: "To Date", type: "date" },
            ]}
            sortOptions={[
              { label: "Date", value: "createdAt" },
              { label: "Symbol", value: "symbol" },
              { label: "Price", value: "price" },
              { label: "Quantity", value: "quantity" },
              { label: "Status", value: "status" },
            ]}
            values={filterValues}
            sortBy={sortBy}
            sortDir={sortDir}
            onFilterChange={handleFilterChange}
            onSortChange={handleSortChange}
            onReset={handleFilterReset}
          />
        )}
        {/* Advanced Filter Bar (R70) */}
        {isAuthenticated && (
          <DataFilterBar
            className="mt-3"
            fields={[
              { key: "symbol", label: "Symbol", type: "text", placeholder: "e.g. CORN-NG-SPOT" },
              { key: "side", label: "Side", type: "select", options: [{ label: "Buy", value: "BUY" }, { label: "Sell", value: "SELL" }] },
              { key: "orderType", label: "Order Type", type: "select", options: [{ label: "Limit", value: "LIMIT" }, { label: "Market", value: "MARKET" }, { label: "Stop Limit", value: "STOP_LIMIT" }] },
              { key: "priceMin", label: "Min Price", type: "number", placeholder: "0" },
              { key: "priceMax", label: "Max Price", type: "number", placeholder: "∞" },
              { key: "dateFrom", label: "From Date", type: "date" },
              { key: "dateTo", label: "To Date", type: "date" },
            ]}
            sortOptions={[
              { label: "Date", value: "createdAt" },
              { label: "Symbol", value: "symbol" },
              { label: "Price", value: "price" },
              { label: "Quantity", value: "quantity" },
              { label: "Status", value: "status" },
            ]}
            values={filterValues}
            sortBy={sortBy}
            sortDir={sortDir}
            onFilterChange={handleFilterChange}
            onSortChange={handleSortChange}
            onReset={handleFilterReset}
          />
        )}
        {["all","open","filled","cancelled"].map(tab => (
          <TabsContent key={tab} value={tab} className="mt-4">
            <div className="exchange-table">
              <div
                className="hidden sm:grid gap-3 px-4 py-3 bg-secondary/50 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                style={{ gridTemplateColumns: `auto auto 2fr ${visibleCols.has("type") ? "1fr" : ""} ${visibleCols.has("qty") ? "1fr" : ""} ${visibleCols.has("price") ? "1fr" : ""} ${visibleCols.has("filled") ? "1fr" : ""} ${visibleCols.has("status") ? "1fr" : ""} auto`.replace(/ +/g, " ").trim() }}
              >
                {/* Select-all checkbox */}
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded cursor-pointer accent-primary"
                  checked={selectedIds.size > 0 && filtered.filter(o => o.status === 'OPEN' || o.status === 'PARTIALLY_FILLED').every(o => selectedIds.has(o.id))}
                  onChange={e => {
                    const cancellable = filtered.filter(o => o.status === 'OPEN' || o.status === 'PARTIALLY_FILLED');
                    if (e.target.checked) setSelectedIds(new Set(cancellable.map(o => o.id)));
                    else setSelectedIds(new Set());
                  }}
                  title="Select all cancellable orders"
                />
                <span>Side</span>
                <span>Symbol</span>
                {visibleCols.has("type")   && <span>Type</span>}
                {visibleCols.has("qty")    && <span>Qty</span>}
                {visibleCols.has("price")  && <span>Price</span>}
                {visibleCols.has("filled") && <span>Filled</span>}
                {visibleCols.has("status") && <span>Status</span>}
                <span></span>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <ClipboardList className="w-10 h-10 text-muted-foreground/30" />
                  <p className="text-muted-foreground text-sm">
                    {isAuthenticated ? "No orders found" : "Sign in to see your orders"}
                  </p>
                  {isAuthenticated && (
                    <Link href="/trade">
                      <button className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 transition-colors">
                        Place First Order
                      </button>
                    </Link>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {filtered.map(o => {
                    const sc = STATUS_CONFIG[o.status];
                    const ac = ASSET_CLASS_CONFIG[o.assetClass];
                    const StatusIcon = sc.icon;
                    const canCancel = o.status === "OPEN" || o.status === "PARTIALLY_FILLED";
                    return (
                      <div
                        key={o.id}
                        className="grid gap-3 px-4 py-3 items-center exchange-row text-sm"
                        style={{ gridTemplateColumns: `auto auto 2fr ${visibleCols.has("type") ? "1fr" : ""} ${visibleCols.has("qty") ? "1fr" : ""} ${visibleCols.has("price") ? "1fr" : ""} ${visibleCols.has("filled") ? "1fr" : ""} ${visibleCols.has("status") ? "1fr" : ""} auto`.replace(/ +/g, " ").trim() }}
                      >
                        {/* Per-row checkbox */}
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded cursor-pointer accent-primary"
                          checked={selectedIds.has(o.id)}
                          disabled={o.status !== 'OPEN' && o.status !== 'PARTIALLY_FILLED'}
                          onChange={e => {
                            const next = new Set(selectedIds);
                            if (e.target.checked) next.add(o.id); else next.delete(o.id);
                            setSelectedIds(next);
                          }}
                          onClick={ev => ev.stopPropagation()}
                          title={canCancel ? 'Select for bulk cancel' : 'Cannot cancel'}
                        />
                        <div onClick={() => setDetailOrder(o)} className="contents cursor-pointer">
                        <Badge variant="outline" className={"text-[10px] " + (o.side === "BUY" ? "border-bid/30 text-bid" : "border-ask/30 text-ask")}>
                          {o.side}
                        </Badge>
                        <div className="min-w-0">
                          <div className="font-medium text-foreground truncate">{o.symbol}</div>
                          <div className={"text-xs " + ac.color}>{ac.label} · #{o.id}</div>
                        </div>
                        {visibleCols.has("type") && (
                          <div className="space-y-0.5">
                            <div className="font-mono text-muted-foreground text-xs">{o.orderType}</div>
                            {(o.timeInForce === "IOC" || o.timeInForce === "FOK") && (
                              <Badge
                                variant="outline"
                                className={`text-[9px] px-1 py-0 h-4 font-semibold ${
                                  o.timeInForce === "IOC"
                                    ? "border-orange-500/40 text-orange-400 bg-orange-500/5"
                                    : "border-purple-500/40 text-purple-400 bg-purple-500/5"
                                }`}
                                title={o.timeInForce === "IOC" ? "Immediate-or-Cancel: executed immediately or cancelled" : "Fill-or-Kill: must be fully filled immediately or cancelled"}
                              >
                                {o.timeInForce}
                              </Badge>
                            )}
                            {o.timeInForce === "GTC" && (
                              <div className="text-[9px] text-muted-foreground/60 font-mono">GTC</div>
                            )}
                          </div>
                        )}
                        {visibleCols.has("qty")    && <div className="font-mono text-foreground">{formatQty(o)}</div>}
                        {visibleCols.has("price")  && <div className="font-mono text-foreground">{formatPrice(o.price, o.assetClass)}</div>}
                        {visibleCols.has("filled") && (
                          <div className="font-mono text-muted-foreground text-xs">
                            {o.filledQty > 0 ? `${formatQty({ ...o, quantity: o.filledQty })} @ ${formatPrice(o.avgFillPrice, o.assetClass)}` : "—"}
                          </div>
                        )}
                        {visibleCols.has("status") && (
                          <div className="space-y-1">
                            <Badge className={"text-[10px] flex items-center gap-1 w-fit " + sc.className}>
                              <StatusIcon className="w-3 h-3" />{sc.label}
                            </Badge>
                            {o.timeInForce === "DAY" && (o.status === "OPEN" || o.status === "PARTIALLY_FILLED") && (
                              <DayOrderCountdown createdAt={o.createdAt} />
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          {canCancel && (
                            <button
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setAmendOrder({
                                  id: o.id,
                                  symbol: o.symbol,
                                  side: o.side,
                                  orderType: o.orderType,
                                  quantity: o.quantity,
                                  price: o.price,
                                  filledQty: o.filledQty,
                                  assetClass: o.assetClass,
                                  status: o.status as "OPEN" | "PARTIALLY_FILLED",
                                });
                              }}
                              className="p-1.5 rounded transition-colors hover:bg-amber-500/10 text-muted-foreground hover:text-amber-400"
                              title="Amend order"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={(ev) => { ev.stopPropagation(); if (canCancel) handleCancel(o); }}
                            disabled={!canCancel || cancelMutation.isPending}
                            className={"p-1.5 rounded transition-colors " + (canCancel ? "hover:bg-destructive/10 text-muted-foreground hover:text-destructive" : "opacity-20 cursor-not-allowed text-muted-foreground")}
                            title={canCancel ? "Cancel order" : "Cannot cancel"}
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                        </div>{/* end contents */}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>
         ))}

        {/* ── Fill Ledger Tab ──────────────────────────────────────────────── */}
        <TabsContent value="fills" className="mt-4">
          <FillsLedger />
        </TabsContent>
      </Tabs>

      {/* Order Detail Drawer */}
      <Sheet open={!!detailOrder} onOpenChange={(open) => !open && setDetailOrder(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md bg-card border-border text-white overflow-y-auto">
          {detailOrder && (() => {
            const sc = STATUS_CONFIG[detailOrder.status];
            const ac = ASSET_CLASS_CONFIG[detailOrder.assetClass];
            const StatusIcon = sc.icon;
            const fillPct = detailOrder.quantity > 0 ? (detailOrder.filledQty / detailOrder.quantity) * 100 : 0;
            return (
              <>
                <SheetHeader className="mb-6">
                  <SheetTitle className="text-white flex items-center gap-2">
                    <span className={detailOrder.side === "BUY" ? "text-emerald-400" : "text-red-400"}>{detailOrder.side}</span>
                    <span>{detailOrder.symbol}</span>
                  </SheetTitle>
                  <SheetDescription className="text-muted-foreground">Order #{detailOrder.id} · {ac.label}</SheetDescription>
                </SheetHeader>

                {/* Status badge */}
                <div className="flex items-center gap-2 mb-6">
                  <Badge className={"flex items-center gap-1.5 text-sm px-3 py-1 " + sc.className}>
                    <StatusIcon className="w-4 h-4" />{sc.label}
                  </Badge>
                  {detailOrder.status === "PARTIALLY_FILLED" && (
                    <span className="text-xs text-muted-foreground">{fillPct.toFixed(1)}% filled</span>
                  )}
                </div>

                {/* Fill progress bar */}
                {(detailOrder.status === "PARTIALLY_FILLED" || detailOrder.status === "FILLED") && (
                  <div className="mb-6">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Fill progress</span>
                      <span>{detailOrder.filledQty} / {detailOrder.quantity}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all"
                        style={{ width: `${Math.min(fillPct, 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Detail grid */}
                <div className="space-y-3">
                  {([
                    ["Order ID", `#${detailOrder.id}`],
                    ["Symbol", detailOrder.symbol],
                    ["Asset Class", ac.label],
                    ["Side", detailOrder.side],
                    ["Order Type", detailOrder.orderType],
                    ["Time In Force", detailOrder.timeInForce],
                    ["Quantity", detailOrder.quantity.toLocaleString()],
                    ["Limit Price", detailOrder.price != null ? detailOrder.price.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "Market"],
                    ["Filled Qty", detailOrder.filledQty.toLocaleString()],
                    ["Avg Fill Price", detailOrder.avgFillPrice != null ? detailOrder.avgFillPrice.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"],
                    ["Created At", detailOrder.createdAt],
                  ] as [string, string][]).map(([label, value]) => (
                    <div key={label} className="flex justify-between items-center py-2 border-b border-border">
                      <span className="text-sm text-muted-foreground">{label}</span>
                      <span className="text-sm font-mono text-white text-right">{value}</span>
                    </div>
                  ))}
                </div>

                {/* Amendment History Timeline */}
                <AmendmentTimeline orderId={detailOrder.id} />

                {/* Actions */}
                {(detailOrder.status === "OPEN" || detailOrder.status === "PARTIALLY_FILLED") && (
                  <div className="mt-6">
                    <Button
                      variant="destructive"
                      className="w-full"
                      onClick={() => { setDetailOrder(null); handleCancel(detailOrder); }}
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      Cancel This Order
                    </Button>
                  </div>
                )}
              </>
            );
          })()}
        </SheetContent>
      </Sheet>

       {/* Amend Order Modal */}
      <AmendOrderModal
        order={amendOrder}
        open={!!amendOrder}
        onClose={() => setAmendOrder(null)}
        onAmended={() => { utils.orders.list.invalidate(); utils.orders.stats.invalidate(); }}
      />
      {/* Bulk Amend Modal */}
      <BulkAmendModal
        orders={(() => {
          const amendable = (liveOrders ?? []).filter(
            (o) => selectedIds.has(o.id) && (o.status === 'OPEN' || o.status === 'PARTIALLY_FILLED')
          );
          return amendable.map((o): BulkAmendOrder => ({
            id: o.id,
            symbol: o.symbol,
            side: o.side as 'BUY' | 'SELL',
            orderType: o.orderType,
            quantity: parseFloat(String(o.quantity)),
            price: o.price ? parseFloat(String(o.price)) : null,
            filledQty: parseFloat(String(o.filledQty ?? 0)),
            status: o.status as 'OPEN' | 'PARTIALLY_FILLED',
          }));
        })()}
        open={bulkAmendOpen}
        onClose={() => setBulkAmendOpen(false)}
        onAmended={() => { setSelectedIds(new Set()); utils.orders.list.invalidate(); }}
      />
      {/* Cancel confirmation dialog */}
      <Dialog open={!!confirmCancel} onOpenChange={() => setConfirmCancel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Order #{confirmCancel?.id}?</DialogTitle>
            <DialogDescription>
              This will cancel your {confirmCancel?.side} order for {confirmCancel?.quantity} {confirmCancel?.symbol}.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-end mt-4">
            <Button variant="outline" onClick={() => setConfirmCancel(null)}>Keep Order</Button>
            <Button variant="destructive" onClick={confirmCancelOrder} disabled={cancelMutation.isPending}>
              {cancelMutation.isPending ? "Cancelling..." : "Cancel Order"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
