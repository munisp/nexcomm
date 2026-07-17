/**
 * NEXCOM Exchange — Trader P&L Summary
 * Displays realized P&L per symbol, total realized P&L, daily net-flow chart,
 * and fee summary. Data sourced from positions and trade_fills via
 * trpc.trader.pnlSummary.
 */
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  BarChart3,
  DollarSign,
  Minus,
  FileDown,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function PnlBadge({ value }: { value: number }) {
  if (value > 0) return (
    <span className="flex items-center gap-1 text-green-400 font-mono text-sm font-semibold">
      <TrendingUp className="w-3.5 h-3.5" />
      +{formatCurrency(value)}
    </span>
  );
  if (value < 0) return (
    <span className="flex items-center gap-1 text-red-400 font-mono text-sm font-semibold">
      <TrendingDown className="w-3.5 h-3.5" />
      {formatCurrency(value)}
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-blue-400 font-mono text-sm">
      <Minus className="w-3.5 h-3.5" />
      {formatCurrency(0)}
    </span>
  );
}

const PERIOD_OPTIONS = [
  { label: "7 Days", value: 7 },
  { label: "30 Days", value: 30 },
  { label: "90 Days", value: 90 },
  { label: "1 Year", value: 365 },
];

interface LivePositionUpdate {
  symbol: string;
  positions: Array<{
    id: number;
    symbol: string;
    quantity: number;
    averageCost: number;
    currentPrice: number;
    unrealizedPnl: number;
    realizedPnl: number;
    side: string;
  }>;
  totalUnrealizedPnl: number;
  totalRealizedPnl: number;
  timestamp: string;
}

