/**
 * NEXCOM Exchange — Microservices Health Dashboard
 * Real-time health status, latency, and operational metrics for all 8 backend microservices.
 * Admin-only page.
 */
import { useState, useEffect, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Activity, Shield, Brain, Lock, Zap, Bell, Search,
  Network, Bot, RefreshCw, CheckCircle2, XCircle, AlertCircle,
  Clock, Server, TrendingUp, ToggleLeft, ToggleRight, Ban, Unlock
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ServiceConfig {
  key: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  healthQuery: string;
}

const SERVICES: ServiceConfig[] = [
  {
    key: "creditScoring",
    label: "Credit Scoring",
    description: "NEXCOM Agri credit model — scores farmers and traders",
    icon: TrendingUp,
    color: "text-emerald-400",
    healthQuery: "creditScoring.health",
  },
  {
    key: "fraudEngine",
    label: "Fraud Engine",
    description: "Real-time transaction fraud detection (Python/ML)",
    icon: Shield,
    color: "text-red-400",
    healthQuery: "fraudEngine.health",
  },
  {
    key: "cryptoGuard",
    label: "Crypto Guard",
    description: "Cryptographic key management and HSM operations (Rust)",
    icon: Lock,
    color: "text-purple-400",
    healthQuery: "cryptoGuard.health",
  },
  {
    key: "ddosGuard",
    label: "DDoS Guard",
    description: "Rate limiting and DDoS mitigation (Go)",
    icon: Zap,
    color: "text-yellow-400",
    healthQuery: "ddosGuard.health",
  },
  {
    key: "amlAlertSubscriber",
    label: "AML Alerts",
    description: "Anti-money laundering alert subscriber (Go)",
    icon: Bell,
    color: "text-orange-400",
    healthQuery: "amlAlertSubscriber.health",
  },
  {
    key: "opensearchSync",
    label: "OpenSearch Sync",
    description: "Full-text search index synchronisation (Go)",
    icon: Search,
    color: "text-blue-400",
    healthQuery: "opensearchSync.health",
  },
  {
    key: "middlewareHub",
    label: "Middleware Hub",
    description: "API gateway and service mesh orchestration (Go)",
    icon: Network,
    color: "text-cyan-400",
    healthQuery: "middlewareHub.health",
  },
  {
    key: "botLogic",
    label: "Bot Logic",
    description: "Automated trading bot engine (Python)",
    icon: Bot,
    color: "text-pink-400",
    healthQuery: "botLogic.health",
  },
];

// ── Status helpers ────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string | undefined }) {
  if (!status) return <Badge variant="secondary">Unknown</Badge>;
  if (status === "ok" || status === "healthy" || status === "running") {
    return <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">Healthy</Badge>;
  }
  if (status === "unavailable" || status === "error") {
    return <Badge variant="destructive">Unavailable</Badge>;
  }
  return <Badge variant="secondary">{status}</Badge>;
}

function StatusIcon({ status }: { status: string | undefined }) {
  if (!status) return <AlertCircle className="h-5 w-5 text-muted-foreground" />;
  if (status === "ok" || status === "healthy" || status === "running") {
    return <CheckCircle2 className="h-5 w-5 text-emerald-400" />;
  }
  if (status === "unavailable" || status === "error") {
    return <XCircle className="h-5 w-5 text-red-400" />;
  }
  return <AlertCircle className="h-5 w-5 text-yellow-400" />;
}

