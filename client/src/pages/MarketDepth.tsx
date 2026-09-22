/**
 * MarketDepth (INNOV-C) — per-commodity live market depth page.
 *
 * Route (register in client/src/App.tsx — see INNOV-C/MANIFEST.md):
 *   import MarketDepth from "@/pages/MarketDepth";
 *   <Route path="/market-depth" component={MarketDepth} />
 *   <Route path="/market-depth/:symbol" component={MarketDepth} />
 *
 * All data comes from trpc.marketStream.* (real order_book_levels / orders /
 * trade_fills / live_prices tables) — no mock or simulated market data.
 * Empty books render honest empty states. Polls at 5s.
 */
import { useMemo, useState } from "react";
import { useParams } from "wouter";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { COMMODITIES } from "../../../shared/commodities";
import { OrderBookDepth } from "@/components/OrderBookDepth";
import { DepthChart } from "@/components/DepthChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function fmt(n: number | null | undefined, dp = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export default function MarketDepth() {
  const params = useParams<{ symbol?: string }>();
  const initial = params.symbol?.toUpperCase();
  const [symbol, setSymbol] = useState<string>(
    initial && COMMODITIES.some((c) => c.symbol === initial) ? initial : COMMODITIES[0].symbol
  );

  const tickerQ = trpc.marketStream.tickerSnapshot.useQuery(
    { symbol },
    { refetchInterval: 5000, staleTime: 2000 }
  );
  const tradesQ = trpc.marketStream.recentTrades.useQuery(
    { symbol, limit: 25 },
    { refetchInterval: 5000, staleTime: 2000 }
  );

  const ticker = tickerQ.data?.tickers.find((t) => t.symbol === symbol) ?? null;
  const commodity = useMemo(() => COMMODITIES.find((c) => c.symbol === symbol), [symbol]);
  const trades = tradesQ.data?.trades ?? [];

  const change = ticker?.changePct24h ?? null;
  const changeTone =
    change == null
      ? "text-muted-foreground"
      : change > 0
        ? "text-emerald-600/90 dark:text-emerald-400/80"
        : change < 0
          ? "text-rose-600/90 dark:text-rose-400/80"
          : "text-muted-foreground";

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      {/* Header: symbol selector + meta */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="h-9 rounded-md border border-border/60 bg-background px-2 text-sm"
          aria-label="Select commodity"
        >
          {COMMODITIES.map((c) => (
            <option key={c.symbol} value={c.symbol}>
              {c.symbol} — {c.name}
            </option>
          ))}
        </select>
        <Badge variant="outline" className="text-xs">{commodity?.category ?? "COMMODITY"}</Badge>
        {commodity && (
          <span className="text-xs text-muted-foreground">
            {commodity.unit} · {commodity.currency} · lot {commodity.lotSize}
          </span>
        )}
      </div>

      {/* Ticker snapshot */}
      <Card className="border-border/60">
        <CardContent className="flex flex-wrap items-end gap-6 py-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Last price</div>
            <div className="text-2xl font-semibold tabular-nums">
              {fmt(ticker?.lastPrice)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">{ticker?.currency ?? ""}</span>
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">24h change</div>
            <div className={cn("flex items-center gap-1 text-lg font-medium tabular-nums", changeTone)}>
              {change == null ? (
                <Minus className="h-4 w-4" />
              ) : change > 0 ? (
                <ArrowUpRight className="h-4 w-4" />
              ) : (
                <ArrowDownRight className="h-4 w-4" />
              )}
              {change == null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(2)}%`}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">24h volume</div>
            <div className="text-lg font-medium tabular-nums">{fmt(ticker?.volume24h, 4)}</div>
          </div>
          <div className="flex gap-4 text-sm tabular-nums">
            <span className="text-muted-foreground">
              H <span className="text-foreground">{fmt(ticker?.high)}</span>
            </span>
            <span className="text-muted-foreground">
              L <span className="text-foreground">{fmt(ticker?.low)}</span>
            </span>
          </div>
          {ticker?.updatedAt && (
            <span className="ml-auto text-[10px] text-muted-foreground/70">
              updated {new Date(ticker.updatedAt).toLocaleTimeString()}
            </span>
          )}
        </CardContent>
      </Card>

      {/* Depth chart + ladder */}
      <div className="grid gap-4 md:grid-cols-2">
        <DepthChart symbol={symbol} />
        <OrderBookDepth symbol={symbol} />
      </div>

      {/* Recent trades */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Recent Trades — {symbol}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {trades.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No trades executed for {symbol} yet.
            </p>
          ) : (
            <table className="w-full font-mono text-xs">
              <thead>
                <tr className="border-b border-border/50 text-left text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  <th className="py-1 pr-2 font-medium">Time</th>
                  <th className="py-1 pr-2 text-right font-medium">Price</th>
                  <th className="py-1 pr-2 text-right font-medium">Quantity</th>
                  <th className="py-1 text-right font-medium">Settlement</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.fillId} className="border-b border-border/30 last:border-0">
                    <td className="py-1.5 pr-2 text-muted-foreground">
                      {t.executedAt ? new Date(t.executedAt).toLocaleTimeString() : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right">{fmt(t.price)}</td>
                    <td className="py-1.5 pr-2 text-right">{fmt(t.quantity, 4)}</td>
                    <td className="py-1.5 text-right">
                      <span
                        className={cn(
                          t.settlementStatus === "SETTLED"
                            ? "text-emerald-600/80 dark:text-emerald-400/70"
                            : "text-amber-600/80 dark:text-amber-400/70"
                        )}
                      >
                        {t.settlementStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
