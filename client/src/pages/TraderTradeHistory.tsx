/**
 * NEXCOM Exchange — Trader Trade History
 * Displays paginated, filterable list of all filled trade executions for the
 * authenticated trader. Data is sourced from the trade_fills table via
 * trpc.trader.tradeHistory.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  Download,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  BarChart3,
} from "lucide-react";

const PAGE_SIZE = 50;

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleString("en-NG", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TraderTradeHistory() {
  const [, navigate] = useLocation();
  const [symbolFilter, setSymbolFilter] = useState("");
  const [sideFilter, setSideFilter] = useState<"BUY" | "SELL" | "ALL">("ALL");
  const [offset, setOffset] = useState(0);

  const { data, isLoading, refetch, isRefetching } = trpc.trader.tradeHistory.useQuery({
    symbol: symbolFilter.trim() || undefined,
    side: sideFilter,
    limit: PAGE_SIZE,
    offset,
  });

  const fills = data?.fills ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  // Summary stats from current page
  const buyCount = fills.filter(f => f.side === "BUY").length;
  const sellCount = fills.filter(f => f.side === "SELL").length;
  const totalGross = fills.reduce((s, f) => s + f.grossValue, 0);
  const totalFees = fills.reduce((s, f) => s + f.fee, 0);

  function handleSearch() {
    setOffset(0);
  }

  function handleExport() {
    if (!fills.length) return;
    const headers = ["Date", "Symbol", "Side", "Qty", "Fill Price", "Gross Value", "Fee", "Fill ID"];
    const rows = fills.map(f => [
      formatDate(f.createdAt),
      f.symbol,
      f.side,
      f.filledQty.toString(),
      f.fillPrice.toString(),
      f.grossValue.toString(),
      f.fee.toString(),
      f.id.toString(),
    ]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nexcom-trade-history-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
          <h1 className="text-base font-semibold text-white">Trade History</h1>
          <p className="text-xs text-blue-400">All filled executions</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="p-1.5 rounded-lg hover:bg-blue-800 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 text-blue-300 ${isRefetching ? "animate-spin" : ""}`} />
        </button>
        <button
          onClick={handleExport}
          disabled={!fills.length}
          className="p-1.5 rounded-lg hover:bg-blue-800 transition-colors disabled:opacity-40"
        >
          <Download className="w-4 h-4 text-blue-300" />
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-5 space-y-5 pb-24">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Fills", value: total.toLocaleString(), icon: BarChart3, color: "text-blue-400" },
            { label: "Buy Fills", value: buyCount.toString(), icon: TrendingUp, color: "text-green-400" },
            { label: "Sell Fills", value: sellCount.toString(), icon: TrendingDown, color: "text-red-400" },
            { label: "Total Fees", value: formatCurrency(totalFees), icon: BarChart3, color: "text-yellow-400" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="bg-blue-900/50 border-blue-700">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`w-4 h-4 ${color}`} />
                  <span className="text-xs text-blue-400">{label}</span>
                </div>
                <p className="text-base font-bold text-white">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card className="bg-blue-900/50 border-blue-700">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
                <Input
                  placeholder="Filter by symbol (e.g. MAIZE-NGN)"
                  value={symbolFilter}
                  onChange={e => setSymbolFilter(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSearch()}
                  className="pl-9 bg-blue-800/50 border-blue-600 text-white placeholder:text-blue-500 focus:border-blue-400"
                />
              </div>
              <Select value={sideFilter} onValueChange={v => { setSideFilter(v as "BUY" | "SELL" | "ALL"); setOffset(0); }}>
                <SelectTrigger className="w-full sm:w-36 bg-blue-800/50 border-blue-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-blue-900 border-blue-700">
                  <SelectItem value="ALL" className="text-white hover:bg-blue-800">All Sides</SelectItem>
                  <SelectItem value="BUY" className="text-green-400 hover:bg-blue-800">Buy Only</SelectItem>
                  <SelectItem value="SELL" className="text-red-400 hover:bg-blue-800">Sell Only</SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={handleSearch}
                className="bg-blue-600 hover:bg-blue-500 text-white"
              >
                Search
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="bg-blue-900/50 border-blue-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-blue-300 font-medium">
              {total > 0 ? `Showing ${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total} fills` : "No fills found"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw className="w-6 h-6 text-blue-400 animate-spin" />
              </div>
            ) : fills.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <BarChart3 className="w-10 h-10 text-blue-600" />
                <p className="text-blue-400 text-sm">No trade fills found</p>
                <p className="text-blue-600 text-xs">Execute trades on the Trade page to see history here</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-blue-700 hover:bg-transparent">
                      <TableHead className="text-blue-400 text-xs">Date</TableHead>
                      <TableHead className="text-blue-400 text-xs">Symbol</TableHead>
                      <TableHead className="text-blue-400 text-xs">Side</TableHead>
                      <TableHead className="text-blue-400 text-xs text-right">Qty</TableHead>
                      <TableHead className="text-blue-400 text-xs text-right">Fill Price</TableHead>
                      <TableHead className="text-blue-400 text-xs text-right">Gross Value</TableHead>
                      <TableHead className="text-blue-400 text-xs text-right">Fee</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fills.map(fill => (
                      <TableRow key={fill.id} className="border-blue-800 hover:bg-blue-800/30">
                        <TableCell className="text-xs text-blue-300 whitespace-nowrap">
                          {formatDate(fill.createdAt)}
                        </TableCell>
                        <TableCell className="text-xs font-mono font-semibold text-white">
                          {fill.symbol}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={`text-xs px-2 py-0.5 ${
                              fill.side === "BUY"
                                ? "bg-green-900/50 text-green-400 border-green-700"
                                : "bg-red-900/50 text-red-400 border-red-700"
                            }`}
                            variant="outline"
                          >
                            {fill.side === "BUY" ? (
                              <TrendingUp className="w-3 h-3 mr-1 inline" />
                            ) : (
                              <TrendingDown className="w-3 h-3 mr-1 inline" />
                            )}
                            {fill.side}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-right text-white font-mono">
                          {fill.filledQty.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-xs text-right text-white font-mono">
                          {formatCurrency(fill.fillPrice)}
                        </TableCell>
                        <TableCell className="text-xs text-right text-white font-mono">
                          {formatCurrency(fill.grossValue)}
                        </TableCell>
                        <TableCell className="text-xs text-right text-yellow-400 font-mono">
                          {formatCurrency(fill.fee)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="border-blue-700 text-blue-300 hover:bg-blue-800"
            >
              <ChevronLeft className="w-4 h-4 mr-1" /> Previous
            </Button>
            <span className="text-xs text-blue-400">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total}
              className="border-blue-700 text-blue-300 hover:bg-blue-800"
            >
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}
      </div>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-blue-950 border-t border-blue-800 flex">
        {[
          { label: "Dashboard", path: "/trader-dashboard" },
          { label: "History", path: "/trader/trade-history", active: true },
          { label: "Orders", path: "/trader/open-orders" },
          { label: "P&L", path: "/trader/pnl" },
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
