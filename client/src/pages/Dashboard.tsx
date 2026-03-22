/**
 * NEXCOM Exchange — Dashboard
 * Overview: portfolio summary, live prices, watchlist, recent activity, quick actions
 */
import { useState, useEffect } from "react";
import { Link } from "wouter";
import {
  TrendingUp, Package, FileText, Truck,
  ShoppingCart, ArrowUpRight, ArrowDownRight, Activity,
  CheckCircle2, Zap, Star, Plus, X, Bell,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePreferences } from "@/contexts/PreferencesContext";
import {
  generateAllTicks, COMMODITIES, CATEGORY_LABELS, CATEGORY_ICONS,
  type PriceTick
} from "../../../shared/commodities";
import PortfolioPnLChart from "@/components/PortfolioPnLChart";
import PortfolioAllocationChart from "@/components/PortfolioAllocationChart";
import FarmerProgressTracker from "@/components/FarmerProgressTracker";

const FEATURED_SYMBOLS = [
  "GINGER-NG-SPOT","MAIZE-NG-SPOT","COCOA-SPOT","SOYBEAN-SPOT",
  "GROUNDNUT-SPOT","CRUDE-NG-SPOT","GOLD-SPOT","SESAME-SPOT",
];

function timeAgo(d: Date) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function StatCard({ title, value, sub, icon: Icon, iconColor, trend }: {
  title: string; value: string; sub?: string;
  icon: React.ElementType; iconColor: string; trend?: number;
}) {
  return (
    <div className="stat-card">
      <div className="flex items-start justify-between mb-3">
        <div className={"w-9 h-9 rounded-lg flex items-center justify-center " + iconColor}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        {trend !== undefined && (
          <span className={"text-xs font-medium flex items-center gap-0.5 " + (trend >= 0 ? "text-positive" : "text-negative")}>
            {trend >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="text-2xl font-bold text-foreground font-mono">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{title}</div>
      {sub && <div className="text-xs text-muted-foreground/60 mt-0.5">{sub}</div>}
    </div>
  );
}

function PriceCard({ tick }: { tick: PriceTick }) {
  const commodity = COMMODITIES.find(c => c.symbol === tick.symbol);
  const isUp = tick.changePct >= 0;
  return (
    <Link
      href={`/trade/${tick.symbol}`}
      className="stat-card cursor-pointer block"
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-xs text-muted-foreground font-medium">
            {CATEGORY_ICONS[commodity?.category || "GRAINS"]} {commodity?.category ? CATEGORY_LABELS[commodity.category] : ""}
          </div>
          <div className="text-sm font-semibold text-foreground mt-0.5 leading-tight">
            {tick.symbol.replace("-SPOT","").replace("-NG","").replace("-","\u00a0")}
          </div>
        </div>
        <Badge variant="outline" className={"text-[10px] " + (isUp ? "border-positive/30 text-positive" : "border-negative/30 text-negative")}>
          {isUp ? "▲" : "▼"} {Math.abs(tick.changePct).toFixed(2)}%
        </Badge>
      </div>
      <div className="text-xl font-bold font-mono text-foreground">
        ${tick.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        {commodity?.unit} · Vol {tick.volume.toLocaleString()}
      </div>
      <div className="mt-2 h-0.5 rounded-full overflow-hidden bg-border">
        <div
          className={"h-full rounded-full " + (isUp ? "bg-positive" : "bg-negative")}
          style={{ width: `${Math.min(100, 50 + tick.changePct * 10)}%` }}
        />
      </div>
    </Link>
  );
}

// ============================================================
// Watchlist Widget — tRPC-backed, add/remove instruments
// ============================================================
function WatchlistWidget({ ticks }: { ticks: PriceTick[] }) {
  const { isAuthenticated } = useAuth();
  const [addSymbol, setAddSymbol] = useState("");
  const utils = trpc.useUtils();

  const { data: watchedSymbols = [] } = trpc.watchlist.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const addMutation = trpc.watchlist.add.useMutation({
    onSuccess: (r) => {
      if (r.added) { toast.success("Added to watchlist"); utils.watchlist.list.invalidate(); }
      else toast.info("Already in watchlist");
      setAddSymbol("");
    },
    onError: (e) => toast.error(e.message),
  });

  const removeMutation = trpc.watchlist.remove.useMutation({
    onSuccess: () => { toast.success("Removed from watchlist"); utils.watchlist.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const watchedTicks = watchedSymbols
    .map(sym => ticks.find(t => t.symbol === sym))
    .filter((t): t is PriceTick => !!t);

  if (!isAuthenticated) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Star className="w-4 h-4 text-yellow-400" />
          My Watchlist
        </h2>
        <div className="flex items-center gap-2">
          <Input
            value={addSymbol}
            onChange={e => setAddSymbol(e.target.value.toUpperCase())}
            placeholder="Add symbol…"
            className="h-7 w-40 text-xs font-mono"
            onKeyDown={e => {
              if (e.key === "Enter" && addSymbol.trim())
                addMutation.mutate({ symbol: addSymbol.trim() });
            }}
          />
          <Button size="sm" variant="outline" className="h-7 px-2"
            onClick={() => { if (addSymbol.trim()) addMutation.mutate({ symbol: addSymbol.trim() }); }}
            disabled={addMutation.isPending}>
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      {watchedTicks.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground text-sm border border-dashed border-border rounded-xl">
          <Star className="w-8 h-8 mx-auto mb-2 opacity-30" />
          No instruments on your watchlist yet.<br />
          <span className="text-xs">Type a symbol (e.g. GINGER-NG-SPOT) and press Enter.</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {watchedTicks.map(tick => {
            const commodity = COMMODITIES.find(c => c.symbol === tick.symbol);
            const isUp = tick.changePct >= 0;
            return (
              <div key={tick.symbol} className="stat-card relative group">
                {/* Remove button */}
                <button
                  onClick={() => removeMutation.mutate({ symbol: tick.symbol })}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-negative"
                  title="Remove from watchlist">
                  <X className="w-3.5 h-3.5" />
                </button>
                {/* Add Alert shortcut */}
                <Link
                  href={`/alerts?symbol=${encodeURIComponent(tick.symbol)}`}
                  className="absolute top-2 right-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
                  title="Set price alert for this symbol">
                  <Bell className="w-3.5 h-3.5" />
                </Link>
                <div className="text-xs text-muted-foreground font-medium mb-1">
                  {CATEGORY_ICONS[commodity?.category || "GRAINS"]} {commodity?.category ? CATEGORY_LABELS[commodity.category] : ""}
                </div>
                <div className="text-sm font-semibold text-foreground leading-tight">
                  {tick.symbol.replace("-SPOT","").replace("-NG","")}
                </div>
                <div className={"text-lg font-mono font-bold " + (isUp ? "text-positive" : "text-negative")}>
                  ${tick.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
                <div className={"text-xs font-medium flex items-center gap-0.5 " + (isUp ? "text-positive" : "text-negative")}>
                  {isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {isUp ? "+" : ""}{tick.changePct.toFixed(2)}%
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [ticks, setTicks] = useState<PriceTick[]>(() => generateAllTicks());
  const { data: user } = trpc.auth.me.useQuery();
  const { isAuthenticated } = useAuth();
  const { formatCurrency, t } = usePreferences();
  const { data: orderStats } = trpc.orders.stats.useQuery(undefined, { enabled: isAuthenticated });
  const { data: portfolioSummary } = trpc.portfolio.summary.useQuery(undefined, { enabled: isAuthenticated });
  const { data: recentOrders = [] } = trpc.orders.list.useQuery({ limit: 5 }, { enabled: isAuthenticated });
  const { data: receiptsData } = trpc.receipts.list.useQuery({ limit: 100 }, { enabled: isAuthenticated });

  useEffect(() => {
    const id = setInterval(() => setTicks(generateAllTicks()), 5000);
    return () => clearInterval(id);
  }, []);

  const featuredTicks = FEATURED_SYMBOLS
    .map(s => ticks.find(t => t.symbol === s))
    .filter((t): t is PriceTick => !!t);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  };

  return (
    <div className="page-container space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'DM Serif Display', serif" }}>
            {greeting()}, {user?.name?.split(" ")[0] || "Trader"} 👋
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString("en-NG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            <span className="ml-2 inline-flex items-center gap-1 text-primary">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse inline-block" />
              Exchange Open
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/trade"
            className="inline-flex items-center gap-2 h-9 px-3 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <ShoppingCart className="w-4 h-4" />New Trade
          </Link>
          <Link
            href="/deposits"
            className="inline-flex items-center gap-2 h-9 px-3 text-sm font-medium rounded-md border border-border bg-transparent text-foreground hover:bg-accent transition-colors"
          >
            <Package className="w-4 h-4" />Deposit
          </Link>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title={t("label.portfolio")}
          value={portfolioSummary?.totalValue != null ? formatCurrency(portfolioSummary.totalValue, true) : "—"}
          sub={t("dash.totalValue")} icon={Activity} iconColor="bg-primary" />
        <StatCard title="Open Orders"
          value={orderStats ? String(orderStats.open) : "—"}
          sub="Active on exchange" icon={ShoppingCart} iconColor="bg-blue-500/80" />
        <StatCard title="Warehouse Receipts"
          value={String(receiptsData?.receipts?.filter((r) => r.status === "ACTIVE").length ?? 0)}
          sub="EWRs in custody" icon={FileText} iconColor="bg-yellow-500/80" />
        <StatCard title="Total Trades"
          value={orderStats ? String(orderStats.filled) : "—"}
          sub="Filled orders" icon={TrendingUp} iconColor="bg-positive/80" />
      </div>

      {/* Portfolio charts row: P&L equity curve + allocation donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <PortfolioPnLChart days={30} height={180} />
        </div>
        <div className="lg:col-span-1">
          <PortfolioAllocationChart />
        </div>
      </div>

      {/* Farmer Journey progress tracker + Watchlist */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <WatchlistWidget ticks={ticks} />
        </div>
        <div className="lg:col-span-1">
          <FarmerProgressTracker />
        </div>
      </div>

      {/* Main grid: live prices + activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Live prices */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              Live Market Prices
            </h2>
            <Link
              href="/markets"
              className="inline-flex items-center h-7 px-2 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              View All →
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {featuredTicks.map(tick => (
              <PriceCard key={tick.symbol} tick={tick} />
            ))}
          </div>
        </div>

        {/* Activity feed — live orders */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Recent Activity</h2>
            <Link href="/orders" className="text-xs h-7 px-2 text-primary hover:text-primary/80 transition-colors">View All →</Link>
          </div>
          <div className="space-y-2">
            {recentOrders.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm border border-dashed border-border rounded-xl">
                No recent activity. Place your first trade!
              </div>
            ) : recentOrders.map((order: { id: number; side: string; symbol: string; quantity: string; price: string | null; status: string; createdAt: Date }) => (
              <div key={order.id} className="flex items-start gap-3 p-3 rounded-lg bg-card border border-border hover:border-primary/30 transition-colors">
                <div className={"w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-secondary " + (order.side === "BUY" ? "text-positive" : "text-negative")}>
                  <ShoppingCart className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground leading-tight">{order.side} {order.symbol}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    {order.quantity} units{order.price ? ` @ $${parseFloat(order.price).toLocaleString()}` : " (Market)"}
                  </div>
                  <div className="text-[10px] text-muted-foreground/60 mt-1">{timeAgo(new Date(order.createdAt))}</div>
                </div>
                <Badge variant="outline" className="text-[10px] flex-shrink-0 capitalize">
                  {order.status.toLowerCase()}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { href: "/trade",    icon: ShoppingCart, label: "Place Order",       desc: "Buy or sell commodities",      color: "bg-primary/10 text-primary border-primary/20" },
            { href: "/deposits", icon: Package,      label: "New Deposit",       desc: "Register commodity deposit",   color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
            { href: "/receipts", icon: FileText,     label: "View Receipts",     desc: "Electronic warehouse receipts",color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
            { href: "/delivery", icon: Truck,        label: "Schedule Delivery", desc: "Arrange physical delivery",    color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
          ].map(({ href, icon: Icon, label, desc, color }) => (
            <Link
              key={href}
              href={href}
              className={"flex flex-col gap-2 p-4 rounded-xl border transition-all duration-200 hover:scale-[1.02] cursor-pointer " + color}
            >
              <Icon className="w-5 h-5" />
              <div>
                <div className="text-sm font-semibold">{label}</div>
                <div className="text-xs opacity-70 mt-0.5">{desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Category overview */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3">Market Categories</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {(Object.entries(CATEGORY_LABELS) as [string, string][]).map(([key, label]) => {
            const catTicks = ticks.filter(t => {
              const c = COMMODITIES.find(c => c.symbol === t.symbol);
              return c?.category === key;
            });
            const avgChange = catTicks.length
              ? catTicks.reduce((s, t) => s + t.changePct, 0) / catTicks.length
              : 0;
            return (
              <Link
                key={key}
                href={`/markets?category=${key}`}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-card border border-border hover:border-primary/30 transition-colors cursor-pointer text-center"
              >
                <span className="text-2xl">{CATEGORY_ICONS[key as keyof typeof CATEGORY_ICONS]}</span>
                <span className="text-xs font-medium text-foreground leading-tight">{label.split(" ")[0]}</span>
                <span className={"text-[10px] font-mono " + (avgChange >= 0 ? "text-positive" : "text-negative")}>
                  {avgChange >= 0 ? "+" : ""}{avgChange.toFixed(2)}%
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
