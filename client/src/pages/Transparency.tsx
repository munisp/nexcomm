/**
 * Transparency.tsx (INNOV-D — Innovation 10)
 * Public Market Transparency Portal at /transparency.
 * Aggregated, anonymized platform metrics: 30-day market activity, settlement
 * outcomes, platform participation, and per-commodity price discovery.
 * No login required. Empty states are honest when a metric is not available.
 */
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart3,
  Landmark,
  Warehouse,
  Users,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
} from "lucide-react";

import { formatNGN } from "@/lib/format";

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-NG").format(n);
}

function StatCard({
  title,
  value,
  hint,
  icon,
}: {
  title: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold text-foreground">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function Transparency() {
  const market = trpc.transparency.marketStats.useQuery();
  const settlement = trpc.transparency.settlementStats.useQuery();
  const health = trpc.transparency.platformHealth.useQuery();
  const prices = trpc.transparency.priceDiscovery.useQuery();

  const loading = market.isLoading || settlement.isLoading || health.isLoading;

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 bg-background px-4 py-10">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
          <BarChart3 className="h-6 w-6 text-primary" />
          Market Transparency Portal
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Aggregated, anonymized activity on the NEXCOM commodity exchange over the trailing
          30 days. No individual positions or identities are disclosed.
        </p>
      </header>

      {loading && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* ── 30-day market activity ─────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Market activity (30 days)
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Trades executed"
            value={market.data ? formatNumber(market.data.tradeCount) : "—"}
            icon={<BarChart3 className="h-4 w-4" />}
          />
          <StatCard
            title="Gross traded value"
            value={
              market.data?.grossValueNgn != null ? formatNGN(market.data.grossValueNgn) : "—"
            }
            hint="Sum of filled quantity × average fill price"
            icon={<Landmark className="h-4 w-4" />}
          />
          <StatCard
            title="Commodities traded"
            value={market.data ? formatNumber(market.data.distinctCommodities) : "—"}
            icon={<Warehouse className="h-4 w-4" />}
          />
          <StatCard
            title="States participating"
            value={market.data?.distinctStates != null ? formatNumber(market.data.distinctStates) : "—"}
            hint="Distinct states of trading accounts"
            icon={<Users className="h-4 w-4" />}
          />
        </div>
      </section>

      {/* ── Settlement outcomes ────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Settlement outcomes (30 days)
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            title="Settled"
            value={settlement.data ? formatNumber(settlement.data.settledCount) : "—"}
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <StatCard
            title="Failed"
            value={settlement.data ? formatNumber(settlement.data.failedCount) : "—"}
            icon={<TrendingDown className="h-4 w-4" />}
          />
          <StatCard
            title="Median settlement latency"
            value={
              settlement.data?.medianSettlementHours != null
                ? `${settlement.data.medianSettlementHours.toFixed(1)} h`
                : "—"
            }
            hint="From settlement creation to settlement date"
            icon={<Minus className="h-4 w-4" />}
          />
        </div>
      </section>

      {/* ── Platform participation ─────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Platform participation
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            title="Accredited warehouses"
            value={health.data?.accreditedWarehouses != null ? formatNumber(health.data.accreditedWarehouses) : "—"}
            hint={
              health.data?.activeWarehouses != null
                ? `${formatNumber(health.data.activeWarehouses)} active facilities in total`
                : undefined
            }
            icon={<Warehouse className="h-4 w-4" />}
          />
          <StatCard
            title="Active field agents"
            value={health.data?.activeAgents != null ? formatNumber(health.data.activeAgents) : "—"}
            icon={<Users className="h-4 w-4" />}
          />
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Registered users by role
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {health.data && health.data.usersByRole.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {health.data.usersByRole.map((r) => (
                    <li key={r.role} className="flex items-center justify-between">
                      <span className="capitalize text-muted-foreground">{r.role}</span>
                      <Badge variant="secondary">{formatNumber(r.count)}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No user data available.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Price discovery ────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Price discovery
        </h2>
        <Card>
          <CardContent className="p-0">
            {prices.isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !prices.data || prices.data.commodities.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No live commodity prices are available at the moment.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Commodity</TableHead>
                    <TableHead>Symbol</TableHead>
                    <TableHead className="text-right">Last price</TableHead>
                    <TableHead className="text-right">Change vs prev. close</TableHead>
                    <TableHead className="text-right">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {prices.data.commodities.map((c) => {
                    const pct = c.changePct;
                    return (
                      <TableRow key={c.symbol}>
                        <TableCell className="font-medium text-foreground">{c.name}</TableCell>
                        <TableCell className="text-muted-foreground">{c.symbol}</TableCell>
                        <TableCell className="text-right text-foreground">
                          {c.lastPrice != null
                            ? c.currency === "NGN"
                              ? formatNGN(c.lastPrice)
                              : `${c.currency} ${formatNumber(c.lastPrice)}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {pct == null ? (
                            "—"
                          ) : (
                            <span
                              className={
                                pct > 0
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : pct < 0
                                    ? "text-red-600 dark:text-red-400"
                                    : "text-muted-foreground"
                              }
                            >
                              {pct > 0 ? "+" : ""}
                              {pct.toFixed(2)}%
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {new Date(c.updatedAt).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>

      <p className="text-center text-xs text-muted-foreground">
        All figures are aggregated and anonymized. Values shown as “—” are not derivable
        from currently available platform data.
      </p>
    </div>
  );
}
