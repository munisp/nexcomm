import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw, Activity, GitBranch, Clock, Search } from "lucide-react";
import { toast } from "sonner";
import { PageSkeleton } from "@/components/PageSkeleton";

function durationColor(ms: number) {
  if (ms < 100) return "bg-green-500/20 text-green-400 border-green-500/30";
  if (ms < 500) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  return "bg-red-500/20 text-red-400 border-red-500/30";
}

function statusColor(status: string) {
  if (status === "OK" || status === "ok") return "bg-green-500/20 text-green-400 border-green-500/30";
  if (status === "ERROR" || status === "error") return "bg-red-500/20 text-red-400 border-red-500/30";
  return "bg-slate-500/20 text-slate-400 border-slate-500/30";
}

export default function DistributedTracing() {
  const [serviceFilter, setServiceFilter] = useState("all");
  const [minDuration, setMinDuration] = useState<number | undefined>(undefined);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [minDurationInput, setMinDurationInput] = useState("");

  const tracesQuery = trpc.tracing.getTraces.useQuery({
    limit: 50,
    serviceName: serviceFilter !== "all" ? serviceFilter : undefined,
    minDurationMs: minDuration,
  });

  const serviceMapQuery = trpc.tracing.getServiceMap.useQuery({ windowHours: 24 });
  const slowOpsQuery = trpc.tracing.getSlowOperations.useQuery({ windowHours: 24, minDurationMs: 200, limit: 10 });
  const traceDetailQuery = trpc.tracing.getTraceDetail.useQuery(
    { traceId: selectedTraceId! },
    { enabled: !!selectedTraceId }
  );

  const ingestMutation = trpc.tracing.ingestTrace.useMutation({
    onSuccess: () => {
      toast.success("Test trace ingested", { description: "A synthetic trace was submitted for testing." });
      void tracesQuery.refetch();
    },
    onError: (err) => toast.error("Ingest failed", { description: err.message }),
  });

  const handleIngestTest = () => {
    const now = Date.now();
    ingestMutation.mutate({
      spans: [
        {
          traceId: `test-${now}`,
          spanId: `span-${now}`,
          parentSpanId: undefined,
          operationName: "test.operation",
          serviceName: "nexcom-api",
          startTimeMs: now - 120,
          durationMs: 120,
          statusCode: "OK",
        },
      ],
    });
  };

  const handleApplyFilter = () => {
    const parsed = parseInt(minDurationInput, 10);
    setMinDuration(isNaN(parsed) ? undefined : parsed);
  };

  const traces = tracesQuery.data?.traces ?? [];
  const serviceMap = serviceMapQuery.data;
  const services = serviceMap?.services ?? [];
  const operations = serviceMap?.operations ?? [];
  const slowOps = slowOpsQuery.data?.operations ?? [];

  if (tracesQuery.isLoading) return <PageSkeleton cards={2} tableRows={8} tableCols={4} />;
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Distributed Tracing</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Observe request flows, latency hotspots, and service dependencies across the platform.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void tracesQuery.refetch(); void serviceMapQuery.refetch(); void slowOpsQuery.refetch(); }}
            disabled={tracesQuery.isFetching}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${tracesQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={handleIngestTest}
            disabled={ingestMutation.isPending}
          >
            {ingestMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Activity className="h-4 w-4 mr-2" />}
            Ingest Test Trace
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4" /> Total Traces
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground">{tracesQuery.data?.total ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">Showing last {traces.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <GitBranch className="h-4 w-4" /> Services
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground">{services.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Active in last 24h</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" /> Slowest Operation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground">
              {slowOps[0] ? `${slowOps[0].durationMs}ms` : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {slowOps[0]?.operationName ?? "No data yet"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="bg-card border-border">
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Service</label>
              <Select value={serviceFilter} onValueChange={setServiceFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="All services" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All services</SelectItem>
                  {services.map((s) => (
                    <SelectItem key={s.serviceName} value={s.serviceName}>{s.serviceName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Min Duration (ms)</label>
              <div className="flex gap-2">
                <Input
                  className="w-32"
                  placeholder="e.g. 200"
                  value={minDurationInput}
                  onChange={(e) => setMinDurationInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleApplyFilter()}
                />
                <Button variant="outline" size="sm" onClick={handleApplyFilter}>
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {(serviceFilter !== "all" || minDuration !== undefined) && (
              <Button variant="ghost" size="sm" onClick={() => { setServiceFilter("all"); setMinDuration(undefined); setMinDurationInput(""); }}>
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Trace List */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base">Recent Spans</CardTitle>
        </CardHeader>
        <CardContent>
          {tracesQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : traces.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p>No traces recorded yet. Click "Ingest Test Trace" to generate one.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trace ID</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Operation</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {traces.map((t) => (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedTraceId(t.traceId === selectedTraceId ? null : t.traceId)}
                  >
                    <TableCell className="font-mono text-xs text-primary">{t.traceId.slice(0, 16)}…</TableCell>
                    <TableCell className="text-sm">{t.serviceName}</TableCell>
                    <TableCell className="text-sm">{t.operationName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={durationColor(t.durationMs)}>
                        {t.durationMs}ms
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusColor(t.statusCode)}>
                        {t.statusCode}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(t.startTimeMs).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Trace Detail */}
      {selectedTraceId && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Trace Detail
              <span className="font-mono text-xs text-muted-foreground">{selectedTraceId}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {traceDetailQuery.isLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : traceDetailQuery.data ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3 p-3 rounded-md bg-primary/10 border border-primary/30">
                  <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{traceDetailQuery.data.rootSpan.operationName}</p>
                    <p className="text-xs text-muted-foreground">{traceDetailQuery.data.rootSpan.serviceName} (root)</p>
                  </div>
                  <Badge variant="outline" className={durationColor(traceDetailQuery.data.totalDurationMs)}>
                    {traceDetailQuery.data.totalDurationMs}ms total
                  </Badge>
                </div>
                {traceDetailQuery.data.spans.map((span) => (
                  <div key={span.id} className="flex items-center gap-3 p-3 rounded-md bg-muted/30 border border-border ml-4">
                    <div className="w-2 h-2 rounded-full bg-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{span.operationName}</p>
                      <p className="text-xs text-muted-foreground">{span.serviceName}</p>
                    </div>
                    <Badge variant="outline" className={durationColor(span.durationMs)}>
                      {span.durationMs}ms
                    </Badge>
                    <Badge variant="outline" className={statusColor(span.statusCode)}>
                      {span.statusCode}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No detail available.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Service Map */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <GitBranch className="h-4 w-4" /> Service Performance (Last 24h)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {serviceMapQuery.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : services.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-4">No service topology data yet.</p>
          ) : (
            <div className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Spans</TableHead>
                    <TableHead>Errors</TableHead>
                    <TableHead>Avg Duration</TableHead>
                    <TableHead>p99 Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {services.map((s) => (
                    <TableRow key={s.serviceName}>
                      <TableCell className="font-medium">{s.serviceName}</TableCell>
                      <TableCell className="text-sm">{s.spanCount}</TableCell>
                      <TableCell>
                        {s.errorCount > 0 ? (
                          <Badge variant="outline" className="bg-red-500/20 text-red-400 border-red-500/30">{s.errorCount}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">0</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={durationColor(s.avgDurationMs)}>{s.avgDurationMs}ms</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={durationColor(s.p99DurationMs)}>{s.p99DurationMs}ms</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {operations.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2 font-medium">Top Operations:</p>
                  <div className="flex flex-wrap gap-2">
                    {operations.slice(0, 12).map((op, i) => (
                      <span key={i} className="text-xs px-2 py-1 rounded bg-muted/20 border border-border text-muted-foreground">
                        {op.serviceName}/{op.operationName} ({op.callCount}×)
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Slow Operations */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" /> Slowest Spans (&gt;200ms, Last 24h)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {slowOpsQuery.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : slowOps.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-4">No slow operations data yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Operation</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slowOps.map((op) => (
                  <TableRow key={op.id}>
                    <TableCell className="font-mono text-xs">{op.operationName}</TableCell>
                    <TableCell className="text-sm">{op.serviceName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={durationColor(op.durationMs)}>
                        {op.durationMs}ms
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusColor(op.statusCode)}>
                        {op.statusCode}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(op.startTimeMs).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
