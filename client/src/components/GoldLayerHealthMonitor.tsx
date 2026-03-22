/**
 * GoldLayerHealthMonitor.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Displays Gold layer table health: row counts, null rates, freshness, size,
 * partition counts, and ML feature store statistics.
 */
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Database, RefreshCw, AlertTriangle, CheckCircle2, Clock,
  BarChart3, Layers, Cpu, TrendingUp,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────
interface GoldTable {
  name: string;
  description: string;
  source_silver: string[];
  refresh_interval: string;
  primary_keys: string[];
  row_count: number;
  null_rate_pct: number;
  size_mb: number;
  partition_count: number;
  last_updated: string;
  last_updated_ago_min: number;
  freshness_status: "fresh" | "stale";
  is_stale: boolean;
}

interface FeatureStoreSummary {
  total_features: number;
  categories: Record<string, number>;
  last_recomputed: string;
  coverage_symbols: number;
}

interface GoldHealthData {
  overall_health: "healthy" | "degraded" | "critical";
  stale_tables: number;
  total_tables: number;
  total_rows: number;
  tables: GoldTable[];
  feature_store: FeatureStoreSummary;
  checked_at: string;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function healthColor(status: string) {
  if (status === "healthy") return "text-emerald-400";
  if (status === "degraded") return "text-yellow-400";
  return "text-red-400";
}

function freshnessVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  return status === "fresh" ? "default" : "destructive";
}

// ─── Component ───────────────────────────────────────────────────────────────
export function GoldLayerHealthMonitor() {
  const { data, isLoading, refetch, isFetching } = trpc.lakehouse.getGoldLayerHealth.useQuery(
    undefined,
    { refetchInterval: 60_000 }
  );

  const health = data as GoldHealthData | undefined;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading Gold layer health...
      </div>
    );
  }

  if (!health || health.error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <AlertTriangle className="w-8 h-8 text-yellow-500" />
        <p className="text-sm">{health?.error ?? "Gold layer health unavailable"}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  const fs = health.feature_store;

  return (
    <div className="space-y-6">
      {/* ── Summary KPIs ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-card/60 border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Database className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Overall Health</span>
            </div>
            <p className={`text-lg font-bold capitalize ${healthColor(health.overall_health)}`}>
              {health.overall_health}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {health.stale_tables} stale / {health.total_tables} tables
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/60 border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Total Rows</span>
            </div>
            <p className="text-lg font-bold text-foreground">{formatNumber(health.total_rows)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">across all Gold tables</p>
          </CardContent>
        </Card>

        <Card className="bg-card/60 border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Cpu className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Feature Store</span>
            </div>
            <p className="text-lg font-bold text-foreground">{fs.total_features}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              features · {fs.coverage_symbols} symbols
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/60 border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Last Checked</span>
            </div>
            <p className="text-sm font-semibold text-foreground">
              {new Date(health.checked_at).toLocaleTimeString()}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-0 text-xs text-muted-foreground hover:text-primary mt-0.5"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? "Refreshing…" : "Refresh now"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Gold Table Health Table ── */}
      <Card className="bg-card/60 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Layers className="w-4 h-4 text-primary" />
            Gold Table Health
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="text-xs text-muted-foreground w-48">Table</TableHead>
                  <TableHead className="text-xs text-muted-foreground text-right">Rows</TableHead>
                  <TableHead className="text-xs text-muted-foreground text-right">Null %</TableHead>
                  <TableHead className="text-xs text-muted-foreground text-right">Size (MB)</TableHead>
                  <TableHead className="text-xs text-muted-foreground text-right">Partitions</TableHead>
                  <TableHead className="text-xs text-muted-foreground">Refresh</TableHead>
                  <TableHead className="text-xs text-muted-foreground">Last Updated</TableHead>
                  <TableHead className="text-xs text-muted-foreground">Freshness</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.tables.map((t) => (
                  <TableRow key={t.name} className="border-border/30 hover:bg-muted/20">
                    <TableCell className="py-2">
                      <div>
                        <p className="text-xs font-mono font-medium text-foreground">{t.name}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[180px]">{t.description}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs font-mono">{formatNumber(t.row_count)}</TableCell>
                    <TableCell className="text-right text-xs">
                      <span className={t.null_rate_pct > 2 ? "text-yellow-400" : "text-foreground"}>
                        {t.null_rate_pct.toFixed(2)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-xs font-mono">{t.size_mb.toFixed(1)}</TableCell>
                    <TableCell className="text-right text-xs font-mono">{t.partition_count}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{t.refresh_interval}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {t.last_updated_ago_min}m ago
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={freshnessVariant(t.freshness_status)} className="text-xs capitalize">
                        {t.freshness_status === "fresh"
                          ? <><CheckCircle2 className="w-3 h-3 mr-1" />Fresh</>
                          : <><AlertTriangle className="w-3 h-3 mr-1" />Stale</>
                        }
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Feature Store Breakdown ── */}
      <Card className="bg-card/60 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <TrendingUp className="w-4 h-4 text-primary" />
            ML Feature Store — {fs.total_features} Features across {Object.keys(fs.categories).length} Categories
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(fs.categories).map(([cat, count]) => (
              <div key={cat} className="bg-muted/30 rounded-lg p-3 border border-border/30">
                <p className="text-xs text-muted-foreground capitalize mb-1">
                  {cat.replace(/_/g, " ")}
                </p>
                <p className="text-xl font-bold text-primary">{count}</p>
                <div className="mt-1 h-1 rounded-full bg-border overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${Math.min(100, (count / fs.total_features) * 100 * 5)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Last recomputed: {new Date(fs.last_recomputed).toLocaleString()} · {fs.coverage_symbols} symbols covered
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
