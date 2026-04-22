import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  BarChart2,
  Download,
  RefreshCw,
  Activity,
  Target,
} from "lucide-react";
import { toast } from "sonner";
import { PageSkeleton } from "@/components/PageSkeleton";

function fmt(v: number, decimals = 2): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: decimals,
  }).format(v);
}

function pnlColor(v: number): string {
  if (v > 0) return "text-emerald-400";
  if (v < 0) return "text-red-400";
  return "text-slate-400";
}

export default function PortfolioAnalytics() {
  const { user } = useAuth();
  const [days, setDays] = useState(30);
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));

  const summaryQ = trpc.portfolioAnalytics.getPortfolioSummary.useQuery();
  const statsQ = trpc.portfolioAnalytics.getPortfolioStats.useQuery();
  const curveQ = trpc.portfolioAnalytics.getEquityCurve.useQuery({ days });
  const statementQ = trpc.portfolioAnalytics.generateStatement.useQuery(
    { format: "CSV", days: 30 },
    { enabled: false }
  );

  const recordSnapshotMut = trpc.portfolioAnalytics.recordEquitySnapshot.useMutation({
    onSuccess: () => {
      toast.success("Equity snapshot recorded");
      curveQ.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const summary = summaryQ.data;
  const stats = statsQ.data;
  const curve = curveQ.data ?? [];

  function downloadCSV() {
    statementQ.refetch().then((result) => {
      if (!result.data) return;
      const blob = new Blob([result.data.data], { type: result.data.contentType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nexcom-statement-${fromDate}-to-${toDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${result.data.rowCount} rows`);
    });
  }

  const chartData = curve.map((s) => ({
    date: new Date(s.date).toLocaleDateString("en-NG", { month: "short", day: "numeric" }),
    "Total Equity": s.totalEquity,
    "Spot P&L": s.spotPnl,
    "Futures P&L": s.futuresPnl,
    "Options P&L": s.optionsPnl,
    "Cash Balance": s.cashBalance,
  }));

  if (summaryQ.isLoading) return <PageSkeleton cards={4} tableRows={6} tableCols={4} showChart />;
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Portfolio Analytics</h1>
            <p className="text-slate-400 text-sm mt-1">
              Combined P&amp;L across spot, futures, and options
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => recordSnapshotMut.mutate()}
            disabled={recordSnapshotMut.isPending}
            className="border-slate-600 text-slate-300 hover:bg-slate-700"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${recordSnapshotMut.isPending ? "animate-spin" : ""}`} />
            Snapshot Now
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-4 h-4 text-blue-400" />
                <span className="text-slate-400 text-xs">Total Equity</span>
              </div>
              <p className="text-xl font-bold text-white">
                {summaryQ.isLoading ? "..." : fmt(summary?.totalEquity ?? 0)}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-purple-400" />
                <span className="text-slate-400 text-xs">Cash Balance</span>
              </div>
              <p className="text-xl font-bold text-white">
                {summaryQ.isLoading ? "..." : fmt(summary?.cashBalance ?? 0)}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <span className="text-slate-400 text-xs">Futures P&L</span>
              </div>
              <p className={`text-xl font-bold ${pnlColor((summary?.futuresUnrealizedPnl ?? 0) + (summary?.futuresRealizedPnl ?? 0))}`}>
                {summaryQ.isLoading ? "..." : fmt((summary?.futuresUnrealizedPnl ?? 0) + (summary?.futuresRealizedPnl ?? 0))}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-4 h-4 text-amber-400" />
                <span className="text-slate-400 text-xs">Options P&L</span>
              </div>
              <p className={`text-xl font-bold ${pnlColor(summary?.optionsPnl ?? 0)}`}>
                {summaryQ.isLoading ? "..." : fmt(summary?.optionsPnl ?? 0)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Stats Row */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-white">{stats.totalFilledOrders}</p>
                <p className="text-slate-400 text-xs mt-1">Filled Orders</p>
              </CardContent>
            </Card>
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-white">{stats.openFuturesCount}</p>
                <p className="text-slate-400 text-xs mt-1">Open Futures</p>
              </CardContent>
            </Card>
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-white">{stats.openOptionsCount}</p>
                <p className="text-slate-400 text-xs mt-1">Open Options</p>
              </CardContent>
            </Card>
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-4 text-center">
                <p className={`text-2xl font-bold ${parseFloat(stats.winRate) >= 50 ? "text-emerald-400" : "text-red-400"}`}>
                  {stats.winRate}%
                </p>
                <p className="text-slate-400 text-xs mt-1">Win Rate (Futures)</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Equity Curve Chart */}
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-blue-400" />
              Equity Curve
            </CardTitle>
            <div className="flex gap-2">
              {[7, 30, 90, 180].map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={days === d ? "default" : "outline"}
                  className={days === d ? "bg-blue-600" : "border-slate-600 text-slate-400 hover:bg-slate-700"}
                  onClick={() => setDays(d)}
                >
                  {d}d
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {curveQ.isLoading ? (
              <div className="h-64 flex items-center justify-center text-slate-400">Loading chart...</div>
            ) : chartData.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-2">
                <BarChart2 className="w-8 h-8 opacity-40" />
                <p className="text-sm">No equity snapshots yet. Click "Snapshot Now" to record your first data point.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 11 }} tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
                    labelStyle={{ color: "#94a3b8" }}
                    formatter={(v: number) => fmt(v)}
                  />
                  <Legend />
                  <Area type="monotone" dataKey="Total Equity" stroke="#3b82f6" fill="url(#equityGrad)" strokeWidth={2} />
                  <Line type="monotone" dataKey="Futures P&L" stroke="#10b981" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="Options P&L" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="Spot P&L" stroke="#8b5cf6" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Statement Download */}
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-base flex items-center gap-2">
              <Download className="w-4 h-4 text-green-400" />
              Download Statement (CSV)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1">
                <Label className="text-slate-400 text-xs">From Date</Label>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="bg-slate-700 border-slate-600 text-white w-40"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-slate-400 text-xs">To Date</Label>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="bg-slate-700 border-slate-600 text-white w-40"
                />
              </div>
              <Button
                onClick={downloadCSV}
                disabled={statementQ.isFetching}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <Download className="w-4 h-4 mr-2" />
                {statementQ.isFetching ? "Generating..." : "Download CSV"}
              </Button>
            </div>
            <p className="text-slate-500 text-xs mt-3">
              Includes all filled spot orders, futures positions, and options trades in the selected date range.
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