// ── Individual Service Card ───────────────────────────────────────────────────
function ServiceCard({ svc, latency }: { svc: ServiceConfig; latency: number | null }) {
  const Icon = svc.icon;

  // Use the appropriate health query for each service
  const creditHealth = trpc.microservices.creditScoring.health.useQuery(undefined, {
    enabled: svc.key === "creditScoring",
    refetchInterval: 30_000,
  });
  const fraudHealth = trpc.microservices.fraudEngine.health.useQuery(undefined, {
    enabled: svc.key === "fraudEngine",
    refetchInterval: 30_000,
  });
  const cryptoHealth = trpc.microservices.cryptoGuard.health.useQuery(undefined, {
    enabled: svc.key === "cryptoGuard",
    refetchInterval: 30_000,
  });
  const ddosHealth = trpc.microservices.ddosGuard.health.useQuery(undefined, {
    enabled: svc.key === "ddosGuard",
    refetchInterval: 30_000,
  });
  const amlHealth = trpc.microservices.amlAlertSubscriber.health.useQuery(undefined, {
    enabled: svc.key === "amlAlertSubscriber",
    refetchInterval: 30_000,
  });
  const opensearchHealth = trpc.microservices.opensearchSync.health.useQuery(undefined, {
    enabled: svc.key === "opensearchSync",
    refetchInterval: 30_000,
  });
  const middlewareHealth = trpc.microservices.middlewareHub.health.useQuery(undefined, {
    enabled: svc.key === "middlewareHub",
    refetchInterval: 30_000,
  });
  const botHealth = trpc.microservices.botLogic.health.useQuery(undefined, {
    enabled: svc.key === "botLogic",
    refetchInterval: 30_000,
  });

  const healthMap: Record<string, { data: unknown; isLoading: boolean; isFetching: boolean }> = {
    creditScoring: creditHealth,
    fraudEngine: fraudHealth,
    cryptoGuard: cryptoHealth,
    ddosGuard: ddosHealth,
    amlAlertSubscriber: amlHealth,
    opensearchSync: opensearchHealth,
    middlewareHub: middlewareHealth,
    botLogic: botHealth,
  };

  const { data, isLoading, isFetching } = healthMap[svc.key];
  const health = data as { status?: string; activeBots?: number; error?: string } | undefined;
  const status = health?.status;

  return (
    <Card className="bg-card border-border hover:border-border/80 transition-colors">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg bg-muted/30 ${svc.color}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold text-foreground">{svc.label}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{svc.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isFetching && <RefreshCw className="h-3 w-3 text-muted-foreground animate-spin" />}
            <StatusIcon status={status} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <StatusBadge status={status} />
          {latency !== null && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{latency}ms</span>
            </div>
          )}
        </div>

        {isLoading && (
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary/50 animate-pulse rounded-full" style={{ width: "60%" }} />
          </div>
        )}

        {health?.error && (
          <p className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1 truncate">
            {health.error}
          </p>
        )}

        {health?.activeBots !== undefined && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Bot className="h-3 w-3" />
            <span>{health.activeBots} active bots</span>
          </div>
        )}

        {/* Uptime bar — visual only, based on status */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Availability</span>
            <span>{status === "ok" || status === "healthy" || status === "running" ? "100%" : "0%"}</span>
          </div>
          <Progress
            value={status === "ok" || status === "healthy" || status === "running" ? 100 : 0}
            className="h-1"
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Fraud Engine Stats ────────────────────────────────────────────────────────
function FraudEngineStats() {
  const { data } = trpc.microservices.fraudEngine.getStats.useQuery();
  if (!data) return null;
  const d = data as { available?: boolean; stats?: Record<string, unknown> };
  const stats = d.stats ?? {};
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Object.entries(stats).slice(0, 8).map(([k, v]) => (
        <div key={k} className="bg-muted/30 rounded-lg p-3">
          <p className="text-xs text-muted-foreground capitalize">{k.replace(/_/g, " ")}</p>
          <p className="text-sm font-semibold text-foreground mt-1">{String(v)}</p>
        </div>
      ))}
    </div>
  );
}

// ── DDoS Guard Stats ──────────────────────────────────────────────────────────
function DdosGuardStats() {
  const { data } = trpc.microservices.ddosGuard.getStats.useQuery();
  if (!data) return null;
  const stats = data as Record<string, unknown>;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Object.entries(stats).slice(0, 8).map(([k, v]) => (
        <div key={k} className="bg-muted/30 rounded-lg p-3">
          <p className="text-xs text-muted-foreground capitalize">{k.replace(/_/g, " ")}</p>
          <p className="text-sm font-semibold text-foreground mt-1">{String(v)}</p>
        </div>
      ))}
    </div>
  );
}

