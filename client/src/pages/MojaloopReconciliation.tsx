/**
 * Transfer Reconciliation Report — /mojaloop/reconciliation
 * ─────────────────────────────────────────────────────────────────────────────
 * Daily summary of committed vs. aborted Mojaloop transfers, total interop
 * volume by currency, and unmatched transfers (committed in Mojaloop but
 * missing a settlement record).
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileCheck,
  Network,
  RefreshCw,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { useLocation } from "wouter";
import { MojaloopHubBanner } from "@/components/MojaloopHubBanner";
import { PageSkeleton } from "@/components/PageSkeleton";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtAmount(v: string | number | null | undefined, currency = "") {
  const n = Number(v ?? 0);
  return `${currency ? currency + " " : ""}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(ts: number | string | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color = "text-primary",
  alert = false,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  color?: string;
  alert?: boolean;
}) {
  return (
    <Card className={alert ? "border-destructive/40" : ""}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className={`text-2xl font-bold mt-1 ${alert ? "text-destructive" : ""}`}>{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          <div className={`p-2 rounded-lg bg-muted ${color}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MojaloopReconciliation() {
  const [, navigate] = useLocation();
  const [days, setDays] = useState(7);

  const utils = trpc.useUtils();
  const refresh = () => utils.mojaloop.invalidate();

  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data: report, isLoading } = trpc.mojaloop.reconciliationReport.useQuery(
    { fromDate },
    { refetchInterval: 60_000 }
  );

  const handleExportCsv = () => {
    if (!report) return;
    const rows = [
      ["Date", "Committed", "Aborted", "Pending", "Total Volume", "Currencies", "Unmatched"].join(","),
      ...(report.byDay ?? []).map((d: any) =>
        [
          d.date,
          d.committed,
          d.aborted,
          d.pending,
          d.totalVolume,
          d.currencies?.join("|") ?? "",
          d.unmatchedCount ?? 0,
        ].join(",")
      ),
    ].join("\n");
    const blob = new Blob([rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mojaloop-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported.");
  };

  const summary = report?.summary;
  const dailySummary: any[] = report?.byDay ?? [];
  const unmatchedTransfers: any[] = report?.unmatchedTransfers ?? [];
  const volumeByCurrency: any[] = report?.byCurrency ?? [];

  if (isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
  return (
    <div className="flex flex-col">
      <MojaloopHubBanner />
      <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <button onClick={() => navigate("/mojaloop")} className="hover:text-foreground transition-colors flex items-center gap-1">
              <Network className="w-3.5 h-3.5" />
              Mojaloop Payments
            </button>
            <span>/</span>
            <span>Transfer Reconciliation</span>
          </div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileCheck className="w-6 h-6 text-primary" />
            Transfer Reconciliation Report
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Daily summary of committed vs. aborted transfers and unmatched settlement records.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Period selector */}
          <div className="flex rounded-md border overflow-hidden text-sm">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  days === d
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-foreground hover:bg-muted"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={!report}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Committed"
          value={isLoading ? "—" : (summary?.committed?.count ?? 0)}
          subtitle={`$${fmtAmount(summary?.committed?.totalAmount)} volume`}
          icon={CheckCircle2}
          color="text-green-500"
        />
        <StatCard
          title="Aborted"
          value={isLoading ? "—" : (summary?.aborted?.count ?? 0)}
          subtitle="Failed / reversed"
          icon={XCircle}
          color="text-red-500"
        />
        <StatCard
          title="Total Volume"
          value={isLoading ? "—" : `$${fmtAmount((summary?.committed?.totalAmount ?? 0) + (summary?.aborted?.totalAmount ?? 0))}`}
          subtitle="All currencies (USD equiv)"
          icon={TrendingUp}
          color="text-purple-500"
        />
        <StatCard
          title="Unmatched"
          value={isLoading ? "—" : (report?.unmatchedCount ?? 0)}
          subtitle="Committed but no settlement"
          icon={AlertTriangle}
          color="text-orange-500"
          alert={(report?.unmatchedCount ?? 0) > 0}
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="daily">
        <TabsList>
          <TabsTrigger value="daily">Daily Summary</TabsTrigger>
          <TabsTrigger value="currencies">By Currency</TabsTrigger>
          <TabsTrigger value="unmatched">
            Unmatched
            {(report?.unmatchedCount ?? 0) > 0 && (
              <Badge variant="destructive" className="ml-2 text-xs">{report?.unmatchedCount}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Daily Summary */}
        <TabsContent value="daily">
          <Card>
            <CardHeader>
              <CardTitle>Daily Transfer Summary</CardTitle>
              <CardDescription>Transfer counts and volume per day for the last {days} days.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading report…</div>
              ) : dailySummary.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No transfer data for this period.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Committed</TableHead>
                      <TableHead className="text-right">Aborted</TableHead>
                      <TableHead className="text-right">Pending</TableHead>
                      <TableHead className="text-right">Volume (USD)</TableHead>
                      <TableHead>Currencies</TableHead>
                      <TableHead className="text-right">Unmatched</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dailySummary.map((row: any) => (
                      <TableRow key={row.date}>
                        <TableCell className="font-medium">{row.date}</TableCell>
                        <TableCell className="text-right text-green-600">{row.committedCount}</TableCell>
                        <TableCell className="text-right text-red-500">{row.abortedCount}</TableCell>
                        <TableCell className="text-right text-yellow-500">—</TableCell>
                        <TableCell className="text-right">${fmtAmount(row.committedAmount)}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">—</TableCell>
                        <TableCell className="text-right">
                          <span className="text-muted-foreground">—</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* By Currency */}
        <TabsContent value="currencies">
          <Card>
            <CardHeader>
              <CardTitle>Volume by Currency</CardTitle>
              <CardDescription>Total interoperable transfer volume broken down by currency.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading…</div>
              ) : volumeByCurrency.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No currency data for this period.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Currency</TableHead>
                      <TableHead className="text-right">Committed Transfers</TableHead>
                      <TableHead className="text-right">Total Volume</TableHead>
                      <TableHead className="text-right">Avg Transfer</TableHead>
                      <TableHead className="text-right">Aborted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {volumeByCurrency.map((row: any) => (
                      <TableRow key={row.currency}>
                        <TableCell>
                          <Badge variant="outline" className="font-mono">{row.currency}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{row.count}</TableCell>
                        <TableCell className="text-right font-medium">{fmtAmount(row.committedAmount, row.currency)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {row.count > 0
                            ? fmtAmount(Number(row.committedAmount) / Number(row.count), row.currency)
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right text-red-500">{row.abortedCount ?? 0}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Unmatched Transfers */}
        <TabsContent value="unmatched">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-orange-500" />
                Unmatched Transfers
              </CardTitle>
              <CardDescription>
                Transfers committed in Mojaloop but missing a corresponding settlement record. These require manual investigation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading…</div>
              ) : unmatchedTransfers.length === 0 ? (
                <div className="flex flex-col items-center py-10 gap-3 text-center">
                  <CheckCircle2 className="w-10 h-10 text-green-500" />
                  <div>
                    <p className="font-medium">All transfers reconciled</p>
                    <p className="text-sm text-muted-foreground">No unmatched transfers in the last {days} days.</p>
                  </div>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Transfer ID</TableHead>
                      <TableHead>Payer</TableHead>
                      <TableHead>Payee</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Currency</TableHead>
                      <TableHead>Committed At</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unmatchedTransfers.map((row: any) => (
                      <TableRow key={row.transferId} className="bg-orange-500/5">
                        <TableCell>
                          <code className="text-xs">{row.transferId.slice(0, 16)}…</code>
                        </TableCell>
                        <TableCell className="text-sm">{row.payerIdentifier}</TableCell>
                        <TableCell className="text-sm">{row.payeeIdentifier}</TableCell>
                        <TableCell className="text-right font-medium">{fmtAmount(row.amount)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">{row.currency}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtDate(row.updatedAt)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-orange-500 border-orange-500/30 text-xs">
                            No Settlement
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
}
