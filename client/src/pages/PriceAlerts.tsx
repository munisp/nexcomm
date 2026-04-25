/**
 * NEXCOM Exchange — Price Alerts Page
 * Full UI for creating, managing, and viewing triggered price alerts
 * across all asset classes (Commodities, Forex, Equities, Digital Assets).
 */
import { useState, useMemo, useEffect } from "react";
import { Bell, BellOff, Plus, Trash2, TrendingUp, TrendingDown, Activity, RefreshCw, AlertTriangle, CheckCircle2, Square, CheckSquare, MinusSquare, Pencil } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";
import { COMMODITIES } from "@shared/commodities";
import { FX_PAIRS, EQUITIES, CRYPTO_ASSETS } from "@shared/instruments";
import { PageSkeleton } from "@/components/PageSkeleton";

// ============================================================
// Types
// ============================================================
type AlertCondition = "ABOVE" | "BELOW" | "CROSS_ABOVE" | "CROSS_BELOW";

interface AlertFormState {
  symbol: string;
  condition: AlertCondition;
  targetPrice: string;
  assetClass: "COMMODITY" | "FOREX" | "EQUITY" | "DIGITAL_ASSET";
}

// ============================================================
// All symbols across asset classes
// ============================================================
const ALL_SYMBOLS = [
  ...COMMODITIES.map(c => ({ symbol: c.symbol, name: c.name, assetClass: "COMMODITY" as const, basePrice: c.basePrice })),
  ...FX_PAIRS.map(f => ({ symbol: f.symbol, name: f.label, assetClass: "FOREX" as const, basePrice: f.basePrice })),
  ...EQUITIES.map(e => ({ symbol: e.symbol, name: e.name, assetClass: "EQUITY" as const, basePrice: e.basePrice })),
  ...CRYPTO_ASSETS.map(c => ({ symbol: c.symbol, name: c.name, assetClass: "DIGITAL_ASSET" as const, basePrice: c.basePrice })),
];

const ASSET_CLASS_COLORS: Record<string, string> = {
  COMMODITY: "text-amber-400 bg-amber-400/10",
  FOREX: "text-blue-400 bg-blue-400/10",
  EQUITY: "text-purple-400 bg-purple-400/10",
  DIGITAL_ASSET: "text-cyan-400 bg-cyan-400/10",
};

const ASSET_CLASS_LABELS: Record<string, string> = {
  COMMODITY: "Commodity",
  FOREX: "Forex",
  EQUITY: "Equity",
  DIGITAL_ASSET: "Digital Asset",
};

const CONDITION_LABELS: Record<AlertCondition, string> = {
  ABOVE: "Price rises above",
  BELOW: "Price falls below",
  CROSS_ABOVE: "Price crosses above (once)",
  CROSS_BELOW: "Price crosses below (once)",
};

const CONDITION_ICONS: Record<AlertCondition, React.ReactElement> = {
  ABOVE: <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />,
  BELOW: <TrendingDown className="w-3.5 h-3.5 text-red-400" />,
  CROSS_ABOVE: <TrendingUp className="w-3.5 h-3.5 text-blue-400" />,
  CROSS_BELOW: <TrendingDown className="w-3.5 h-3.5 text-orange-400" />,
};

