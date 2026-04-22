/**
 * NEXCOM Exchange — Trader Open Orders
 * Displays all OPEN and PARTIALLY_FILLED orders for the authenticated trader.
 * Supports per-order cancellation and bulk cancel via trpc.trader.cancelOrder.
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { PageSkeleton } from "@/components/PageSkeleton";

const PAGE_SIZE = 50;

function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleString("en-NG", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-blue-900/50 text-blue-300 border-blue-600",
  PARTIALLY_FILLED: "bg-yellow-900/50 text-yellow-300 border-yellow-600",
};

export default function TraderOpenOrders() {
  const [, navigate] = useLocation();
  const [symbolFilter, setSymbolFilter] = useState("");
  const [assetFilter, setAssetFilter] = useState("ALL");
  const [offset, setOffset] = useState(0);
  const [cancelTarget, setCancelTarget] = useState<{ id: number; symbol: string } | null>(null);
  const [cancellingIds, setCancellingIds] = useState<Set<number>>(new Set());

  const utils = trpc.useUtils();

  const { data, isLoading, refetch, isRefetching } = trpc.trader.openOrders.useQuery({
    symbol: symbolFilter.trim() || undefined,
    assetClass: assetFilter as "COMMODITY" | "EQUITY" | "FOREX" | "DIGITAL_ASSET" | "INDEX" | "ALL",
    limit: PAGE_SIZE,
    offset,
  });

  const cancelMutation = trpc.trader.cancelOrder.useMutation({
    onMutate: ({ orderId }) => {
      setCancellingIds(prev => new Set(prev).add(orderId));
    },
    onSuccess: (_, { orderId }) => {
      setCancellingIds(prev => { const s = new Set(prev); s.delete(orderId); return s; });
      setCancelTarget(null);
      toast.success(`Order #${orderId} cancelled successfully.`);
      utils.trader.openOrders.invalidate();
      utils.trader.getTraderDashboard.invalidate();
    },
    onError: (err, { orderId }) => {
      setCancellingIds(prev => { const s = new Set(prev); s.delete(orderId); return s; });
      toast.error(`Cancel failed: ${err.message}`);
    },
  });

  const orders = data?.orders ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const partialCount = orders.filter(o => o.status === "PARTIALLY_FILLED").length;
  const totalNotional = orders.reduce((s, o) => s + (o.price ?? 0) * o.quantity, 0);

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
          <h1 className="text-base font-semibold text-white">Open Orders</h1>
          <p className="text-xs text-blue-400">Active & partially filled</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="p-1.5 rounded-lg hover:bg-blue-800 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 text-blue-300 ${isRefetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-5 space-y-5 pb-24">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: "Open Orders", value: total.toLocaleString(), icon: Clock, color: "text-blue-400" },
            { label: "Partial Fills", value: partialCount.toString(), icon: AlertTriangle, color: "text-yellow-400" },
            { label: "Total Notional", value: formatCurrency(totalNotional), icon: TrendingUp, color: "text-green-400" },
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
                  placeholder="Filter by symbol"
                  value={symbolFilter}
                  onChange={e => setSymbolFilter(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && setOffset(0)}
                  className="pl-9 bg-blue-800/50 border-blue-600 text-white placeholder:text-blue-500 focus:border-blue-400"
                />
              </div>
              <Select value={assetFilter} onValueChange={v => { setAssetFilter(v); setOffset(0); }}>
                <SelectTrigger className="w-full sm:w-44 bg-blue-800/50 border-blue-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-blue-900 border-blue-700">
                  {["ALL", "COMMODITY", "EQUITY", "FOREX", "DIGITAL_ASSET", "INDEX"].map(v => (
                    <SelectItem key={v} value={v} className="text-white hover:bg-blue-800">
                      {v === "ALL" ? "All Asset Classes" : v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="bg-blue-900/50 border-blue-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-blue-300 font-medium">
              {total > 0
                ? `Showing ${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total} orders`
                : "No open orders"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw className="w-6 h-6 text-blue-400 animate-spin" />
              </div>
            ) : orders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Clock className="w-10 h-10 text-blue-600" />
                <p className="text-blue-400 text-sm">No open orders</p>
                <Button
                  size="sm"
                  onClick={() => navigate("/trade")}
                  className="bg-blue-600 hover:bg-blue-500 text-white mt-2"
                >
                  Go to Trade
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-blue-700 hover:bg-transparent">
                      <TableHead className="text-blue-400 text-xs">Symbol</TableHead>
                      <TableHead className="text-blue-400 text-xs">Side</TableHead>
                      <TableHead className="text-blue-400 text-xs">Type</TableHead>
                      <TableHead className="text-blue-400 text-xs text-right">Qty</TableHead>
                      <TableHead className="text-blue-400 text-xs text-right">Price</TableHead>
                      <TableHead className="text-blue-400 text-xs text-right">Filled</TableHead>
                      <TableHead className="text-blue-400 text-xs">Status</TableHead>
                      <TableHead className="text-blue-400 text-xs">Placed</TableHead>
                      <TableHead className="text-blue-400 text-xs text-center">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map(order => (
                      <TableRow key={order.id} className="border-blue-800 hover:bg-blue-800/30">
                        <TableCell className="text-xs font-mono font-semibold text-white">
                          {order.symbol}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-xs px-1.5 py-0.5 ${
                              order.side === "BUY"
                                ? "bg-green-900/50 text-green-400 border-green-700"
                                : "bg-red-900/50 text-red-400 border-red-700"
                            }`}
                          >
                            {order.side === "BUY" ? (
                              <TrendingUp className="w-3 h-3 mr-1 inline" />
                            ) : (
                              <TrendingDown className="w-3 h-3 mr-1 inline" />
                            )}
                            {order.side}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-blue-300">{order.orderType}</TableCell>
                        <TableCell className="text-xs text-right text-white font-mono">
                          {order.quantity.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-xs text-right text-white font-mono">
                          {formatCurrency(order.price)}
                        </TableCell>
                        <TableCell className="text-xs text-right">
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-white font-mono">{order.filledQty.toLocaleString()}</span>
                            <div className="w-16 bg-blue-800 rounded-full h-1">
                              <div
                                className="bg-blue-400 h-1 rounded-full"
                                style={{ width: `${order.fillPct}%` }}
                              />
                            </div>
                            <span className="text-blue-500 text-[10px]">{order.fillPct}%</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-xs px-1.5 py-0.5 ${STATUS_COLORS[order.status] ?? "bg-gray-900/50 text-gray-400 border-gray-600"}`}
                          >
                            {order.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-blue-400 whitespace-nowrap">
                          {formatDate(order.createdAt)}
                        </TableCell>
                        <TableCell className="text-center">
                          <button
                            onClick={() => setCancelTarget({ id: order.id, symbol: order.symbol })}
                            disabled={cancellingIds.has(order.id)}
                            className="p-1.5 rounded hover:bg-red-900/40 text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
                            title="Cancel order"
                          >
                            {cancellingIds.has(order.id) ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <X className="w-3.5 h-3.5" />
                            )}
                          </button>
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

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={!!cancelTarget} onOpenChange={open => !open && setCancelTarget(null)}>
        <AlertDialogContent className="bg-blue-950 border-red-800 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-400">Cancel Order</AlertDialogTitle>
            <AlertDialogDescription className="text-blue-300">
              Are you sure you want to cancel order #{cancelTarget?.id} for{" "}
              <span className="font-semibold text-white">{cancelTarget?.symbol}</span>?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-blue-700 text-blue-300 hover:bg-blue-800">
              Keep Order
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancelTarget && cancelMutation.mutate({ orderId: cancelTarget.id })}
              className="bg-red-700 hover:bg-red-600 text-white"
            >
              Cancel Order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-blue-950 border-t border-blue-800 flex">
        {[
          { label: "Dashboard", path: "/trader-dashboard" },
          { label: "History", path: "/trader/trade-history" },
          { label: "Orders", path: "/trader/open-orders", active: true },
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
