/**
 * NEXCOM Exchange — Middleware Health Dashboard
 * Live status cards for all 11 middleware systems with history chart and refresh.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Server,
  XCircle,
  Zap,
} from "lucide-react";

// ── Status helpers ─────────────────────────────────────────────────────────────
function statusColor(status: string) {
  if (status === "healthy") return "text-green-500";
  if (status === "degraded") return "text-yellow-500";
  if (status === "down") return "text-red-500";
  return "text-muted-foreground";
}

function statusBg(status: string) {
  if (status === "healthy") return "bg-green-500/10 border-green-500/20";
  if (status === "degraded") return "bg-yellow-500/10 border-yellow-500/20";
  if (status === "down") return "bg-red-500/10 border-red-500/20";
  return "bg-muted/30 border-border";
}

function StatusIcon({ status }: { status: string }) {
  if (status === "healthy") return <CheckCircle2 className="w-5 h-5 text-green-500" />;
  if (status === "degraded") return <AlertCircle className="w-5 h-5 text-yellow-500" />;
  if (status === "down") return <XCircle className="w-5 h-5 text-red-500" />;
  return <Clock className="w-5 h-5 text-muted-foreground" />;
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "healthy" ? "default" : status === "degraded" ? "secondary" : "destructive";
  return <Badge variant={variant} className="capitalize text-xs">{status}</Badge>;
}

// ── Service card ───────────────────────────────────────────────────────────────
function ServiceCard({
  service,
  label,
  status,
  latencyMs,
  errorMessage,
  checkedAt,
}: {
  service: string;
  label: string;
  status: string;
  latencyMs: number | null;
  errorMessage: string | null;
  checkedAt: Date | null;
}) {
  return (
    <div className={`rounded-lg border p-4 flex flex-col gap-2 ${statusBg(status)}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusIcon status={status} />
          <span className="font-semibold text-sm">{label}</span>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {latencyMs !== null && (
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3" />
            {latencyMs}ms
          </span>
        )}
        {checkedAt && (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {new Date(checkedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
      {errorMessage && (
        <p className="text-xs text-red-400 truncate" title={errorMessage}>
          {errorMessage}
        </p>
      )}
    </div>
  );
}

// ── History panel ──────────────────────────────────────────────────────────────
function HistoryPanel({ service }: { service: string }) {
  const { data, isLoading } = trpc.middlewareHealth.getHealthHistory.useQuery(
    { service, limit: 20 },
    { enabled: !!service }
  );

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading history…</p>;
  if (!data || data.length === 0) return <p className="text-xs text-muted-foreground">No history available.</p>;

  return (
    <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
      {data.map((row) => (
        <div key={row.id} className="flex items-center justify-between text-xs py-1 border-b border-border/40">
          <div className="flex items-center gap-2">
            <StatusIcon status={row.status} />
            <span className={statusColor(row.status)}>{row.status}</span>
          </div>
          <div className="flex items-center gap-3 text-muted-foreground">
            {row.latencyMs !== null && <span>{row.latencyMs}ms</span>}
            <span>{row.checkedAt ? new Date(row.checkedAt).toLocaleString() : "—"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function MiddlewareHealth() {
  const [selectedService, setSelectedService] = useState<string>("all");
  const [historyService, setHistoryService] = useState<string>("");

  const { data: summary, refetch: refetchSummary } = trpc.middlewareHealth.getHealthSummary.useQuery(
    undefined,
    { refetchInterval: 30_000 }
  );

  const { data: services, isLoading, refetch: refetchStatus } = trpc.middlewareHealth.getHealthStatus.useQuery(
    undefined,
    { refetchInterval: 30_000 }
  );

  const triggerCheck = trpc.middlewareHealth.triggerHealthCheck.useMutation({
    onSuccess: () => {
      refetchStatus();
      refetchSummary();
    },
  });

  const serviceList = trpc.middlewareHealth.listServices.useQuery();

  function handleTrigger() {
    triggerCheck.mutate({ service: selectedService as Parameters<typeof triggerCheck.mutate>[0]["service"] });
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Server className="w-6 h-6 text-primary" />
            Middleware Health
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time status for all 11 middleware systems. Auto-refreshes every 30s.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedService} onValueChange={setSelectedService}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Select service" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Services</SelectItem>
              {serviceList.data?.map((s) => (
                <SelectItem key={s.name} value={s.name}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={handleTrigger}
            disabled={triggerCheck.isPending}
            size="sm"
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${triggerCheck.isPending ? "animate-spin" : ""}`} />
            {triggerCheck.isPending ? "Checking…" : "Run Check"}
          </Button>
        </div>
      </div>

      {/* Summary bar */}
      {summary && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total", value: summary.total, color: "text-foreground", icon: Activity },
            { label: "Healthy", value: summary.healthy, color: "text-green-500", icon: CheckCircle2 },
            { label: "Degraded", value: summary.degraded, color: "text-yellow-500", icon: AlertCircle },
            { label: "Down / Unknown", value: summary.down + summary.unknown, color: "text-red-500", icon: XCircle },
          ].map(({ label, value, color, icon: Icon }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
                <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Service cards grid */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Service Status
        </h2>
        {isLoading ? (
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 11 }).map((_, i) => (
              <div key={i} className="rounded-lg border p-4 animate-pulse bg-muted/20 h-24" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {(services ?? []).map((svc) => (
              <div
                key={svc.service}
                className="cursor-pointer"
                onClick={() => setHistoryService(svc.service === historyService ? "" : svc.service)}
              >
                <ServiceCard
                  service={svc.service}
                  label={svc.label}
                  status={svc.status}
                  latencyMs={svc.latencyMs}
                  errorMessage={svc.errorMessage}
                  checkedAt={svc.checkedAt}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* History panel */}
      {historyService && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              History — {serviceList.data?.find((s) => s.name === historyService)?.label ?? historyService}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HistoryPanel service={historyService} />
          </CardContent>
        </Card>
      )}

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-muted-foreground pt-2 border-t border-border">
        <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-500" /> Healthy — responding within 3s</span>
        <span className="flex items-center gap-1"><AlertCircle className="w-3 h-3 text-yellow-500" /> Degraded — non-200 or slow</span>
        <span className="flex items-center gap-1"><XCircle className="w-3 h-3 text-red-500" /> Down — connection refused or timeout</span>
        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Unknown — no check run yet</span>
      </div>
    </div>
  );
}