export default function TraderPnL() {
  const [, navigate] = useLocation();
  const [days, setDays] = useState(30);
  const { user } = useAuth();

  // Real-time unrealized P&L from WebSocket
  const [liveUnrealizedPnl, setLiveUnrealizedPnl] = useState<number | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [recentFills, setRecentFills] = useState<Array<{ id: number; symbol: string; side: string; quantity: string; price: string; createdAt: Date | null }>>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // Subscribe to real-time position updates via the order book WS
  useEffect(() => {
    if (!user?.id) return;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/orderbook`);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      ws.send(JSON.stringify({ type: "subscribe_positions", userId: user.id }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "position_update") {
          const update = msg as LivePositionUpdate;
          setLiveUnrealizedPnl(update.totalUnrealizedPnl);
        } else if (msg.type === "fill_event" && Array.isArray(msg.fills)) {
          setRecentFills(prev => [...msg.fills, ...prev].slice(0, 5));
          // Invalidate the tRPC query so the realized P&L table refreshes
          refetch();
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [user?.id]);

  const { data, isLoading, refetch, isRefetching } = trpc.trader.pnlSummary.useQuery({ days });

  const pnl = data?.totalRealizedPnl ?? 0;
  const fees = data?.totalFees ?? 0;
  const buyVol = data?.totalBuyVolume ?? 0;
  const sellVol = data?.totalSellVolume ?? 0;
  const positions = data?.positions ?? [];
  const dailyPnl = data?.dailyPnl ?? [];

  // Recharts data: reverse to show oldest first
  const chartData = [...dailyPnl].reverse().map(d => ({
    day: d.day.slice(5), // "MM-DD"
    net: d.netFlow,
    fees: d.fees,
    trades: d.tradeCount,
  }));

  if (isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-950 via-blue-900 to-indigo-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-blue-950/90 backdrop-blur border-b border-blue-800 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate("/trader-dashboard")}
          className="p-1.5 rounded-lg hover:bg-blue-800 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-blue-300" />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-semibold text-white">P&L Summary</h1>
          <p className="text-xs text-blue-400 flex items-center gap-1">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${wsConnected ? "bg-green-400" : "bg-blue-600"}`} />
            {wsConnected ? "Live" : "Polling"}
          </p>
        </div>
        <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
          <SelectTrigger className="w-28 bg-blue-800/50 border-blue-600 text-white text-xs h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-blue-900 border-blue-700">
            {PERIOD_OPTIONS.map(o => (
              <SelectItem key={o.value} value={String(o.value)} className="text-white hover:bg-blue-800 text-xs">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="p-1.5 rounded-lg hover:bg-blue-800 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 text-blue-300 ${isRefetching ? "animate-spin" : ""}`} />
        </button>
        {/* CSV Export */}
        <button
          disabled={!data}
          onClick={() => {
            const rows = (data?.positions ?? []).map(p => [
              p.symbol, p.assetClass, p.quantity, p.avgCost, p.realizedPnl,
              p.updatedAt ? new Date(p.updatedAt).toISOString() : "",
            ]);
            const csv = [
              ["Symbol","Asset Class","Quantity","Avg Cost","Realized PnL","Updated At"].join(","),
              ...rows.map(r => r.map(v => `"${v}"`).join(",")),
            ].join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = `pnl-${days}d-${new Date().toISOString().slice(0,10)}.csv`; a.click();
            URL.revokeObjectURL(url);
            toast.success(`Exported ${rows.length} positions to CSV`);
          }}
          className="p-1.5 rounded-lg hover:bg-blue-800 transition-colors disabled:opacity-40"
          title="Export CSV"
        >
          <FileDown className="w-4 h-4 text-blue-300" />
        </button>
        {/* PDF Export */}
        <button
          disabled={!data}
          onClick={async () => {
            const { jsPDF } = await import("jspdf");
            const autoTable = (await import("jspdf-autotable")).default;
            const doc = new jsPDF();
            doc.setFontSize(14);
            doc.text(`NEXCOM Exchange — P&L Report (${days} Days)`, 14, 18);
            doc.setFontSize(9);
            doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 26);
            doc.text(`Realized P&L: ${formatCurrency(data?.totalRealizedPnl ?? 0)}  |  Fees: ${formatCurrency(data?.totalFees ?? 0)}`, 14, 32);
            autoTable(doc, {
              startY: 38,
              head: [["Symbol","Asset Class","Qty","Avg Cost","Realized P&L"]],
              body: (data?.positions ?? []).map(p => [
                p.symbol, p.assetClass, p.quantity, formatCurrency(p.avgCost), formatCurrency(p.realizedPnl),
              ]),
              styles: { fontSize: 8 },
              headStyles: { fillColor: [30, 58, 138] },
            });
            doc.save(`pnl-${days}d-${new Date().toISOString().slice(0,10)}.pdf`);
            toast.success("P&L report exported as PDF");
          }}
          className="p-1.5 rounded-lg hover:bg-blue-800 transition-colors disabled:opacity-40"
          title="Export PDF"
        >
          <FileText className="w-4 h-4 text-blue-300" />
        </button>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-5 space-y-5 pb-24">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <RefreshCw className="w-7 h-7 text-blue-400 animate-spin" />
          </div>
        ) : (
          <>
            {/* Live Unrealized P&L Banner — only shown when WS is connected */}
            {wsConnected && liveUnrealizedPnl !== null && (
              <div className={`rounded-lg px-4 py-2.5 flex items-center justify-between border ${
                liveUnrealizedPnl >= 0
                  ? "bg-green-900/30 border-green-700"
                  : "bg-red-900/30 border-red-700"
              }`}>
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-xs text-blue-300">Live Unrealized P&L</span>
                </div>
                <PnlBadge value={liveUnrealizedPnl} />
              </div>
            )}

            {/* Recent Fills Toast — shown when new fills arrive */}
            {recentFills.length > 0 && (
              <div className="rounded-lg bg-blue-900/60 border border-blue-700 px-4 py-2.5">
                <p className="text-xs text-blue-400 mb-2 font-medium">Recent Fills (Live)</p>
                <div className="space-y-1">
                  {recentFills.map((fill) => (
                    <div key={fill.id} className="flex items-center justify-between text-xs">
                      <span className="font-mono text-white">{fill.symbol}</span>
                      <span className={fill.side === "BUY" ? "text-green-400" : "text-red-400"}>{fill.side}</span>
                      <span className="text-blue-300 font-mono">{fill.quantity} @ {fill.price}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {
                  label: "Realized P&L",
                  value: <PnlBadge value={pnl} />,
                  icon: DollarSign,
                  color: pnl >= 0 ? "text-green-400" : "text-red-400",
                },
                {
                  label: "Total Fees Paid",
                  value: <span className="text-yellow-400 font-mono text-sm font-semibold">{formatCurrency(fees)}</span>,
                  icon: BarChart3,
                  color: "text-yellow-400",
                },
                {
                  label: `Buy Volume (${days}d)`,
                  value: <span className="text-blue-300 font-mono text-sm">{formatCurrency(buyVol)}</span>,
                  icon: TrendingUp,
                  color: "text-blue-400",
                },
                {
                  label: `Sell Volume (${days}d)`,
                  value: <span className="text-blue-300 font-mono text-sm">{formatCurrency(sellVol)}</span>,
                  icon: TrendingDown,
                  color: "text-blue-400",
                },
              ].map(({ label, value, icon: Icon, color }) => (
                <Card key={label} className="bg-blue-900/50 border-blue-700">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className={`w-4 h-4 ${color}`} />
                      <span className="text-xs text-blue-400">{label}</span>
                    </div>
                    {value}
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Daily Net Flow Chart */}
            {chartData.length > 0 && (
              <Card className="bg-blue-900/50 border-blue-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-blue-300 font-medium">
                    Daily Net Flow — Last {days} Days
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div style={{ height: 200 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <XAxis
                          dataKey="day"
                          tick={{ fill: "#93c5fd", fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          tick={{ fill: "#93c5fd", fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={v => `₦${(v / 1000).toFixed(0)}k`}
                          width={52}
                        />
                        <Tooltip
                          contentStyle={{ background: "#1e3a5f", border: "1px solid #1e40af", borderRadius: 6 }}
                          labelStyle={{ color: "#93c5fd", fontSize: 11 }}
                          formatter={((value: number) => [formatCurrency(value), "Net Flow"]) as any}
                        />
                        <ReferenceLine y={0} stroke="#3b82f6" strokeDasharray="3 3" />
                        <Bar dataKey="net" radius={[3, 3, 0, 0]}>
                          {chartData.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={entry.net >= 0 ? "#22c55e" : "#ef4444"}
                              fillOpacity={0.8}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Per-Symbol Positions */}
            <Card className="bg-blue-900/50 border-blue-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-blue-300 font-medium">
                  Positions & Realized P&L by Symbol
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {positions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <BarChart3 className="w-10 h-10 text-blue-600" />
                    <p className="text-blue-400 text-sm">No positions yet</p>
                    <Button
                      size="sm"
                      onClick={() => navigate("/trade")}
                      className="bg-blue-600 hover:bg-blue-500 text-white mt-1"
                    >
                      Start Trading
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-blue-700 hover:bg-transparent">
                          <TableHead className="text-blue-400 text-xs">Symbol</TableHead>
                          <TableHead className="text-blue-400 text-xs">Asset Class</TableHead>
                          <TableHead className="text-blue-400 text-xs text-right">Qty Held</TableHead>
                          <TableHead className="text-blue-400 text-xs text-right">Avg Cost</TableHead>
                          <TableHead className="text-blue-400 text-xs text-right">Realized P&L</TableHead>
                          <TableHead className="text-blue-400 text-xs">Last Updated</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {positions.map(pos => (
                          <TableRow key={pos.symbol} className="border-blue-800 hover:bg-blue-800/30">
                            <TableCell className="text-xs font-mono font-semibold text-white">
                              {pos.symbol}
                            </TableCell>
                            <TableCell className="text-xs text-blue-300">{pos.assetClass}</TableCell>
                            <TableCell className="text-xs text-right text-white font-mono">
                              {pos.quantity.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-xs text-right text-white font-mono">
                              {formatCurrency(pos.avgCost)}
                            </TableCell>
                            <TableCell className="text-xs text-right">
                              <PnlBadge value={pos.realizedPnl} />
                            </TableCell>
                            <TableCell className="text-xs text-blue-400 whitespace-nowrap">
                              {new Date(pos.updatedAt).toLocaleDateString("en-NG", {
                                month: "short",
                                day: "2-digit",
                              })}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Daily Breakdown Table */}
            {dailyPnl.length > 0 && (
              <Card className="bg-blue-900/50 border-blue-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-blue-300 font-medium">
                    Daily Activity Breakdown
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-blue-700 hover:bg-transparent">
                          <TableHead className="text-blue-400 text-xs">Date</TableHead>
                          <TableHead className="text-blue-400 text-xs text-right">Trades</TableHead>
                          <TableHead className="text-blue-400 text-xs text-right">Buy Vol</TableHead>
                          <TableHead className="text-blue-400 text-xs text-right">Sell Vol</TableHead>
                          <TableHead className="text-blue-400 text-xs text-right">Net Flow</TableHead>
                          <TableHead className="text-blue-400 text-xs text-right">Fees</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dailyPnl.map(row => (
                          <TableRow key={row.day} className="border-blue-800 hover:bg-blue-800/30">
                            <TableCell className="text-xs text-blue-300 font-mono">{row.day}</TableCell>
                            <TableCell className="text-xs text-right text-white">{row.tradeCount}</TableCell>
                            <TableCell className="text-xs text-right text-blue-300 font-mono">
                              {formatCurrency(row.buyVolume)}
                            </TableCell>
                            <TableCell className="text-xs text-right text-blue-300 font-mono">
                              {formatCurrency(row.sellVolume)}
                            </TableCell>
                            <TableCell className="text-xs text-right">
                              <span className={`font-mono ${row.netFlow >= 0 ? "text-green-400" : "text-red-400"}`}>
                                {row.netFlow >= 0 ? "+" : ""}{formatCurrency(row.netFlow)}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs text-right text-yellow-400 font-mono">
                              {formatCurrency(row.fees)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-blue-950 border-t border-blue-800 flex">
        {[
          { label: "Dashboard", path: "/trader-dashboard" },
          { label: "History", path: "/trader/trade-history" },
          { label: "Orders", path: "/trader/open-orders" },
          { label: "P&L", path: "/trader/pnl", active: true },
        ].map(({ label, path, active }) => (
          <button
            key={label}
            onClick={() => navigate(path)}
            className={`flex-1 py-3 text-xs transition-colors ${
              active ? "text-blue-400 font-semibold" : "text-blue-600 hover:text-blue-400"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
