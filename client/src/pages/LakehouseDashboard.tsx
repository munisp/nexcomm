/**
 * NEXCOM Exchange — Lakehouse Data Platform Dashboard
 * Wired to lakehouseRouter:
 *   health, getStatus, getCatalog, getLineage, getPipelineStatus,
 *   getFeatureStore, getSchemaRegistry, queryDataFusion, getIngestionFeeds
 */
import { useState } from "react";
import LakehouseLineageViz from "@/components/LakehouseLineageViz";
import { SilverTransformationViewer } from "@/components/SilverTransformationViewer";
import { GoldLayerHealthMonitor } from "@/components/GoldLayerHealthMonitor";
import { KafkaTopicHealthPanel } from "@/components/KafkaTopicHealthPanel";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  Layers, Database, Activity, Zap, BarChart3, RefreshCw, CheckCircle,
  XCircle, AlertTriangle, Play, Clock, GitBranch, Table2, Search,
  TrendingUp, Cpu, HardDrive, Network,
} from "lucide-react";

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${ok ? "bg-green-400" : "bg-red-400"}`} />
  );
}

function LayerBadge({ layer }: { layer: string }) {
  const colors: Record<string, string> = {
    bronze: "bg-amber-800/30 text-amber-300 border-amber-700/50",
    silver: "bg-slate-500/30 text-slate-200 border-slate-400/50",
    gold: "bg-yellow-600/30 text-yellow-300 border-yellow-500/50",
  };
  return (
    <Badge variant="outline" className={`text-xs ${colors[layer.toLowerCase()] ?? "bg-muted/30 text-muted-foreground"}`}>
      {layer.toUpperCase()}
    </Badge>
  );
}

export default function LakehouseDashboard() {
  const [sqlQuery, setSqlQuery] = useState(
    "SELECT symbol, last_price, change_24h_pct, volume_24h\nFROM gold.market_summary\nORDER BY volume_24h DESC\nLIMIT 10"
  );
  const [queryResult, setQueryResult] = useState<null | { rows: number; executionTime: string; result: Record<string, unknown>[] }>(null);

  const { data: health, refetch: refetchHealth, isLoading: healthLoading } = trpc.lakehouse.health.useQuery(undefined, { refetchInterval: 30000 });
  const { data: status, refetch: refetchStatus } = trpc.lakehouse.getStatus.useQuery(undefined, { refetchInterval: 30000 });
  const { data: catalog, refetch: refetchCatalog } = trpc.lakehouse.getCatalog.useQuery(undefined, { refetchInterval: 60000 });
  const { data: pipeline, refetch: refetchPipeline } = trpc.lakehouse.getPipelineStatus.useQuery(undefined, { refetchInterval: 15000 });
  const { data: featureStore } = trpc.lakehouse.getFeatureStore.useQuery(undefined, { refetchInterval: 60000 });
  const { data: feeds } = trpc.lakehouse.getFeeds.useQuery(undefined, { refetchInterval: 30000 });

  const queryMutation = trpc.lakehouse.query.useMutation({
    onSuccess: (data: unknown) => {
      const d = data as Record<string, unknown>;
      setQueryResult({
        rows: Number(d.rows ?? 0),
        executionTime: String(d.executionTime ?? "—"),
        result: Array.isArray(d.result) ? (d.result as Record<string, unknown>[]) : [],
      });
      toast.success(`Query executed: ${Number(d.rows ?? 0)} rows in ${String(d.executionTime ?? "—")}`);
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const statusData = status as Record<string, unknown> | undefined;
  const catalogData = catalog as { tables?: Record<string, unknown>[] } | undefined;
  const pipelineData = pipeline as { jobs?: Record<string, unknown>[] } | undefined;
  const featureData = featureStore as { features?: Record<string, unknown>[] } | undefined;
  const feedsData = feeds as { feeds?: Record<string, unknown>[] } | undefined;
  const healthData = health as Record<string, unknown> | undefined;

  const tables = Array.isArray(catalogData?.tables) ? catalogData.tables : [];
  const jobs = Array.isArray(pipelineData?.jobs) ? pipelineData.jobs : [];
  const features = Array.isArray(featureData?.features) ? featureData.features : [];
  const feedList = Array.isArray(feedsData?.feeds) ? feedsData.feeds : [];

  const components = (statusData?.components as Record<string, boolean>) ?? {};
  const layers = (statusData?.layers as Record<string, Record<string, unknown>>) ?? {};

  const refetchAll = () => {
    refetchHealth(); refetchStatus(); refetchCatalog(); refetchPipeline();
  };

  if (healthLoading) return <PageSkeleton cards={4} tableRows={6} tableCols={4} showChart />;
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Layers className="w-6 h-6 text-yellow-400" />
            Lakehouse Data Platform
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Bronze → Silver → Gold Delta Lake pipeline · Spark · Flink · Sedona · Ray · DataFusion
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={`text-xs ${healthData?.online ? "text-green-400 border-green-500/30" : "text-red-400 border-red-500/30"}`}
          >
            <StatusDot ok={!!healthData?.online} />
            {healthData?.online ? "Ingestion Engine Online" : "Ingestion Engine Offline"}
          </Badge>
          <Button variant="outline" size="sm" onClick={refetchAll}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {/* Component Health Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { key: "spark", label: "Spark", icon: Zap, color: "text-orange-400" },
          { key: "flink", label: "Flink", icon: Activity, color: "text-blue-400" },
          { key: "sedona", label: "Sedona", icon: Network, color: "text-green-400" },
          { key: "ray", label: "Ray", icon: Cpu, color: "text-purple-400" },
          { key: "datafusion", label: "DataFusion", icon: Database, color: "text-cyan-400" },
          { key: "delta_lake", label: "Delta Lake", icon: HardDrive, color: "text-yellow-400" },
        ].map(({ key, label, icon: Icon, color }) => (
          <Card key={key} className="bg-card border-border">
            <CardContent className="p-3 flex flex-col items-center gap-1">
              <Icon className={`w-6 h-6 ${color}`} />
              <p className="text-xs font-medium text-foreground">{label}</p>
              {components[key] !== undefined ? (
                components[key]
                  ? <CheckCircle className="w-4 h-4 text-green-400" />
                  : <XCircle className="w-4 h-4 text-red-400" />
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Layer Status */}
      {Object.keys(layers).length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {(["bronze", "silver", "gold"] as const).map((layer) => {
            const l = layers[layer] as Record<string, unknown> | undefined;
            if (!l) return null;
            return (
              <Card key={layer} className="bg-card border-border">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <LayerBadge layer={layer} /> Layer
                    </CardTitle>
                    {l.healthy ? <CheckCircle className="w-4 h-4 text-green-400" /> : <AlertTriangle className="w-4 h-4 text-yellow-400" />}
                  </div>
                </CardHeader>
                <CardContent className="space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Tables</span><span>{String(l.tableCount ?? "—")}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Size</span><span>{String(l.sizeGb ?? "—")} GB</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Last Write</span><span className="text-muted-foreground/70">{String(l.lastWrite ?? "—")}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Format</span><span>{String(l.format ?? "Delta Lake")}</span></div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Tabs defaultValue="gold-health">
        <TabsList className="bg-muted/30 flex-wrap">
          <TabsTrigger value="gold-health">Gold Health</TabsTrigger>
          <TabsTrigger value="event-feeds">Event Feeds</TabsTrigger>
          <TabsTrigger value="silver">Silver Transforms</TabsTrigger>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline Jobs</TabsTrigger>
          <TabsTrigger value="features">Feature Store</TabsTrigger>
          <TabsTrigger value="feeds">Ingestion Feeds</TabsTrigger>
          <TabsTrigger value="lineage">Lineage Graph</TabsTrigger>
          <TabsTrigger value="query">DataFusion Query</TabsTrigger>
        </TabsList>

        {/* Gold Layer Health Monitor Tab */}
        <TabsContent value="gold-health" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="w-4 h-4 text-yellow-400" />
                Gold Layer Health Monitor
              </CardTitle>
              <CardDescription>
                Row counts, null rates, freshness, partition stats, and ML feature store health for all Gold tables.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GoldLayerHealthMonitor />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Kafka / Event Feeds Tab */}
        <TabsContent value="event-feeds" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-400" />
                Event Feeds &amp; Kafka Topic Health
              </CardTitle>
              <CardDescription>
                Per-topic consumed / written / error counts and last-seen timestamps for all 12 matching engine and settlement engine topics.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <KafkaTopicHealthPanel />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Silver Transformation Viewer Tab */}
        <TabsContent value="silver" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="w-4 h-4 text-slate-400" />
                Bronze → Silver Transformation Viewer
              </CardTitle>
              <CardDescription>
                Inspect deduplication rules, data quality checks, enrichment joins, schema diffs, and Spark ETL job stats for each Silver table.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SilverTransformationViewer />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Catalog Tab */}
        <TabsContent value="catalog" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2"><Table2 className="w-4 h-4" /> Table Catalog</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => refetchCatalog()}><RefreshCw className="w-3 h-3" /></Button>
              </div>
              <CardDescription>Delta Lake tables across Bronze, Silver, and Gold layers</CardDescription>
            </CardHeader>
            <CardContent>
              {tables.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Catalog loading — ingestion engine may be offline</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Table</TableHead>
                      <TableHead>Layer</TableHead>
                      <TableHead className="text-right">Rows</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead>Schema</TableHead>
                      <TableHead>Last Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(tables as Record<string, unknown>[]).map((t, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{String(t.name ?? t.table_name ?? "")}</TableCell>
                        <TableCell><LayerBadge layer={String(t.layer ?? "bronze")} /></TableCell>
                        <TableCell className="text-right text-xs">{Number(t.rowCount ?? t.row_count ?? 0).toLocaleString()}</TableCell>
                        <TableCell className="text-right text-xs">{String(t.sizeGb ?? t.size_gb ?? "—")} GB</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{String(t.schema ?? "")}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{String(t.lastUpdated ?? t.last_updated ?? "—")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pipeline Jobs Tab */}
        <TabsContent value="pipeline" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2"><GitBranch className="w-4 h-4" /> Pipeline Jobs</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => refetchPipeline()}><RefreshCw className="w-3 h-3" /></Button>
              </div>
              <CardDescription>Spark batch, Flink streaming, and Ray distributed jobs</CardDescription>
            </CardHeader>
            <CardContent>
              {jobs.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No pipeline jobs found — ingestion engine may be offline</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job</TableHead>
                      <TableHead>Engine</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Duration</TableHead>
                      <TableHead>Last Run</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(jobs as Record<string, unknown>[]).map((j, i) => {
                      const status = String(j.status ?? "unknown").toLowerCase();
                      const statusColor = status === "running" ? "text-green-400" : status === "failed" ? "text-red-400" : status === "completed" ? "text-blue-400" : "text-muted-foreground";
                      return (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{String(j.name ?? j.job_name ?? "")}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {String(j.engine ?? "Spark")}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span className={`text-xs font-semibold ${statusColor}`}>{String(j.status ?? "—").toUpperCase()}</span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{String(j.type ?? j.job_type ?? "batch")}</TableCell>
                          <TableCell className="text-right text-xs">{String(j.duration ?? j.duration_ms ?? "—")}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{String(j.lastRun ?? j.last_run ?? "—")}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Feature Store Tab */}
        <TabsContent value="features" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-purple-400" /> ML Feature Store
              </CardTitle>
              <CardDescription>
                Gold layer features used by LSTM forecasting, GNN anomaly detection, and risk scoring models
              </CardDescription>
            </CardHeader>
            <CardContent>
              {features.length === 0 ? (
                <div className="space-y-3">
                  {/* Static feature groups when ingestion engine is offline */}
                  {[
                    { group: "Price & Volume", count: 8, features: ["ma_5", "ma_20", "rsi_14", "macd", "vwap", "volume_ratio", "price_momentum", "bollinger_band"] },
                    { group: "Sentiment & News", count: 4, features: ["news_sentiment_24h", "social_sentiment_7d", "cot_net_position", "analyst_consensus"] },
                    { group: "Geospatial & Weather", count: 5, features: ["weather_impact", "logistics_delay_index", "production_region_yield", "drought_index", "flood_risk"] },
                    { group: "Market Microstructure", count: 5, features: ["bid_ask_spread", "order_imbalance", "market_depth_ratio", "tick_size", "basis_vs_cme"] },
                    { group: "Risk & Macro", count: 6, features: ["var_95", "cvar_95", "correlation_breakdown", "volatility_regime", "usd_index", "inflation_expectation"] },
                    { group: "GNN Graph Features", count: 4, features: ["commodity_correlation_graph", "supply_chain_graph", "counterparty_exposure_graph", "cross_market_contagion"] },
                  ].map(({ group, count, features: fList }) => (
                    <div key={group} className="border border-border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-foreground">{group}</span>
                        <Badge variant="outline" className="text-xs">{count} features</Badge>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {fList.map((f) => (
                          <code key={f} className="text-xs bg-muted/40 text-muted-foreground px-1.5 py-0.5 rounded">{f}</code>
                        ))}
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground text-center pt-2">
                    Showing static feature schema — connect ingestion engine for live feature statistics
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Feature</TableHead>
                      <TableHead>Group</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Used By</TableHead>
                      <TableHead className="text-right">Null Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(features as Record<string, unknown>[]).map((f, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{String(f.name ?? "")}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{String(f.group ?? "")}</TableCell>
                        <TableCell className="text-xs">{String(f.type ?? "float32")}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{String(f.usedBy ?? "")}</TableCell>
                        <TableCell className="text-right text-xs">{String(f.nullRate ?? "0%")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Ingestion Feeds Tab */}
        <TabsContent value="feeds" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4" /> Ingestion Feeds</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => refetchStatus()}><RefreshCw className="w-3 h-3" /></Button>
              </div>
              <CardDescription>Kafka topics and external data feeds flowing into the Bronze layer</CardDescription>
            </CardHeader>
            <CardContent>
              {feedList.length === 0 ? (
                <div className="space-y-2">
                  {[
                    { topic: "nexcom.order-flow", type: "Kafka", layer: "bronze", rate: "~2,400/s", latency: "12ms", status: "RUNNING" },
                    { topic: "nexcom.trades", type: "Kafka", layer: "bronze", rate: "~800/s", latency: "8ms", status: "RUNNING" },
                    { topic: "nexcom.market-data", type: "Kafka", layer: "bronze", rate: "~5,000/s", latency: "5ms", status: "RUNNING" },
                    { topic: "nexcom.iot-physical", type: "Kafka", layer: "silver", rate: "~120/s", latency: "45ms", status: "RUNNING" },
                    { topic: "nexcom.alternative", type: "Kafka", layer: "silver", rate: "~60/s", latency: "200ms", status: "RUNNING" },
                    { topic: "nexcom.clearing", type: "Kafka", layer: "silver", rate: "~30/s", latency: "25ms", status: "RUNNING" },
                    { topic: "CME FTP Feed", type: "FTP", layer: "bronze", rate: "daily", latency: "—", status: "SCHEDULED" },
                    { topic: "Weather API (ECMWF)", type: "REST", layer: "silver", rate: "hourly", latency: "—", status: "RUNNING" },
                    { topic: "News Sentiment (Reuters)", type: "WebSocket", layer: "silver", rate: "~10/min", latency: "150ms", status: "RUNNING" },
                  ].map((feed, i) => (
                    <div key={i} className="flex items-center justify-between border border-border rounded p-2.5 text-xs">
                      <div className="flex items-center gap-2">
                        <StatusDot ok={feed.status === "RUNNING"} />
                        <code className="text-foreground">{feed.topic}</code>
                        <Badge variant="outline" className="text-xs">{feed.type}</Badge>
                        <LayerBadge layer={feed.layer} />
                      </div>
                      <div className="flex items-center gap-4 text-muted-foreground">
                        <span>{feed.rate}</span>
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{feed.latency}</span>
                        <span className={feed.status === "RUNNING" ? "text-green-400" : "text-yellow-400"}>{feed.status}</span>
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground text-center pt-2">
                    Showing static feed schema — connect ingestion engine for live throughput metrics
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Feed / Topic</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Target Layer</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(feedList as Record<string, unknown>[]).map((f, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{String(f.topic ?? f.name ?? "")}</TableCell>
                        <TableCell className="text-xs">{String(f.type ?? "Kafka")}</TableCell>
                        <TableCell><LayerBadge layer={String(f.layer ?? "bronze")} /></TableCell>
                        <TableCell className="text-right text-xs">{String(f.rate ?? "—")}</TableCell>
                        <TableCell>
                          <span className={`text-xs font-semibold ${String(f.status ?? "").toLowerCase() === "running" ? "text-green-400" : "text-yellow-400"}`}>
                            {String(f.status ?? "—").toUpperCase()}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* DataFusion Query Tab */}
        {/* Lineage Graph Tab */}
        <TabsContent value="lineage" className="mt-4">
          <LakehouseLineageViz />
        </TabsContent>

        <TabsContent value="query" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Search className="w-4 h-4 text-cyan-400" /> DataFusion SQL Console
                </CardTitle>
                <CardDescription>Execute analytical queries against Delta Lake tables (SELECT only)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  value={sqlQuery}
                  onChange={(e) => setSqlQuery(e.target.value)}
                  rows={6}
                  className="font-mono text-xs bg-muted/20 border-border"
                  placeholder="SELECT * FROM gold.market_summary LIMIT 10"
                />
                <div className="flex flex-wrap gap-1">
                  {[
                    "SELECT symbol, last_price FROM gold.market_summary LIMIT 5",
                    "SELECT * FROM gold.features WHERE symbol = 'MAIZE' LIMIT 3",
                    "SELECT region_name, country, production_tonnes FROM gold.production_regions LIMIT 5",
                  ].map((q, i) => (
                    <button
                      key={i}
                      onClick={() => setSqlQuery(q)}
                      className="text-xs bg-muted/30 hover:bg-muted/50 text-muted-foreground px-2 py-1 rounded transition-colors"
                    >
                      Example {i + 1}
                    </button>
                  ))}
                </div>
                <Button
                  className="w-full"
                  onClick={() => queryMutation.mutate({ sql: sqlQuery })}
                  disabled={queryMutation.isPending || !sqlQuery.trim()}
                >
                  <Play className="w-4 h-4 mr-2" />
                  {queryMutation.isPending ? "Executing..." : "Run Query"}
                </Button>
                <div className="text-xs text-muted-foreground bg-muted/10 p-2 rounded space-y-1">
                  <p className="font-medium">Available tables:</p>
                  {["gold.market_summary", "gold.features", "gold.trades", "gold.positions", "gold.production_regions", "silver.trades", "silver.alternative", "bronze.order_flow"].map((t) => (
                    <code key={t} className="block text-muted-foreground/70">{t}</code>
                  ))}
                </div>
              </CardContent>
            </Card>

            {queryResult && (
              <Card className="bg-card border-border">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-green-400" /> Query Results
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{queryResult.rows} rows</Badge>
                      <Badge variant="outline" className="text-xs text-cyan-400">{queryResult.executionTime}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {queryResult.result.length === 0 ? (
                    <p className="text-center text-muted-foreground py-4 text-sm">No rows returned</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {Object.keys(queryResult.result[0]).map((col) => (
                              <TableHead key={col} className="text-xs">{col}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {queryResult.result.slice(0, 20).map((row, i) => (
                            <TableRow key={i}>
                              {Object.values(row).map((val, j) => (
                                <TableCell key={j} className="text-xs font-mono">
                                  {typeof val === "number" ? val.toLocaleString() : String(val ?? "—")}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {queryResult.result.length > 20 && (
                        <p className="text-xs text-muted-foreground text-center pt-2">Showing first 20 of {queryResult.rows} rows</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
