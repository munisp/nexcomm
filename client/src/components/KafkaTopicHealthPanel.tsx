/**
 * KafkaTopicHealthPanel.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Displays Kafka topic health: consumed, written, errors, and last-seen
 * timestamps for all matching engine and settlement engine topics.
 */
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Activity, RefreshCw, AlertTriangle, CheckCircle2, XCircle,
  Zap, Database, TrendingUp,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────
interface TopicStats {
  consumed: number;
  written: number;
  errors: number;
  last_seen?: string;
  lag?: number;
}

interface KafkaStatsData {
  topics: Record<string, TopicStats>;
  total_consumed: number;
  total_written: number;
  total_errors: number;
  error?: string;
}

interface FeedsData {
  feeds?: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    throughput_msg_per_sec?: number;
    lag_ms?: number;
    error_count?: number;
    last_message?: string;
  }>;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const TOPIC_LABELS: Record<string, { label: string; source: string; color: string }> = {
  "nexcom.orders.created":    { label: "Order Created",        source: "Matching Engine", color: "text-blue-400" },
  "nexcom.orders.filled":     { label: "Order Filled",         source: "Matching Engine", color: "text-emerald-400" },
  "nexcom.orders.cancelled":  { label: "Order Cancelled",      source: "Matching Engine", color: "text-yellow-400" },
  "nexcom.orders.rejected":   { label: "Order Rejected",       source: "Matching Engine", color: "text-red-400" },
  "nexcom.trades.executed":   { label: "Trade Executed",       source: "Matching Engine", color: "text-emerald-400" },
  "nexcom.trades.settled":    { label: "Trade Settled",        source: "Settlement Engine", color: "text-purple-400" },
  "nexcom.orderbook.snapshot":{ label: "Order Book Snapshot",  source: "Matching Engine", color: "text-blue-400" },
  "nexcom.orderbook.update":  { label: "Order Book Update",    source: "Matching Engine", color: "text-blue-300" },
  "nexcom.settlement.initiated":  { label: "Settlement Initiated",  source: "Settlement Engine", color: "text-purple-400" },
  "nexcom.settlement.completed":  { label: "Settlement Completed",  source: "Settlement Engine", color: "text-emerald-400" },
  "nexcom.settlement.failed":     { label: "Settlement Failed",     source: "Settlement Engine", color: "text-red-400" },
  "nexcom.risk.breach":           { label: "Risk Breach",           source: "Risk Engine", color: "text-orange-400" },
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function writeRate(consumed: number, written: number): string {
  if (consumed === 0) return "—";
  return `${((written / consumed) * 100).toFixed(1)}%`;
}

// ─── Component ───────────────────────────────────────────────────────────────
export function KafkaTopicHealthPanel() {
  const {
    data: kafkaData, isLoading: kafkaLoading, refetch: refetchKafka, isFetching: kafkaFetching,
  } = trpc.lakehouse.getKafkaStats.useQuery(undefined, { refetchInterval: 30_000 });

  const {
    data: feedsData, isLoading: feedsLoading, refetch: refetchFeeds,
  } = trpc.lakehouse.getFeeds.useQuery(undefined, { refetchInterval: 30_000 });

  const kafka = kafkaData as KafkaStatsData | undefined;
  const feeds = feedsData as FeedsData | undefined;

  const isLoading = kafkaLoading || feedsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading event feed health...
      </div>
    );
  }

  const topicEntries = kafka?.topics ? Object.entries(kafka.topics) : [];
  const hasError = !kafka || kafka.error;

  return (
    <div className="space-y-6">
      {/* ── Summary KPIs ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-card/60 border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Total Consumed</span>
            </div>
            <p className="text-lg font-bold text-foreground">
              {kafka ? formatNumber(kafka.total_consumed) : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">events ingested</p>
          </CardContent>
        </Card>

        <Card className="bg-card/60 border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Database className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Written to Bronze</span>
            </div>
            <p className="text-lg font-bold text-foreground">
              {kafka ? formatNumber(kafka.total_written) : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {kafka && kafka.total_consumed > 0
                ? `${((kafka.total_written / kafka.total_consumed) * 100).toFixed(1)}% write rate`
                : "—"}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/60 border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="w-4 h-4 text-red-400" />
              <span className="text-xs text-muted-foreground">Total Errors</span>
            </div>
            <p className={`text-lg font-bold ${(kafka?.total_errors ?? 0) > 0 ? "text-red-400" : "text-foreground"}`}>
              {kafka ? formatNumber(kafka.total_errors) : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">write failures</p>
          </CardContent>
        </Card>

        <Card className="bg-card/60 border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Active Topics</span>
            </div>
            <p className="text-lg font-bold text-foreground">{topicEntries.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">/ 12 expected</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Kafka Topic Stats Table ── */}
      <Card className="bg-card/60 border-border/50">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="w-4 h-4 text-primary" />
            Kafka Topic Stats
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => { refetchKafka(); refetchFeeds(); }}
            disabled={kafkaFetching}
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${kafkaFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {hasError ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
              <AlertTriangle className="w-6 h-6 text-yellow-500" />
              <p className="text-sm">{kafka?.error ?? "Ingestion engine offline — running in stub mode"}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50 hover:bg-transparent">
                    <TableHead className="text-xs text-muted-foreground">Topic</TableHead>
                    <TableHead className="text-xs text-muted-foreground">Source</TableHead>
                    <TableHead className="text-xs text-muted-foreground text-right">Consumed</TableHead>
                    <TableHead className="text-xs text-muted-foreground text-right">Written</TableHead>
                    <TableHead className="text-xs text-muted-foreground text-right">Write Rate</TableHead>
                    <TableHead className="text-xs text-muted-foreground text-right">Errors</TableHead>
                    <TableHead className="text-xs text-muted-foreground">Last Seen</TableHead>
                    <TableHead className="text-xs text-muted-foreground">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topicEntries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground text-sm py-8">
                        No topic data yet — start the ingestion engine to begin consuming events
                      </TableCell>
                    </TableRow>
                  ) : (
                    topicEntries.map(([topic, stats]) => {
                      const meta = TOPIC_LABELS[topic];
                      const hasErrors = stats.errors > 0;
                      const isActive = stats.consumed > 0;
                      return (
                        <TableRow key={topic} className="border-border/30 hover:bg-muted/20">
                          <TableCell className="py-2">
                            <p className={`text-xs font-mono font-medium ${meta?.color ?? "text-foreground"}`}>
                              {meta?.label ?? topic}
                            </p>
                            <p className="text-xs text-muted-foreground font-mono">{topic}</p>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {meta?.source ?? "Unknown"}
                          </TableCell>
                          <TableCell className="text-right text-xs font-mono">{formatNumber(stats.consumed)}</TableCell>
                          <TableCell className="text-right text-xs font-mono">{formatNumber(stats.written)}</TableCell>
                          <TableCell className="text-right text-xs">
                            <span className={stats.consumed > 0 && stats.written < stats.consumed * 0.95 ? "text-yellow-400" : "text-foreground"}>
                              {writeRate(stats.consumed, stats.written)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            <span className={hasErrors ? "text-red-400 font-semibold" : "text-muted-foreground"}>
                              {stats.errors}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {stats.last_seen
                              ? new Date(stats.last_seen).toLocaleTimeString()
                              : "—"}
                          </TableCell>
                          <TableCell>
                            {isActive ? (
                              <Badge variant="default" className="text-xs">
                                <CheckCircle2 className="w-3 h-3 mr-1" />Active
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">
                                Idle
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Data Feed Connectors ── */}
      {feeds && !feeds.error && feeds.feeds && feeds.feeds.length > 0 && (
        <Card className="bg-card/60 border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <TrendingUp className="w-4 h-4 text-primary" />
              Data Feed Connectors ({feeds.feeds.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50 hover:bg-transparent">
                    <TableHead className="text-xs text-muted-foreground">Feed</TableHead>
                    <TableHead className="text-xs text-muted-foreground">Type</TableHead>
                    <TableHead className="text-xs text-muted-foreground text-right">Throughput</TableHead>
                    <TableHead className="text-xs text-muted-foreground text-right">Lag (ms)</TableHead>
                    <TableHead className="text-xs text-muted-foreground text-right">Errors</TableHead>
                    <TableHead className="text-xs text-muted-foreground">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {feeds.feeds.map((feed) => (
                    <TableRow key={feed.id} className="border-border/30 hover:bg-muted/20">
                      <TableCell className="py-2">
                        <p className="text-xs font-medium text-foreground">{feed.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{feed.id}</p>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground capitalize">{feed.type}</TableCell>
                      <TableCell className="text-right text-xs font-mono">
                        {feed.throughput_msg_per_sec != null ? `${feed.throughput_msg_per_sec.toFixed(1)}/s` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono">
                        {feed.lag_ms != null ? feed.lag_ms : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        <span className={(feed.error_count ?? 0) > 0 ? "text-red-400" : "text-muted-foreground"}>
                          {feed.error_count ?? 0}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={feed.status === "running" ? "default" : feed.status === "error" ? "destructive" : "secondary"}
                          className="text-xs capitalize"
                        >
                          {feed.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