// ============================================================
// Create Alert Form
// ============================================================
function CreateAlertForm({ onSuccess, initialSymbol }: { onSuccess: () => void; initialSymbol?: string }) {
  const resolvedInitial = initialSymbol
    ? (ALL_SYMBOLS.find(s => s.symbol === initialSymbol) ?? null)
    : null;

  const [form, setForm] = useState<AlertFormState>({
    symbol: resolvedInitial?.symbol ?? "MAIZE-NG-SPOT",
    condition: "ABOVE",
    targetPrice: "",
    assetClass: resolvedInitial?.assetClass ?? "COMMODITY",
  });
  const [symbolSearch, setSymbolSearch] = useState(resolvedInitial?.symbol ?? "");

  // Sync when initialSymbol changes (e.g. navigating from watchlist)
  useEffect(() => {
    if (!initialSymbol) return;
    const inst = ALL_SYMBOLS.find(s => s.symbol === initialSymbol);
    if (inst) {
      setForm(prev => ({ ...prev, symbol: inst.symbol, assetClass: inst.assetClass }));
      setSymbolSearch(inst.symbol);
    }
  }, [initialSymbol]);
  const [showDropdown, setShowDropdown] = useState(false);

  const filteredSymbols = useMemo(() => {
    if (!symbolSearch) return ALL_SYMBOLS.slice(0, 20);
    const q = symbolSearch.toLowerCase();
    return ALL_SYMBOLS.filter(s =>
      s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [symbolSearch]);

  const selectedInstrument = ALL_SYMBOLS.find(s => s.symbol === form.symbol);

  const { data: priceData } = trpc.priceAlerts.currentPrice.useQuery(
    { symbol: form.symbol },
    { refetchInterval: 5000 }
  );

  const createMutation = trpc.priceAlerts.create.useMutation({
    onSuccess: () => {
      toast.success("Price alert created successfully");
      setForm(prev => ({ ...prev, targetPrice: "" }));
      onSuccess();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to create alert");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(form.targetPrice);
    if (isNaN(price) || price <= 0) {
      toast.error("Please enter a valid target price");
      return;
    }
    createMutation.mutate({
      symbol: form.symbol,
      condition: form.condition,
      targetPrice: price,
    });
  };

  const selectSymbol = (s: typeof ALL_SYMBOLS[0]) => {
    setForm(prev => ({ ...prev, symbol: s.symbol, assetClass: s.assetClass }));
    setSymbolSearch(s.symbol);
    setShowDropdown(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Symbol selector */}
      <div className="relative">
        <label className="block text-xs font-medium text-slate-400 mb-1.5">Instrument</label>
        <input
          type="text"
          value={symbolSearch || form.symbol}
          onChange={e => { setSymbolSearch(e.target.value); setShowDropdown(true); }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
          placeholder="Search symbol or name..." value={symbolSearch} onChange={(e) => setSymbolSearch(e.target.value)}
          className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30"
        />
        {showDropdown && filteredSymbols.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-xl max-h-56 overflow-y-auto">
            {filteredSymbols.map(s => (
              <button
                key={s.symbol}
                type="button"
                onClick={() => selectSymbol(s)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-800 text-left"
              >
                <div>
                  <span className="text-sm font-mono text-white">{s.symbol}</span>
                  <span className="text-xs text-slate-400 ml-2">{s.name}</span>
                </div>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${ASSET_CLASS_COLORS[s.assetClass]}`}>
                  {ASSET_CLASS_LABELS[s.assetClass]}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Current price display */}
      {priceData?.price && (
        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
          <Activity className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-xs text-slate-400">Current price:</span>
          <span className="text-sm font-mono font-semibold text-emerald-400">
            {priceData.price < 0.01
              ? priceData.price.toFixed(8)
              : priceData.price < 1
              ? priceData.price.toFixed(5)
              : priceData.price.toFixed(4)}
          </span>
          {selectedInstrument && (
            <span className={`ml-auto text-xs px-1.5 py-0.5 rounded font-medium ${ASSET_CLASS_COLORS[selectedInstrument.assetClass]}`}>
              {ASSET_CLASS_LABELS[selectedInstrument.assetClass]}
            </span>
          )}
        </div>
      )}

      {/* Condition selector */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">Alert Condition</label>
        <div className="grid grid-cols-2 gap-2">
          {(["ABOVE", "BELOW", "CROSS_ABOVE", "CROSS_BELOW"] as AlertCondition[]).map(cond => (
            <button
              key={cond}
              type="button"
              onClick={() => setForm(prev => ({ ...prev, condition: cond }))}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                form.condition === cond
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                  : "border-slate-700 bg-slate-800/40 text-slate-400 hover:border-slate-600"
              }`}
            >
              {CONDITION_ICONS[cond]}
              {CONDITION_LABELS[cond]}
            </button>
          ))}
        </div>
      </div>

      {/* Target price */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">Target Price</label>
        <div className="relative">
          <input
            type="number"
            step="any"
            min="0"
            value={form.targetPrice}
            onChange={e => setForm(prev => ({ ...prev, targetPrice: e.target.value }))}
            placeholder={priceData?.price ? `e.g. ${(priceData.price * 1.05).toFixed(4)}` : "Enter target price..."}
            className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 pr-16"
          />
          {priceData?.price && form.targetPrice && (
            <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium ${
              parseFloat(form.targetPrice) > priceData.price ? "text-emerald-400" : "text-red-400"
            }`}>
              {parseFloat(form.targetPrice) > priceData.price
                ? `+${(((parseFloat(form.targetPrice) - priceData.price) / priceData.price) * 100).toFixed(2)}%`
                : `${(((parseFloat(form.targetPrice) - priceData.price) / priceData.price) * 100).toFixed(2)}%`}
            </span>
          )}
        </div>
      </div>

      <button
        type="submit"
        disabled={createMutation.isPending || !form.targetPrice}
        className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm py-2.5 rounded-lg transition-colors"
      >
        {createMutation.isPending ? (
          <RefreshCw className="w-4 h-4 animate-spin" />
        ) : (
          <Plus className="w-4 h-4" />
        )}
        {createMutation.isPending ? "Creating..." : "Create Alert"}
      </button>
    </form>
  );
}

// ============================================================
// Alert Row
// ============================================================
function AlertRow({ alert, onDelete, onEdit, selected = false, onToggleSelect }: {
  alert: {
    id: number;
    symbol: string;
    condition: string;
    targetPrice: string;
    triggered: boolean;
    createdAt: Date;
  };
  onDelete: (id: number) => void;
  onEdit?: (alert: { id: number; symbol: string; condition: string; targetPrice: string }) => void;
  selected?: boolean;
  onToggleSelect?: (id: number) => void;
}) {
  const instrument = ALL_SYMBOLS.find(s => s.symbol === alert.symbol);
  const assetClass = instrument?.assetClass ?? "COMMODITY";
  const condition = alert.condition as AlertCondition;

  const { data: priceData } = trpc.priceAlerts.currentPrice.useQuery(
    { symbol: alert.symbol },
    { refetchInterval: 5000, enabled: !alert.triggered }
  );

  const target = parseFloat(alert.targetPrice);
  const current = priceData?.price ?? null;
  const pctFromTarget = current ? ((current - target) / target) * 100 : null;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
      selected
        ? "border-emerald-500/50 bg-emerald-500/8"
        : alert.triggered
        ? "border-emerald-500/30 bg-emerald-500/5"
        : "border-slate-700/50 bg-slate-800/30 hover:border-slate-600"
    }`}>
      {!alert.triggered && onToggleSelect && (
        <button
          onClick={() => onToggleSelect(alert.id)}
          className="flex-shrink-0 text-slate-400 hover:text-white transition-colors"
          title={selected ? "Deselect" : "Select"}
        >
          {selected ? (
            <CheckSquare className="w-4 h-4 text-emerald-400" />
          ) : (
            <Square className="w-4 h-4" />
          )}
        </button>
      )}
      <div className="flex-shrink-0">
        {alert.triggered ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
        ) : (
          <Bell className="w-5 h-5 text-slate-400" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-semibold text-sm text-white">{alert.symbol}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${ASSET_CLASS_COLORS[assetClass]}`}>
            {ASSET_CLASS_LABELS[assetClass]}
          </span>
          <span className="flex items-center gap-1 text-xs text-slate-400">
            {CONDITION_ICONS[condition]}
            {CONDITION_LABELS[condition]}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-sm font-mono font-bold text-white">
            Target: {target < 0.01 ? target.toFixed(8) : target < 1 ? target.toFixed(5) : target.toFixed(4)}
          </span>
          {current !== null && !alert.triggered && (
            <span className="text-xs text-slate-400">
              Current: <span className="font-mono text-slate-300">
                {current < 0.01 ? current.toFixed(8) : current < 1 ? current.toFixed(5) : current.toFixed(4)}
              </span>
              {pctFromTarget !== null && (
                <span className={`ml-1 ${pctFromTarget > 0 ? "text-emerald-400" : "text-red-400"}`}>
                  ({pctFromTarget > 0 ? "+" : ""}{pctFromTarget.toFixed(2)}% to target)
                </span>
              )}
            </span>
          )}
          {alert.triggered && (
            <span className="text-xs text-emerald-400 font-medium">✓ Triggered</span>
          )}
        </div>
        <div className="text-xs text-slate-500 mt-0.5">
          Created {new Date(alert.createdAt).toLocaleString()}
        </div>
      </div>

      {!alert.triggered && (
        <div className="flex items-center gap-1 flex-shrink-0">
          {onEdit && (
            <button
              onClick={() => onEdit({ id: alert.id, symbol: alert.symbol, condition: alert.condition, targetPrice: alert.targetPrice })}
              className="p-1.5 text-slate-500 hover:text-blue-400 hover:bg-blue-400/10 rounded-lg transition-colors"
              title="Edit alert"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => onDelete(alert.id)}
            className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
            title="Delete alert"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main Page
// ============================================================
export default function PriceAlerts() {
  const { isAuthenticated, loading } = useAuth();
  // Read ?symbol=XXXX from URL to pre-fill the create form (set by watchlist shortcut)
  const initialSymbol = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("symbol") ?? undefined
    : undefined;
  const [activeTab, setActiveTab] = useState<"active" | "triggered">("active");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [editAlert, setEditAlert] = useState<{ id: number; symbol: string; condition: string; targetPrice: string } | null>(null);
  const [editCondition, setEditCondition] = useState<AlertCondition>("ABOVE");
  const [editPrice, setEditPrice] = useState("");

  const { data, isLoading, refetch } = trpc.priceAlerts.list.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 15000,
  });

  const deleteMutation = trpc.priceAlerts.delete.useMutation({
    onSuccess: () => {
      toast.success("Alert deleted");
      refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to delete alert");
    },
  });

  const deleteManyMutation = trpc.priceAlerts.deleteMany.useMutation({
    onSuccess: (res) => {
      toast.success(`${res.deleted} alert${res.deleted !== 1 ? "s" : ""} deleted`);
      setSelectedIds(new Set());
      refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to delete alerts");
    },
  });

  const updateMutation = trpc.priceAlerts.update.useMutation({
    onSuccess: () => {
      toast.success("Alert updated");
      setEditAlert(null);
      refetch();
    },
    onError: (err) => toast.error(err.message || "Failed to update alert"),
  });

  const handleOpenEdit = (alert: { id: number; symbol: string; condition: string; targetPrice: string }) => {
    setEditAlert(alert);
    setEditCondition(alert.condition as AlertCondition);
    setEditPrice(parseFloat(alert.targetPrice).toString());
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 text-emerald-400 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertTriangle className="w-12 h-12 text-amber-400" />
        <p className="text-slate-400 text-center">Sign in to manage your price alerts</p>
        <a
          href={getLoginUrl()}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          Sign In
        </a>
      </div>
    );
  }

  const activeAlerts = data?.active ?? [];
  const triggeredAlerts = data?.triggered ?? [];

  const currentList = activeTab === "active" ? activeAlerts : triggeredAlerts;
  const selectableIds = currentList.filter(a => !a.triggered).map(a => a.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selectedIds.has(id));
  const someSelected = selectableIds.some(id => selectedIds.has(id));

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(prev => { const next = new Set(prev); selectableIds.forEach(id => next.delete(id)); return next; });
    } else {
      setSelectedIds(prev => { const next = new Set(prev); selectableIds.forEach(id => next.add(id)); return next; });
    }
  };

  if (isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="border-b border-slate-800 px-4 sm:px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Bell className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Price Alerts</h1>
              <p className="text-xs text-slate-400">
                {activeAlerts.length} active · {triggeredAlerts.length} triggered · Checks every 30s
              </p>
            </div>
          </div>
          <button
            onClick={() => refetch()}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Create Alert Panel */}
          <div className="lg:col-span-1">
            <div className="bg-slate-900/60 border border-slate-700/50 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Plus className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-semibold text-white">New Alert</h2>
              </div>
              <CreateAlertForm onSuccess={() => refetch()} initialSymbol={initialSymbol} />
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-emerald-400">{activeAlerts.length}</div>
                <div className="text-xs text-slate-400 mt-1">Active Alerts</div>
              </div>
              <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-blue-400">{triggeredAlerts.length}</div>
                <div className="text-xs text-slate-400 mt-1">Triggered</div>
              </div>
            </div>

            {/* Info box */}
            <div className="mt-4 p-4 bg-slate-900/40 border border-slate-700/30 rounded-xl">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-slate-400 space-y-1">
                  <p className="font-medium text-slate-300">How alerts work</p>
                  <p>The server checks prices every 30 seconds against your targets. When triggered, you receive an owner notification and the alert is marked as completed.</p>
                  <p className="mt-1">Alerts cover all asset classes: Commodities, Forex, Equities, and Digital Assets.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Alerts List */}
          <div className="lg:col-span-2">
            {/* Tabs */}
            <div className="flex gap-1 bg-slate-900/60 border border-slate-700/50 rounded-xl p-1 mb-4">
              <button
                onClick={() => setActiveTab("active")}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === "active"
                    ? "bg-emerald-600 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Bell className="w-4 h-4" />
                Active ({activeAlerts.length})
              </button>
              <button
                onClick={() => setActiveTab("triggered")}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === "triggered"
                    ? "bg-blue-600 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                Triggered ({triggeredAlerts.length})
              </button>
            </div>

            {/* Bulk action bar */}
            {selectableIds.length > 0 && (
              <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-slate-800/60 border border-slate-700/50 rounded-xl">
                <button
                  onClick={toggleSelectAll}
                  className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white transition-colors"
                >
                  {allSelected ? (
                    <CheckSquare className="w-4 h-4 text-emerald-400" />
                  ) : someSelected ? (
                    <MinusSquare className="w-4 h-4 text-amber-400" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                  {allSelected ? "Deselect all" : "Select all"}
                </button>
                {someSelected && (
                  <>
                    <span className="text-xs text-slate-500">{selectedIds.size} selected</span>
                    <button
                      onClick={() => deleteManyMutation.mutate({ ids: Array.from(selectedIds) })}
                      disabled={deleteManyMutation.isPending}
                      className="ml-auto flex items-center gap-1.5 px-3 py-1 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {deleteManyMutation.isPending ? "Deleting..." : `Delete ${selectedIds.size}`}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Alert list */}
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-20 bg-slate-800/40 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : activeTab === "active" ? (
              activeAlerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3 bg-slate-900/40 border border-slate-700/30 rounded-2xl">
                  <BellOff className="w-10 h-10 text-slate-600" />
                  <p className="text-slate-400 text-sm">No active alerts</p>
                  <p className="text-slate-500 text-xs">Create your first alert using the form on the left</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {activeAlerts.map(alert => (
                    <AlertRow
                      key={alert.id}
                      alert={alert}
                      onDelete={(id) => deleteMutation.mutate({ id })}
                      onEdit={handleOpenEdit}
                      selected={selectedIds.has(alert.id)}
                      onToggleSelect={toggleSelect}
                    />
                  ))}
                </div>
              )
            ) : (
              triggeredAlerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3 bg-slate-900/40 border border-slate-700/30 rounded-2xl">
                  <CheckCircle2 className="w-10 h-10 text-slate-600" />
                  <p className="text-slate-400 text-sm">No triggered alerts yet</p>
                  <p className="text-slate-500 text-xs">Triggered alerts will appear here once conditions are met</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {triggeredAlerts.map(alert => (
                    <AlertRow
                      key={alert.id}
                      alert={alert}
                      onDelete={(id) => deleteMutation.mutate({ id })}
                      selected={selectedIds.has(alert.id)}
                      onToggleSelect={toggleSelect}
                    />
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* Edit Alert Dialog */}
      {editAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
            <h2 className="text-base font-bold text-white mb-1">Edit Alert</h2>
            <p className="text-xs text-slate-400 mb-4 font-mono">{editAlert.symbol}</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Condition</label>
                <select
                  value={editCondition}
                  onChange={e => setEditCondition(e.target.value as AlertCondition)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                >
                  {(Object.keys(CONDITION_LABELS) as AlertCondition[]).map(c => (
                    <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Target Price</label>
                <input
                  type="number"
                  value={editPrice}
                  onChange={e => setEditPrice(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-emerald-500"
                  placeholder="0.0000"
                  step="any"
                  min="0"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setEditAlert(null)}
                className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!editPrice || isNaN(parseFloat(editPrice))) {
                    toast.error("Enter a valid target price");
                    return;
                  }
                  updateMutation.mutate({
                    id: editAlert.id,
                    condition: editCondition,
                    targetPrice: parseFloat(editPrice),
                  });
                }}
                disabled={updateMutation.isPending}
                className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
