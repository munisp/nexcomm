/**
 * NEXCOM Exchange — Price Feed Admin Panel
 * Shows live prices for all 12 commodity symbols, last fetch time, source, and force-refresh button.
 */
import { useState } from "react";
import {
  RefreshCw, Loader2, TrendingUp, TrendingDown, Minus,
  CheckCircle2, AlertCircle, Clock, Wifi, WifiOff, Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { PageSkeleton } from "@/components/PageSkeleton";

export default function PriceFeedAdmin() {
  const utils = trpc.useUtils();

  const pricesQuery = trpc.livePrices.getAll.useQuery(undefined, {
    refetchInterval: 30_000, // auto-refresh every 30s
  });

  const refreshMutation = trpc.livePrices.triggerRefresh.useMutation({
    onSuccess: (data) => {
      toast.success(`Price feed refreshed — ${data.updated} live, ${data.fallback} fallback`);
      utils.livePrices.getAll.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const prices = pricesQuery.data?.prices ?? [];
  const liveCount = prices.filter(p => p.source === "yahoo").length;
  const fallbackCount = prices.filter(p => p.source !== "yahoo").length;

  const lastFetch = prices.length > 0
    ? Math.max(...prices.map(p => new Date(p.updatedAt).getTime()))
    : null;

  function formatAge(ts: number) {
    const seconds = Math.floor((Date.now() - ts) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  }

  function changePctColor(pct: string | null) {
    if (!pct) return "text-muted-foreground";
    const v = parseFloat(pct);
    if (v > 0) return "text-emerald-400";
    if (v < 0) return "text-red-400";
    return "text-muted-foreground";
  }

  function ChangePctIcon({ pct }: { pct: string | null }) {
    if (!pct) return <Minus className="w-3 h-3" />;
    const v = parseFloat(pct);
    if (v > 0) return <TrendingUp className="w-3 h-3" />;
    if (v < 0) return <TrendingDown className="w-3 h-3" />;
    return <Minus className="w-3 h-3" />;
  }

  if (pricesQuery.isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={5} />;
  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Activity className="w-6 h-6 text-primary" />
            Price Feed Admin
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live commodity prices from Yahoo Finance — refreshes every 5 minutes
          </p>
        </div>
        <Button
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          className="gap-2"
        >
          {refreshMutation.isPending
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <RefreshCw className="w-4 h-4" />}
          Force Refresh
        </Button>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Wifi className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Live Prices</p>
                <p className="text-xl font-bold text-emerald-400">{liveCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                <WifiOff className="w-4 h-4 text-yellow-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Fallback</p>
                <p className="text-xl font-bold text-yellow-400">{fallbackCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Clock className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Last Fetch</p>
                <p className="text-sm font-semibold text-foreground">
                  {lastFetch ? formatAge(lastFetch) : "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${pricesQuery.isLoading ? "bg-muted/30" : pricesQuery.isError ? "bg-red-500/10" : "bg-emerald-500/10"}`}>
                {pricesQuery.isLoading
                  ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  : pricesQuery.isError
                    ? <AlertCircle className="w-4 h-4 text-red-400" />
                    : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Feed Status</p>
                <p className={`text-sm font-semibold ${pricesQuery.isError ? "text-red-400" : "text-emerald-400"}`}>
                  {pricesQuery.isLoading ? "Loading..." : pricesQuery.isError ? "Error" : "Operational"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Prices Table */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-foreground">Current Prices</CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            {prices.length} symbols tracked · Auto-refreshes every 30s
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {pricesQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : prices.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No price data yet. Click Force Refresh to fetch prices.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground text-xs">Symbol</TableHead>
                    <TableHead className="text-muted-foreground text-xs">Name</TableHead>
                    <TableHead className="text-muted-foreground text-xs">Asset Class</TableHead>
                    <TableHead className="text-muted-foreground text-xs text-right">Price</TableHead>
                    <TableHead className="text-muted-foreground text-xs text-right">Change</TableHead>
                    <TableHead className="text-muted-foreground text-xs text-right">Change %</TableHead>
                    <TableHead className="text-muted-foreground text-xs text-right">High</TableHead>
                    <TableHead className="text-muted-foreground text-xs text-right">Low</TableHead>
                    <TableHead className="text-muted-foreground text-xs">Source</TableHead>
                    <TableHead className="text-muted-foreground text-xs">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {prices.map(p => (
                    <TableRow key={p.id} className="border-border hover:bg-muted/30">
                      <TableCell className="text-sm font-mono font-semibold text-foreground">{p.symbol}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs border-border text-muted-foreground">
                          {p.assetClass}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-right font-semibold text-foreground">
                        {p.currency} {parseFloat(p.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                      </TableCell>
                      <TableCell className={`text-sm text-right ${changePctColor(p.changePct)}`}>
                        {p.change
                          ? (parseFloat(p.change) >= 0 ? "+" : "") + parseFloat(p.change).toFixed(4)
                          : "—"}
                      </TableCell>
                      <TableCell className={`text-sm text-right ${changePctColor(p.changePct)}`}>
                        <div className="flex items-center justify-end gap-1">
                          <ChangePctIcon pct={p.changePct} />
                          {p.changePct
                            ? (parseFloat(p.changePct) >= 0 ? "+" : "") + parseFloat(p.changePct).toFixed(2) + "%"
                            : "—"}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-right text-muted-foreground">
                        {p.high ? parseFloat(p.high).toFixed(4) : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-right text-muted-foreground">
                        {p.low ? parseFloat(p.low).toFixed(4) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={p.source === "yahoo"
                            ? "border-emerald-500/30 text-emerald-400 text-xs"
                            : "border-yellow-500/30 text-yellow-400 text-xs"}
                        >
                          {p.source === "yahoo" ? "Yahoo Finance" : "Fallback"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatAge(new Date(p.updatedAt).getTime())}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