// ── Credit Scoring Metrics ────────────────────────────────────────────────────
function CreditScoringMetrics() {
  const { data } = trpc.microservices.creditScoring.getModelMetrics.useQuery();
  if (!data || !(data as { available?: boolean }).available) return null;
  const metrics = data as { models?: unknown[] };
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">Model Performance</p>
      {(metrics.models ?? []).map((m: unknown, i: number) => {
        const model = m as Record<string, unknown>;
        return (
          <div key={i} className="bg-muted/30 rounded-lg p-3 grid grid-cols-3 gap-3">
            {Object.entries(model).slice(0, 6).map(([k, v]) => (
              <div key={k}>
                <p className="text-xs text-muted-foreground capitalize">{k.replace(/_/g, " ")}</p>
                <p className="text-sm font-medium text-foreground">{String(v)}</p>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Middleware Hub Metrics ────────────────────────────────────────────────────
function MiddlewareHubMetrics() {
  const { data } = trpc.microservices.middlewareHub.getMetrics.useQuery();
  if (!data || !(data as { available?: boolean }).available) return null;
  const metrics = data as Record<string, unknown>;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Object.entries(metrics).filter(([k]) => k !== "available").slice(0, 8).map(([k, v]) => (
        <div key={k} className="bg-muted/30 rounded-lg p-3">
          <p className="text-xs text-muted-foreground capitalize">{k.replace(/_/g, " ")}</p>
          <p className="text-sm font-semibold text-foreground mt-1">{String(v)}</p>
        </div>
      ))}
    </div>
  );
}

// ── AML Metrics ───────────────────────────────────────────────────────────────
function AmlMetrics() {
  const { data } = trpc.microservices.amlAlertSubscriber.getMetrics.useQuery();
  if (!data) return null;
  const metrics = data as Record<string, unknown>;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Object.entries(metrics).filter(([k]) => k !== "available").slice(0, 8).map(([k, v]) => (
        <div key={k} className="bg-muted/30 rounded-lg p-3">
          <p className="text-xs text-muted-foreground capitalize">{k.replace(/_/g, " ")}</p>
          <p className="text-sm font-semibold text-foreground mt-1">{String(v)}</p>
        </div>
      ))}
    </div>
  );
}

// ── Circuit Breaker Controls ─────────────────────────────────────────────────
function CircuitBreakerControls() {
  const utils = trpc.useUtils();
  const { data: circuitBreakers } = trpc.microservices.middlewareHub.getCircuitBreakers.useQuery();
  const { data: blockedIPs } = trpc.microservices.ddosGuard.getBlockedIPs.useQuery({ limit: 20 });
  const { data: ddosRules } = trpc.microservices.ddosGuard.getRules.useQuery();
  const [newIp, setNewIp] = useState("");
  const [blockReason, setBlockReason] = useState("");

  const resetCBMut = trpc.microservices.middlewareHub.resetCircuitBreaker.useMutation({
    onSuccess: () => { utils.microservices.middlewareHub.getCircuitBreakers.invalidate(); toast.success("Circuit breaker reset"); },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const blockIPMut = trpc.microservices.ddosGuard.blockIP.useMutation({
    onSuccess: () => { utils.microservices.ddosGuard.getBlockedIPs.invalidate(); toast.success("IP blocked"); setNewIp(""); setBlockReason(""); },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const unblockIPMut = trpc.microservices.ddosGuard.unblockIP.useMutation({
    onSuccess: () => { utils.microservices.ddosGuard.getBlockedIPs.invalidate(); toast.success("IP unblocked"); },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const cbs = circuitBreakers as { breakers?: Array<{ service: string; state: string; failureCount: number; lastFailure?: string }> } | undefined;
  const ips = blockedIPs as { ips?: Array<{ ip: string; reason?: string; blockedAt?: string }> } | undefined;
  const rules = ddosRules as { rules?: Array<{ name: string; enabled: boolean; threshold: number; windowSeconds: number }> } | undefined;

  return (
    <div className="space-y-6">
      {/* Circuit Breakers */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Network className="h-4 w-4 text-cyan-400" /> Middleware Hub — Circuit Breakers
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!cbs?.breakers?.length ? (
            <p className="text-xs text-muted-foreground">No circuit breaker data available (service may be offline)</p>
          ) : (
            <div className="space-y-2">
              {cbs.breakers.map(cb => (
                <div key={cb.service} className="flex items-center justify-between bg-muted/20 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">{cb.service}</p>
                    <p className="text-xs text-muted-foreground">Failures: {cb.failureCount}{cb.lastFailure ? ` · Last: ${new Date(cb.lastFailure).toLocaleTimeString()}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={cb.state === "closed" ? "bg-emerald-500/20 text-emerald-300" : cb.state === "open" ? "bg-red-500/20 text-red-300" : "bg-yellow-500/20 text-yellow-300"}>
                      {cb.state}
                    </Badge>
                    {cb.state !== "closed" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => resetCBMut.mutate({ breakerName: cb.service })} disabled={resetCBMut.isPending}>
                        <RefreshCw className="h-3 w-3 mr-1" /> Reset
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* DDoS Rules */}
      {rules?.rules && rules.rules.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Zap className="h-4 w-4 text-yellow-400" /> DDoS Guard — Rate Limit Rules
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {rules.rules.map(rule => (
                <div key={rule.name} className="flex items-center justify-between bg-muted/20 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">{rule.name}</p>
                    <p className="text-xs text-muted-foreground">{rule.threshold} req / {rule.windowSeconds}s window</p>
                  </div>
                  <Badge className={rule.enabled ? "bg-emerald-500/20 text-emerald-300" : "bg-gray-500/20 text-muted-foreground"}>
                    {rule.enabled ? "Active" : "Disabled"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Blocked IPs */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Ban className="h-4 w-4 text-red-400" /> DDoS Guard — IP Block List
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="IP address (e.g. 1.2.3.4)"
              value={newIp}
              onChange={e => setNewIp(e.target.value)}
              className="h-8 text-sm flex-1"
            />
            <Input
              placeholder="Reason (optional)"
              value={blockReason}
              onChange={e => setBlockReason(e.target.value)}
              className="h-8 text-sm flex-1"
            />
            <Button size="sm" className="h-8" onClick={() => blockIPMut.mutate({ ip: newIp, reason: blockReason || "No reason provided" })} disabled={!newIp || blockIPMut.isPending}>
              <Ban className="h-3 w-3 mr-1" /> Block
            </Button>
          </div>
          {!ips?.ips?.length ? (
            <p className="text-xs text-muted-foreground">No blocked IPs (service may be offline)</p>
          ) : (
            <div className="space-y-1">
              {ips.ips.map(entry => (
                <div key={entry.ip} className="flex items-center justify-between bg-muted/20 rounded px-3 py-1.5">
                  <div>
                    <span className="text-sm font-mono text-foreground">{entry.ip}</span>
                    {entry.reason && <span className="text-xs text-muted-foreground ml-2">{entry.reason}</span>}
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 text-xs text-red-400 hover:text-red-300" onClick={() => unblockIPMut.mutate({ ip: entry.ip })} disabled={unblockIPMut.isPending}>
                    <Unlock className="h-3 w-3 mr-1" /> Unblock
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function MicroservicesHealth() {
  const [latencies, setLatencies] = useState<Record<string, number | null>>({});
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const utils = trpc.useUtils();

  // Measure latency by timing health query calls
  const measureLatency = useCallback(async () => {
    const results: Record<string, number | null> = {};
    for (const svc of SERVICES) {
      const start = Date.now();
      try {
        await fetch(`/api/trpc/microservices.${svc.key}.health?batch=1&input=%7B%7D`);
        results[svc.key] = Date.now() - start;
      } catch {
        results[svc.key] = null;
      }
    }
    setLatencies(results);
    setLastRefresh(new Date());
  }, []);

  useEffect(() => {
    measureLatency();
    const interval = setInterval(measureLatency, 60_000);
    return () => clearInterval(interval);
  }, [measureLatency]);

  const handleRefreshAll = () => {
    utils.microservices.creditScoring.health.invalidate();
    utils.microservices.fraudEngine.health.invalidate();
    utils.microservices.cryptoGuard.health.invalidate();
    utils.microservices.ddosGuard.health.invalidate();
    utils.microservices.amlAlertSubscriber.health.invalidate();
    utils.microservices.opensearchSync.health.invalidate();
    utils.microservices.middlewareHub.health.invalidate();
    utils.microservices.botLogic.health.invalidate();
    measureLatency();
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
              <Server className="h-6 w-6 text-primary" />
              Microservices Health
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Real-time status and metrics for all 8 NEXCOM backend microservices
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              Last refresh: {lastRefresh.toLocaleTimeString()}
            </span>
            <Button size="sm" variant="outline" className="gap-2" onClick={handleRefreshAll}>
              <RefreshCw className="h-4 w-4" /> Refresh All
            </Button>
          </div>
        </div>

        {/* Summary Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-card border-border">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-3">
                <Activity className="h-5 w-5 text-emerald-400" />
                <div>
                  <p className="text-xs text-muted-foreground">Total Services</p>
                  <p className="text-xl font-bold text-foreground">8</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <div>
                  <p className="text-xs text-muted-foreground">Monitored</p>
                  <p className="text-xl font-bold text-foreground">8</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-blue-400" />
                <div>
                  <p className="text-xs text-muted-foreground">Avg Latency</p>
                  <p className="text-xl font-bold text-foreground">
                    {Object.values(latencies).filter(Boolean).length > 0
                      ? `${Math.round(Object.values(latencies).filter((v): v is number => v !== null).reduce((a, b) => a + b, 0) / Object.values(latencies).filter(Boolean).length)}ms`
                      : "—"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-3">
                <RefreshCw className="h-5 w-5 text-yellow-400" />
                <div>
                  <p className="text-xs text-muted-foreground">Poll Interval</p>
                  <p className="text-xl font-bold text-foreground">30s</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Service Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {SERVICES.map(svc => (
            <ServiceCard key={svc.key} svc={svc} latency={latencies[svc.key] ?? null} />
          ))}
        </div>

        {/* Detailed Metrics Tabs */}
        <Tabs defaultValue="fraud">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="fraud">Fraud Engine</TabsTrigger>
            <TabsTrigger value="ddos">DDoS Guard</TabsTrigger>
            <TabsTrigger value="credit">Credit Scoring</TabsTrigger>
            <TabsTrigger value="middleware">Middleware Hub</TabsTrigger>
            <TabsTrigger value="controls">Circuit Breakers</TabsTrigger>
          </TabsList>

          <TabsContent value="fraud" className="mt-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Shield className="h-4 w-4 text-red-400" /> Fraud Engine — Live Statistics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FraudEngineStats />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ddos" className="mt-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Zap className="h-4 w-4 text-yellow-400" /> DDoS Guard — Live Statistics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DdosGuardStats />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="credit" className="mt-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-400" /> Credit Scoring — Model Metrics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CreditScoringMetrics />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="middleware" className="mt-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Network className="h-4 w-4 text-cyan-400" /> Middleware Hub — Gateway Metrics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <MiddlewareHubMetrics />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="controls" className="mt-4">
            <CircuitBreakerControls />
          </TabsContent>
        </Tabs>

        {/* AML Metrics */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Bell className="h-4 w-4 text-orange-400" /> AML Alert Subscriber — Processing Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AmlMetrics />
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
