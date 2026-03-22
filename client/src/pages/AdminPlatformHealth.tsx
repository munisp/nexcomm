/**
 * NEXCOM Exchange — Admin Platform Health Dashboard
 *
 * Shows the live status of all native services:
 *   - Rust Matching Engine (port 8080)
 *   - Rust Settlement Engine (port 8005)
 *   - Go Gateway Service (port 8200)
 *   - TigerBeetle, Kafka, Redis, Temporal, Dapr, Fluvio (via gateway)
 */
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle,
  XCircle,
  RefreshCw,
  Server,
  Database,
  Activity,
  Zap,
  Shield,
  GitBranch,
  Clock,
  AlertTriangle,
  Terminal,
  Copy,
  CheckCheck,
  Bell,
  ExternalLink,
  Users,
  Siren,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

function StatusBadge({ online }: { online: boolean }) {
  return online ? (
    <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 gap-1">
      <CheckCircle className="w-3 h-3" />
      Online
    </Badge>
  ) : (
    <Badge className="bg-red-500/15 text-red-400 border-red-500/30 gap-1">
      <XCircle className="w-3 h-3" />
      Offline
    </Badge>
  );
}

function MiddlewareRow({
  icon: Icon,
  name,
  connected,
  description,
}: {
  icon: React.ElementType;
  name: string;
  connected: boolean;
  description: string;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border/50 last:border-0">
      <div className="flex items-center gap-3">
        <div className={`p-1.5 rounded-md ${connected ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
          <Icon className={`w-4 h-4 ${connected ? "text-emerald-400" : "text-red-400"}`} />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{name}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <StatusBadge online={connected} />
    </div>
  );
}

// ── HA status badge ──────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  HEALTHY: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  DEGRADED: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  STARTING: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  UNAVAILABLE: "bg-red-500/15 text-red-400 border-red-500/30",
  RATE_LIMITED: "bg-red-600/15 text-red-500 border-red-600/30",
  REBUILDING: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  STOPPED: "bg-gray-500/15 text-gray-400 border-gray-500/30",
};

function HAStatusBadge({ status }: { status: string }) {
  return (
    <Badge className={STATUS_COLORS[status] ?? STATUS_COLORS.STOPPED}>
      {status}
    </Badge>
  );
}

// ── Grafana OnCall Panel ─────────────────────────────────────────────────────
const ONCALL_STEPS = [
  { id: 1, label: "Deploy Grafana OnCall", cmd: "kubectl apply -f infra/security/grafana-oncall/" },
  { id: 2, label: "Create Webhook integration", cmd: "Open https://grafana.nexcom.exchange → OnCall → Integrations → New → Webhook" },
  { id: 3, label: "Update webhook token", cmd: "kubectl edit secret wazuh-oncall-token -n wazuh" },
  { id: 4, label: "Restart Wazuh", cmd: "kubectl rollout restart statefulset/wazuh-manager -n wazuh" },
  { id: 5, label: "Seed escalation policies", cmd: "kubectl exec -n monitoring deploy/grafana-oncall-engine -- python manage.py shell < infra/security/grafana-oncall/05-escalation-policy.yaml" },
];

function GrafanaOnCallPanel() {
  const [copied, setCopied] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  function copyCmd(id: number, cmd: string) {
    navigator.clipboard.writeText(cmd);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <Card className="border-border/50 bg-muted/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Bell className="w-4 h-4 text-violet-400" />
            Grafana OnCall — Open-Source Incident Alerting
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/30 gap-1">
              <Siren className="w-3 h-3" />
              Replaces PagerDuty
            </Badge>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExpanded(e => !e)}>
              {expanded ? "Hide" : "Setup Guide"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Status summary */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-muted/40 rounded-lg p-3 text-center">
            <Bell className="w-5 h-5 text-violet-400 mx-auto mb-1" />
            <p className="text-xs font-medium text-foreground">On-Call Alerts</p>
            <p className="text-xs text-muted-foreground mt-0.5">Level 7+ → OnCall</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-3 text-center">
            <Siren className="w-5 h-5 text-red-400 mx-auto mb-1" />
            <p className="text-xs font-medium text-foreground">Escalation</p>
            <p className="text-xs text-muted-foreground mt-0.5">P0/P1 → 5 min → team</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-3 text-center">
            <Users className="w-5 h-5 text-emerald-400 mx-auto mb-1" />
            <p className="text-xs font-medium text-foreground">Mobile Push</p>
            <p className="text-xs text-muted-foreground mt-0.5">iOS + Android app</p>
          </div>
        </div>

        {/* Quick links */}
        <div className="flex flex-wrap gap-2">
          <a
            href="https://grafana.nexcom.exchange"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 bg-violet-500/10 hover:bg-violet-500/15 border border-violet-500/20 rounded-md px-3 py-1.5 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Open Grafana
          </a>
          <a
            href="https://oncall.nexcom.exchange"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/15 border border-blue-500/20 rounded-md px-3 py-1.5 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Open OnCall
          </a>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 border border-border/50 rounded-md px-3 py-1.5">
            <Shield className="w-3 h-3" />
            infra/security/grafana-oncall/
          </span>
        </div>

        {/* Setup steps (expandable) */}
        {expanded && (
          <div className="space-y-2 border border-border/50 rounded-lg p-3">
            <p className="text-xs font-semibold text-foreground mb-2">Deployment Checklist</p>
            {ONCALL_STEPS.map(step => (
              <div key={step.id} className="flex items-start gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full bg-violet-500/20 text-violet-400 text-xs flex items-center justify-center font-medium">{step.id}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">{step.label}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <code className="text-xs font-mono text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5 flex-1 truncate">{step.cmd}</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 shrink-0"
                      onClick={() => copyCmd(step.id, step.cmd)}
                    >
                      {copied === step.id ? <CheckCheck className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            <Separator className="my-2" />
            <p className="text-xs text-muted-foreground">
              Full deployment guide: <code className="font-mono bg-muted/40 px-1 rounded">infra/security/grafana-oncall/README.md</code>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── KEDA Config Panel ────────────────────────────────────────────────────────
function KedaConfigPanel() {
  const { data, isLoading, refetch } = trpc.engineHA.getKedaConfig.useQuery(undefined, {
    retry: false,
    refetchInterval: 30_000,
  });
  const updateMutation = trpc.engineHA.updateKedaConfig.useMutation({
    onSuccess: () => refetch(),
  });
  const [editMode, setEditMode] = useState(false);
  const [kafkaBrokers, setKafkaBrokers] = useState("");
  const [redisUrl, setRedisUrl] = useState("");
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!data?.bootstrapCommands) return;
    navigator.clipboard.writeText(data.bootstrapCommands.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleSave() {
    if (!kafkaBrokers || !redisUrl) return;
    updateMutation.mutate({ kafkaBrokers, redisUrl });
    setEditMode(false);
  }

  if (isLoading) return null;

  return (
    <Card className="border-border/50 bg-muted/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Terminal className="w-4 h-4" />
            KEDA Autoscaling — Kafka &amp; Redis Wiring
          </CardTitle>
          <div className="flex gap-2">
            {data?.kedaReady ? (
              <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 gap-1">
                <CheckCircle className="w-3 h-3" /> Wired
              </Badge>
            ) : (
              <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 gap-1">
                <AlertTriangle className="w-3 h-3" /> Using Defaults
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => { setKafkaBrokers(data?.kafkaBrokers ?? ""); setRedisUrl(data?.redisUrl ?? ""); setEditMode(true); }}>
              Configure
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-muted-foreground mb-0.5">Kafka Brokers</p>
            <p className="font-mono text-foreground bg-muted/40 rounded px-2 py-1 truncate">{data?.kafkaBrokers}</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-0.5">Redis URL</p>
            <p className="font-mono text-foreground bg-muted/40 rounded px-2 py-1 truncate">{data?.redisUrl}</p>
          </div>
        </div>

        {editMode && (
          <div className="space-y-2 border border-border/50 rounded-lg p-3">
            <p className="text-xs font-medium text-foreground">Update Runtime Config</p>
            <div>
              <label className="text-xs text-muted-foreground">Kafka Brokers (comma-separated)</label>
              <input
                className="w-full mt-1 px-2 py-1.5 text-xs rounded bg-muted border border-border text-foreground font-mono"
                value={kafkaBrokers}
                onChange={e => setKafkaBrokers(e.target.value)}
                placeholder="broker1:9092,broker2:9092,broker3:9092"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Redis URL</label>
              <input
                className="w-full mt-1 px-2 py-1.5 text-xs rounded bg-muted border border-border text-foreground font-mono"
                value={redisUrl}
                onChange={e => setRedisUrl(e.target.value)}
                placeholder="redis://:password@host:6379"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>Save</Button>
              <Button size="sm" variant="outline" onClick={() => setEditMode(false)}>Cancel</Button>
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-muted-foreground">kubectl Bootstrap Commands</p>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleCopy}>
              {copied ? <><CheckCheck className="w-3 h-3 mr-1" />Copied</> : <><Copy className="w-3 h-3 mr-1" />Copy</>}
            </Button>
          </div>
          <pre className="text-xs font-mono bg-muted/40 rounded-lg p-3 overflow-x-auto text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {data?.bootstrapCommands?.join("\n")}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminPlatformHealth() {
  const [, navigate] = useLocation();
  const [refetchKey, setRefetchKey] = useState(0);
  const { data: haData, isLoading: haLoading } = trpc.engineHA.getStatus.useQuery(undefined, {
    refetchInterval: 10_000,
    staleTime: 5_000,
    retry: false,
  });
  const { data, isLoading, refetch } = trpc.system.platformHealth.useQuery(undefined, {
    refetchInterval: 30_000, // Auto-refresh every 30s
    staleTime: 15_000,
  });

  const handleRefresh = () => {
    setRefetchKey(k => k + 1);
    refetch();
  };

  const services = data?.services;
  const middleware = data?.middleware;

  const allServicesOnline =
    services?.matchingEngine.status === "online" &&
    services?.gateway.status === "online";

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Platform Health</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live status of all native services and middleware
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!isLoading && (
            <Badge
              className={
                allServicesOnline
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                  : "bg-amber-500/15 text-amber-400 border-amber-500/30"
              }
            >
              {allServicesOnline ? "All Systems Operational" : "Partial Degradation"}
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Core Services */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Rust Matching Engine */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              Matching Engine
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="h-6 bg-muted/50 rounded animate-pulse" />
            ) : (
              <StatusBadge online={services?.matchingEngine.status === "online"} />
            )}
            <div className="text-xs text-muted-foreground space-y-1">
              <div className="flex justify-between">
                <span>Language</span>
                <span className="text-foreground font-mono">Rust</span>
              </div>
              <div className="flex justify-between">
                <span>Port</span>
                <span className="text-foreground font-mono">8080</span>
              </div>
              <div className="flex justify-between">
                <span>Algorithm</span>
                <span className="text-foreground">Price-Time Priority</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground border-t border-border/50 pt-2">
              {services?.matchingEngine.description}
            </p>
          </CardContent>
        </Card>

        {/* Rust Settlement Engine */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-blue-400" />
              Settlement Engine
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="h-6 bg-muted/50 rounded animate-pulse" />
            ) : (
              <StatusBadge online={services?.settlementEngine.status === "online"} />
            )}
            <div className="text-xs text-muted-foreground space-y-1">
              <div className="flex justify-between">
                <span>Language</span>
                <span className="text-foreground font-mono">Rust</span>
              </div>
              <div className="flex justify-between">
                <span>Port</span>
                <span className="text-foreground font-mono">8005</span>
              </div>
              <div className="flex justify-between">
                <span>Ledger</span>
                <span className="text-foreground">TigerBeetle</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground border-t border-border/50 pt-2">
              {services?.settlementEngine.description}
            </p>
          </CardContent>
        </Card>

        {/* Go Gateway */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Server className="w-4 h-4 text-cyan-400" />
              Go Gateway
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="h-6 bg-muted/50 rounded animate-pulse" />
            ) : (
              <StatusBadge online={services?.gateway.status === "online"} />
            )}
            <div className="text-xs text-muted-foreground space-y-1">
              <div className="flex justify-between">
                <span>Language</span>
                <span className="text-foreground font-mono">Go 1.22</span>
              </div>
              <div className="flex justify-between">
                <span>Port</span>
                <span className="text-foreground font-mono">8200</span>
              </div>
              {services?.gateway.version && (
                <div className="flex justify-between">
                  <span>Version</span>
                  <span className="text-foreground font-mono">{services.gateway.version}</span>
                </div>
              )}
              {services?.gateway.uptime && (
                <div className="flex justify-between">
                  <span>Since</span>
                  <span className="text-foreground font-mono text-[10px]">
                    {new Date(services.gateway.uptime).toLocaleTimeString()}
                  </span>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground border-t border-border/50 pt-2">
              {services?.gateway.description}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Middleware Status */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-4 h-4 text-purple-400" />
            Middleware Status
            <span className="text-xs text-muted-foreground font-normal ml-1">
              (via Go Gateway)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="h-10 bg-muted/50 rounded animate-pulse" />
              ))}
            </div>
          ) : middleware ? (
            <div>
              <MiddlewareRow
                icon={Database}
                name="TigerBeetle"
                connected={middleware.tigerbeetle.connected}
                description={middleware.tigerbeetle.description}
              />
              <MiddlewareRow
                icon={Activity}
                name="Apache Kafka"
                connected={middleware.kafka.connected}
                description={middleware.kafka.description}
              />
              <MiddlewareRow
                icon={Zap}
                name="Redis"
                connected={middleware.redis.connected}
                description={middleware.redis.description}
              />
              <MiddlewareRow
                icon={Clock}
                name="Temporal"
                connected={middleware.temporal.connected}
                description={middleware.temporal.description}
              />
              <MiddlewareRow
                icon={Server}
                name="Dapr"
                connected={middleware.dapr.connected}
                description={middleware.dapr.description}
              />
              <MiddlewareRow
                icon={Shield}
                name="Fluvio"
                connected={middleware.fluvio.connected}
                description={middleware.fluvio.description}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2 text-amber-400 text-sm py-4">
              <AlertTriangle className="w-4 h-4" />
              Go gateway offline — middleware status unavailable
            </div>
          )}
        </CardContent>
      </Card>

      {/* Exchange Status */}
      {data?.exchangeStatus && (
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              Exchange Status
              <span className="text-xs text-muted-foreground font-normal ml-1">
                (from Rust Matching Engine)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs text-muted-foreground bg-muted/30 rounded p-3 overflow-auto max-h-48">
              {JSON.stringify(data.exchangeStatus, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* HA Engine Status */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-4 h-4 text-violet-400" />
            Engine HA Status
            <span className="text-xs text-muted-foreground font-normal ml-1">
              (watchdog · circuit breaker · auto-restart)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {haLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-12 bg-muted/50 rounded animate-pulse" />
              ))}
            </div>
          ) : haData && haData.length > 0 ? (
            <div className="space-y-0">
              {haData.map((engine) => (
                <div
                  key={engine.name}
                  className="flex items-center justify-between py-3 border-b border-border/50 last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-1.5 rounded-md ${
                      engine.status === "HEALTHY" ? "bg-emerald-500/10" :
                      engine.status === "DEGRADED" ? "bg-amber-500/10" :
                      engine.status === "RATE_LIMITED" ? "bg-red-600/10" :
                      "bg-red-500/10"
                    }`}>
                      <Server className={`w-4 h-4 ${
                        engine.status === "HEALTHY" ? "text-emerald-400" :
                        engine.status === "DEGRADED" ? "text-amber-400" :
                        engine.status === "RATE_LIMITED" ? "text-red-500" :
                        "text-red-400"
                      }`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{engine.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Port {engine.port}
                        {engine.pid ? ` · PID ${engine.pid}` : ""}
                        {engine.restartCount > 0 ? ` · ${engine.restartCount} restart${engine.restartCount !== 1 ? "s" : ""}` : ""}
                        {engine.uptimeMs ? ` · up ${Math.round(engine.uptimeMs / 1000)}s` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {engine.circuitOpenUntil && (
                      <span className="text-xs text-red-400">
                        CB open until {new Date(engine.circuitOpenUntil).toLocaleTimeString()}
                      </span>
                    )}
                    <HAStatusBadge status={engine.status} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-amber-400 text-sm py-4">
              <AlertTriangle className="w-4 h-4" />
              HA status unavailable (admin access required)
            </div>
          )}
        </CardContent>
      </Card>

      {/* KEDA / Kafka Wiring Panel */}
      <KedaConfigPanel />

      {/* Grafana OnCall Panel */}
      <GrafanaOnCallPanel />

      {/* FIX Gateway Admin Link */}
      <Card className="border-border/50 bg-muted/20">
        <CardContent className="pt-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">FIX 4.4 Protocol Gateway</p>
            <p className="text-xs text-muted-foreground mt-0.5">Monitor FIX sessions, send test messages, and inspect message logs</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate("/admin/fix-gateway")} className="shrink-0">
            Open FIX Gateway
          </Button>
        </CardContent>
      </Card>

      {/* Architecture Note */}
      <Card className="border-border/50 bg-muted/20">
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Architecture:</strong> The NEXCOM portal runs three native service processes alongside the Node.js server.
            The <strong className="text-foreground">Rust Matching Engine</strong> provides sub-millisecond price-time priority order matching with partial fills, IOC/FOK enforcement, and circuit breakers.
            The <strong className="text-foreground">Go Gateway</strong> wraps the TigerBeetle double-entry ledger (trade settlement, margin holds, fee collection) plus Kafka event streaming, Redis caching, and Temporal workflow orchestration — all with graceful in-memory fallbacks.
            The <strong className="text-foreground">Rust Settlement Engine</strong> handles T+2 DVP settlement with Mojaloop integration.
            All three binaries are spawned automatically on server startup and restart on crash.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
