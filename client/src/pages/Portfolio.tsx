/**
 * NEXCOM Exchange — Portfolio Page
 * Holdings, P&L, trade history, and performance metrics
 */
import { useState, useEffect, useMemo } from "react";
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, BarChart3, RefreshCw } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generateMockTick, COMMODITIES, CATEGORY_ICONS } from "../../../shared/commodities";
import { trpc } from "@/lib/trpc";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Link } from "wouter";
import { toast } from "sonner";

interface Holding {
  symbol: string;
  qty: number;
  avgCost: number;
  unit: string;
}

export default function Portfolio() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [historyPage, setHistoryPage] = useState(1);
  const [historySymbol, setHistorySymbol] = useState("");

  // Live tRPC data
  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } =
    trpc.portfolio.summary.useQuery(undefined, { enabled: isAuthenticated });
  const { data: historyData, isLoading: historyLoading } =
    trpc.portfolio.tradeHistory.useQuery(
      { page: historyPage, limit: 20, symbol: historySymbol || undefined },
      { enabled: isAuthenticated }
    );
  const { data: personalAnalytics } =
    trpc.analytics.personal.useQuery(undefined, { enabled: isAuthenticated });

  // Fallback mock prices for unauthenticated preview
  useEffect(() => {
    const update = () => {
      const p: Record<string, number> = {};
      (summary?.positions ?? []).forEach((h: { symbol: string; avgCost: string }) => {
        p[h.symbol] = generateMockTick(h.symbol).price;
      });
      setPrices(p);
    };
    update();
    const id = setInterval(update, 5000);
    return () => clearInterval(id);
  }, [summary]);

  // Build enriched positions from live DB data
  const livePositions = summary?.positions ?? [];
  const enriched = useMemo(() => livePositions.map((h: { symbol: string; quantity: string; avgCost: string; realizedPnl: string }) => {
    const currentPrice = prices[h.symbol] ?? Number(h.avgCost);
    const qty = Number(h.quantity);
    const avgCost = Number(h.avgCost);
    const currentValue = currentPrice * qty;
    const costBasis = avgCost * qty;
    const pnl = currentValue - costBasis;
    const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
    const commodity = COMMODITIES.find(c => c.symbol === h.symbol);
    return { ...h, qty, avgCost, currentPrice, currentValue, costBasis, pnl, pnlPct, commodity, unit: "MT" };
  }), [livePositions, prices]);

  const totalValue = enriched.reduce((s: number, h: { currentValue: number }) => s + h.currentValue, 0);
  const totalCost = enriched.reduce((s: number, h: { costBasis: number }) => s + h.costBasis, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const totalRealizedPnl = Number(summary?.totalRealizedPnl ?? 0);
  const tradeHistory = historyData?.trades ?? [];
  const totalTrades = personalAnalytics?.totalTrades ?? tradeHistory.length;
  const [historyDays, setHistoryDays] = useState(30);
  const { data: pnlHistory = [] } = trpc.portfolio.history.useQuery(
    { days: historyDays },
    { enabled: isAuthenticated }
  );

  if (isAuthenticated && (summaryLoading || historyLoading || authLoading)) return <PageSkeleton cards={4} tableRows={8} tableCols={5} showChart />;

  return (
    <div className="page-container space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'DM Serif Display', serif" }}>
            Portfolio
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Holdings, performance, and trade history</p>
        </div>
        {isAuthenticated && (
          <button
            onClick={() => { refetchSummary(); toast.success("Portfolio refreshed"); }}
            className="p-2 rounded-lg bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="stat-card col-span-2 sm:col-span-1">
          <div className="text-xs text-muted-foreground mb-1">Total Portfolio Value</div>
          <div className="text-2xl font-bold font-mono text-foreground">
            {summaryLoading ? "—" : `$${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          </div>
          <div className={"text-sm font-mono flex items-center gap-1 mt-1 " + (totalPnl >= 0 ? "text-positive" : "text-negative")}>
            {totalPnl >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
            {totalPnl >= 0 ? "+" : ""}${Math.abs(totalPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })} ({totalPnlPct.toFixed(2)}%)
          </div>
        </div>
        <div className="stat-card text-center">
          <div className="text-2xl font-bold font-mono text-foreground">{summaryLoading ? "—" : enriched.length}</div>
          <div className="text-xs text-muted-foreground mt-1">Positions</div>
        </div>
        <div className="stat-card text-center">
          <div className="text-2xl font-bold font-mono text-positive">{enriched.filter((h: { pnl: number }) => h.pnl >= 0).length}</div>
          <div className="text-xs text-muted-foreground mt-1">Profitable</div>
        </div>
        <div className="stat-card text-center">
          <div className="text-2xl font-bold font-mono text-foreground">{summaryLoading ? "—" : totalTrades}</div>
          <div className="text-xs text-muted-foreground mt-1">Total Trades</div>
        </div>
      </div>

      <Tabs defaultValue="holdings">
        <TabsList>
          <TabsTrigger value="holdings">Holdings ({enriched.length})</TabsTrigger>
          <TabsTrigger value="history">Trade History</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="holdings" className="mt-4">
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 bg-secondary/50 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <span>Commodity</span>
              <span>Quantity</span>
              <span>Avg Cost</span>
              <span>Current</span>
              <span>P&amp;L</span>
            </div>
            {summaryLoading ? (
              <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
            ) : enriched.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <BarChart3 className="w-10 h-10 text-muted-foreground/30" />
                <p className="text-muted-foreground text-sm">{isAuthenticated ? "No open positions yet" : "Sign in to view your positions"}</p>
                {!isAuthenticated && <a href={getLoginUrl()} className="text-primary text-sm hover:underline">Sign In</a>}
                {isAuthenticated && <Link href="/trade"><button className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg">Start Trading</button></Link>}
              </div>
            ) : (
          <div className="divide-y divide-border/50">
              {enriched.map((h: { symbol: string; qty: number; avgCost: number; currentPrice: number; pnl: number; pnlPct: number; realizedPnl: string; commodity?: { name: string; category: string } | null; unit: string }) => (
                <div key={h.symbol} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 items-center exchange-row">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xl flex-shrink-0">{h.commodity ? (CATEGORY_ICONS as Record<string, string>)[h.commodity.category] ?? "📦" : "📦"}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">{h.commodity?.name || h.symbol}</div>
                      <div className="text-xs text-muted-foreground font-mono">{h.symbol}</div>
                    </div>
                  </div>
                  <div className="text-sm font-mono text-foreground">{h.qty} {h.unit}</div>
                  <div className="text-sm font-mono text-muted-foreground">${h.avgCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                  <div className="text-sm font-mono text-foreground">${h.currentPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                  <div className={"text-sm font-mono font-semibold " + (h.pnl >= 0 ? "text-positive" : "text-negative")}>
                    {h.pnl >= 0 ? "+" : ""}${Math.abs(h.pnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    <div className="text-xs font-normal">{h.pnlPct >= 0 ? "+" : ""}{h.pnlPct.toFixed(2)}%</div>
                  </div>
                </div>
               ))}
            </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <div className="flex items-center gap-3 mb-3">
            <input
              type="text"
              placeholder="Filter by symbol..."
              value={historySymbol}
              onChange={e => { setHistorySymbol(e.target.value); setHistoryPage(1); }}
              className="px-3 py-1.5 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary w-48"
            />
          </div>
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="grid grid-cols-[auto_2fr_1fr_1fr_1fr_auto] gap-3 px-4 py-3 bg-secondary/50 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <span>Side</span><span>Commodity</span><span>Qty</span><span>Price</span><span>Total</span><span>Status</span>
            </div>
            {historyLoading ? (
              <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
            ) : tradeHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <p className="text-muted-foreground text-sm">{isAuthenticated ? "No trade history yet" : "Sign in to view your trade history"}</p>
              </div>
            ) : (
          <div className="divide-y divide-border/50">
              {(tradeHistory as Array<{ id: number; symbol: string; side: string; quantity: string; price: string; filledAt?: Date }>).map(t => {
                const commodity = COMMODITIES.find(c => c.symbol === t.symbol);
                const total = Number(t.quantity) * Number(t.price);
                return (
                  <div key={t.id} className="grid grid-cols-[auto_2fr_1fr_1fr_1fr_auto] gap-3 px-4 py-3 items-center exchange-row">
                    <Badge variant="outline" className={"text-[10px] " + (t.side === "BUY" ? "border-bid/30 text-bid" : "border-ask/30 text-ask")}>
                      {t.side}
                    </Badge>
                    <div>
                      <div className="text-sm font-medium text-foreground">{commodity?.name || t.symbol}</div>
                      <div className="text-xs text-muted-foreground">{t.filledAt ? new Date(t.filledAt).toLocaleDateString() : "—"} · #{t.id}</div>
                    </div>
                    <div className="text-sm font-mono text-foreground">{Number(t.quantity).toLocaleString()} MT</div>
                    <div className="text-sm font-mono text-foreground">${Number(t.price).toLocaleString()}</div>
                    <div className="text-sm font-mono text-foreground">${total.toLocaleString()}</div>
                    <Badge className="badge-settled text-[10px]">FILLED</Badge>
                  </div>
                );
              })}
            </div>
            )}
            {tradeHistory.length >= 20 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <button onClick={() => setHistoryPage(p => Math.max(1, p - 1))} disabled={historyPage === 1} className="px-3 py-1 text-xs bg-secondary rounded disabled:opacity-40">Prev</button>
                <span className="text-xs text-muted-foreground">Page {historyPage}</span>
                <button onClick={() => setHistoryPage(p => p + 1)} disabled={tradeHistory.length < 20} className="px-3 py-1 text-xs bg-secondary rounded disabled:opacity-40">Next</button>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <div className="space-y-4">
          {/* P&L Equity Curve */}
          <div className="rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />Portfolio Equity Curve
              </h3>
              <div className="flex gap-1">
                {[7, 30, 90].map(d => (
                  <button
                    key={d}
                    onClick={() => setHistoryDays(d)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      historyDays === d ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {d}D
                  </button>
                ))}
              </div>
            </div>
            {pnlHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                <BarChart3 className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-sm">No history yet — place your first trade to see the equity curve</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={pnlHistory} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} width={50} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 12 }}
                    formatter={((value: number) => [`$${value.toLocaleString()}`, "Portfolio Value"]) as any}
                    labelFormatter={label => `Date: ${label}`}
                  />
                  <ReferenceLine y={pnlHistory[0]?.totalCost ?? 0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="totalValue" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#pnlGradient)" dot={false} activeDot={{ r: 4, fill: "hsl(var(--primary))" }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Allocation */}
            <div className="rounded-xl border border-border p-4">
              <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />Portfolio Allocation
              </h3>
              <div className="space-y-3">
                {enriched.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-4">No positions to display</p>
              ) : enriched.map((h: { symbol: string; currentValue: number; commodity?: { name: string } | null }) => (
                  <div key={h.symbol}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-foreground">{h.commodity?.name?.split(" ")[0] || h.symbol}</span>
                      <span className="text-muted-foreground font-mono">{totalValue > 0 ? ((h.currentValue / totalValue) * 100).toFixed(1) : "0"}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${totalValue > 0 ? (h.currentValue / totalValue) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* P&L breakdown */}
            <div className="rounded-xl border border-border p-4">
              <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />P&amp;L Breakdown
              </h3>
              <div className="space-y-3">
                {enriched.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-4">No positions to display</p>
              ) : enriched.map((h: { symbol: string; pnl: number; pnlPct: number; commodity?: { name: string } | null }) => (
                  <div key={h.symbol} className="flex items-center justify-between">
                    <span className="text-sm text-foreground">{h.commodity?.name?.split(" ")[0] || h.symbol}</span>
                    <div className="text-right">
                      <div className={"text-sm font-mono font-semibold " + (h.pnl >= 0 ? "text-positive" : "text-negative")}>
                        {h.pnl >= 0 ? "+" : ""}${Math.abs(h.pnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                      <div className={"text-xs font-mono " + (h.pnlPct >= 0 ? "text-positive" : "text-negative")}>
                        {h.pnlPct >= 0 ? "+" : ""}{h.pnlPct.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
