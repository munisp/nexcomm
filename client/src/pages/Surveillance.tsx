/**
 * NEXCOM Exchange — Market Surveillance
 * Real-time trade monitoring, position limits, and market abuse detection
 */
import { useState, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Eye, AlertTriangle, Activity, TrendingUp, TrendingDown, Zap, Bell, Brain, ExternalLink, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { PageSkeleton } from "@/components/PageSkeleton";

type AlertSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type AlertStatus = "OPEN" | "INVESTIGATING" | "CLOSED" | "ESCALATED";

interface SurveillanceAlert {
  id: string;
  alertType: string;
  instrument: string;
  entity: string;
  severity: AlertSeverity;
  status: AlertStatus;
  timestamp: string;
  details: string;
  value?: string;
}

interface PositionLimit {
  entity: string;
  instrument: string;
  currentPosition: number;
  limit: number;
  utilizationPct: number;
  direction: "LONG" | "SHORT";
  lastUpdated: string;
}

interface MarketAnomalyEvent {
  id: string;
  type: string;
  instrument: string;
  timestamp: string;
  priceBefore: number;
  priceAfter: number;
  changePct: number;
  volumeSpike: number;
  status: "MONITORING" | "INVESTIGATED" | "NORMAL";
}

const ALERTS: SurveillanceAlert[] = [
  { id: "SRV001", alertType: "Position Limit Breach",     instrument: "MAIZE",      entity: "Lagos Grain Co.",    severity: "HIGH",     status: "OPEN",          timestamp: "09:42:18", details: "Long position 94% of limit",                    value: "94%" },
  { id: "SRV002", alertType: "Wash Trading Detected",     instrument: "COCOA",      entity: "Unknown Trader A",   severity: "CRITICAL", status: "INVESTIGATING", timestamp: "09:38:44", details: "Buy/sell same contract within 30s, 14 times",   value: "14 trades" },
  { id: "SRV003", alertType: "Price Manipulation",        instrument: "GINGER",     entity: "Kano Agri Brokers",  severity: "HIGH",     status: "ESCALATED",     timestamp: "09:31:02", details: "Coordinated orders pushing price 8% in 5 min",  value: "+8%" },
  { id: "SRV004", alertType: "Spoofing",                  instrument: "CRUDE-OIL",  entity: "Unknown Trader B",   severity: "HIGH",     status: "INVESTIGATING", timestamp: "09:28:15", details: "Large orders placed and cancelled 22 times",    value: "22 cancels" },
  { id: "SRV005", alertType: "Unusual Volume Spike",      instrument: "SOYBEAN",    entity: "Market",             severity: "MEDIUM",   status: "OPEN",          timestamp: "09:22:40", details: "Volume 6.2x 30-day average in 10 minutes",      value: "6.2x avg" },
  { id: "SRV006", alertType: "Cross-Market Manipulation", instrument: "GOLD",       entity: "Enugu Metals",       severity: "MEDIUM",   status: "INVESTIGATING", timestamp: "09:18:55", details: "Correlated trades across GOLD and SILVER",      value: "Correlated" },
  { id: "SRV007", alertType: "Late Reporting",            instrument: "COTTON",     entity: "Ibadan Agri",        severity: "LOW",      status: "OPEN",          timestamp: "09:10:00", details: "Trade report submitted 45 min after execution", value: "45 min late" },
  { id: "SRV008", alertType: "Insider Trading Suspicion", instrument: "DANGCEM",    entity: "Undisclosed",        severity: "CRITICAL", status: "ESCALATED",     timestamp: "08:58:22", details: "Large buy before material announcement",        value: "Pre-announcement" },
  { id: "SRV009", alertType: "Circuit Breaker Triggered", instrument: "PALM-OIL",  entity: "Market",             severity: "HIGH",     status: "CLOSED",        timestamp: "08:45:10", details: "Price moved 10% in 5 min — trading halted",     value: "10% move" },
  { id: "SRV010", alertType: "Excessive Cancellations",   instrument: "WHEAT",      entity: "Kaduna Grain",       severity: "LOW",      status: "OPEN",          timestamp: "08:32:05", details: "Cancel-to-fill ratio 18:1 over last hour",      value: "18:1 ratio" },
];

const POSITION_LIMITS: PositionLimit[] = [
  { entity: "Lagos Grain Co.",   instrument: "MAIZE",     currentPosition: 47000, limit: 50000, utilizationPct: 94.0, direction: "LONG",  lastUpdated: "09:42:18" },
  { entity: "Accra Cocoa Ltd.",  instrument: "COCOA",     currentPosition: 38000, limit: 50000, utilizationPct: 76.0, direction: "LONG",  lastUpdated: "09:40:12" },
  { entity: "Kano Agri Brokers", instrument: "GINGER",    currentPosition: 28000, limit: 30000, utilizationPct: 93.3, direction: "SHORT", lastUpdated: "09:38:55" },
  { entity: "PH Energy Brokers", instrument: "CRUDE-OIL", currentPosition: 18000, limit: 25000, utilizationPct: 72.0, direction: "LONG",  lastUpdated: "09:35:20" },
  { entity: "Enugu Metals",      instrument: "GOLD",      currentPosition: 12000, limit: 20000, utilizationPct: 60.0, direction: "LONG",  lastUpdated: "09:30:44" },
  { entity: "Dakar Agri Corp.",  instrument: "MILLET",    currentPosition: 8000,  limit: 15000, utilizationPct: 53.3, direction: "LONG",  lastUpdated: "09:28:18" },
  { entity: "Ibadan Agri",       instrument: "COTTON",    currentPosition: 4200,  limit: 10000, utilizationPct: 42.0, direction: "SHORT", lastUpdated: "09:22:05" },
  { entity: "Kaduna Grain",      instrument: "WHEAT",     currentPosition: 9800,  limit: 20000, utilizationPct: 49.0, direction: "LONG",  lastUpdated: "09:18:40" },
];

const ANOMALIES: MarketAnomalyEvent[] = [
  { id: "ANO001", type: "Flash Crash",       instrument: "PALM-OIL",  timestamp: "08:45:10", priceBefore: 1840, priceAfter: 1656, changePct: -10.0, volumeSpike: 8.4,  status: "INVESTIGATED" },
  { id: "ANO002", type: "Volume Spike",      instrument: "SOYBEAN",   timestamp: "09:22:40", priceBefore: 580,  priceAfter: 596,  changePct: 2.76,  volumeSpike: 6.2,  status: "MONITORING" },
  { id: "ANO003", type: "Price Gap",         instrument: "GINGER",    timestamp: "09:31:02", priceBefore: 2840, priceAfter: 3068, changePct: 8.03,  volumeSpike: 4.8,  status: "MONITORING" },
  { id: "ANO004", type: "Bid-Ask Widening",  instrument: "COCOA",     timestamp: "09:38:44", priceBefore: 9840, priceAfter: 9820, changePct: -0.20, volumeSpike: 12.4, status: "MONITORING" },
  { id: "ANO005", type: "Order Imbalance",   instrument: "MAIZE",     timestamp: "09:42:18", priceBefore: 248,  priceAfter: 252,  changePct: 1.61,  volumeSpike: 3.2,  status: "NORMAL" },
];

const SEVERITY_CONFIG: Record<AlertSeverity, string> = {
  LOW:      "text-blue-400",
  MEDIUM:   "text-yellow-400",
  HIGH:     "text-orange-400",
  CRITICAL: "text-negative",
};

const ALERT_STATUS_CONFIG: Record<AlertStatus, string> = {
  OPEN:          "badge-active",
  INVESTIGATING: "badge-pending",
  CLOSED:        "badge-settled",
  ESCALATED:     "badge-cancelled",
};

// ─── ML Anomaly Feed Component ──────────────────────────────────────────────
function MlAnomalyFeed() {
  const { data, isLoading, refetch, isFetching } = trpc.aiMl.getRecentAnomalies.useQuery(
    undefined,
    { refetchInterval: 30_000 }
  );

  type MlAnomaly = {
    id: string;
    symbol: string;
    type: string;
    severity: string;
    combined_score: number;
    confidence: number;
    detected_at: string;
    description: string;
    affected_accounts: number;
    estimated_impact_usd: number;
    detection_models: string[];
  };

  const d = data as { anomalies?: MlAnomaly[]; total?: number; severity_summary?: Record<string, number>; error?: string } | undefined;
  const anomalies = d?.anomalies ?? [];

  const severityColor: Record<string, string> = {
    critical: "bg-red-500/20 text-red-400 border-red-500/30",
    high:     "bg-orange-500/20 text-orange-400 border-orange-500/30",
    medium:   "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    low:      "bg-blue-500/20 text-blue-400 border-blue-500/30",
  };

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4 mb-2">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-semibold text-foreground">ML Anomaly Feed</span>
          <Badge variant="outline" className="text-xs text-purple-400 border-purple-500/30">
            Isolation Forest + GNN-GraphSAGE
          </Badge>
          {d?.total != null && (
            <span className="text-xs text-muted-foreground">{d.total} detected (24h)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost" size="sm"
            className="h-7 text-xs"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Link href="/ai-ml">
            <Button variant="outline" size="sm" className="h-7 text-xs">
              <ExternalLink className="w-3 h-3 mr-1" />
              View in AI/ML Dashboard
            </Button>
          </Link>
        </div>
      </div>

      {/* Severity summary */}
      {d?.severity_summary && (
        <div className="flex gap-2 mb-3">
          {Object.entries(d.severity_summary).map(([sev, count]) => (
            <Badge key={sev} variant="outline" className={`text-xs capitalize ${severityColor[sev] ?? ""}`}>
              {sev}: {count}
            </Badge>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
          <RefreshCw className="w-4 h-4 animate-spin" /> Loading ML anomalies...
        </div>
      ) : d?.error ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
          <AlertTriangle className="w-4 h-4 text-yellow-500" />
          AI/ML service offline — anomaly detection unavailable
        </div>
      ) : anomalies.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No anomalies detected in the last 24 hours</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {anomalies.slice(0, 10).map((a) => (
            <div key={a.id} className="flex items-start gap-3 p-2 rounded-lg bg-muted/20 border border-border/30 hover:bg-muted/30 transition-colors">
              <Badge variant="outline" className={`text-xs capitalize shrink-0 mt-0.5 ${severityColor[a.severity] ?? ""}`}>
                {a.severity}
              </Badge>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono font-semibold text-primary">{a.symbol}</span>
                  <span className="text-xs font-medium text-foreground capitalize">{a.type.replace(/_/g, " ")}</span>
                  <span className="text-xs text-muted-foreground">score: {(a.combined_score * 100).toFixed(0)}%</span>
                  <span className="text-xs text-muted-foreground">conf: {(a.confidence * 100).toFixed(0)}%</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(a.detected_at).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{a.description}</p>
                <div className="flex gap-1 mt-1">
                  {a.detection_models.map((m) => (
                    <Badge key={m} variant="secondary" className="text-[10px] px-1 py-0">{m}</Badge>
                  ))}
                  <span className="text-[10px] text-muted-foreground ml-1">
                    ~${a.estimated_impact_usd.toLocaleString()} impact · {a.affected_accounts} acct{a.affected_accounts !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Surveillance() {
  const [tab, setTab] = useState("alerts");
  const [liveAlerts, setLiveAlerts] = useState(ALERTS);
  const [tick, setTick] = useState(0);
  const [showAlertConfig, setShowAlertConfig] = useState(false);
  const [alertSettings, setAlertSettings] = useState({
    positionBreach: true,
    washTrading: true,
    priceManipulation: true,
    volumeSpike: true,
    circuitBreaker: true,
    emailNotify: false,
    smsNotify: false,
  });

  // Real circuit breaker events from surveillance router
  const { data: cbEventsData, isLoading: cbEventsLoading } = trpc.surveillance.adminListCircuitBreakerEvents.useQuery(
    { limit: 50 },
    { retry: false }
  );
  const { data: haltedInstruments } = trpc.surveillance.adminGetHaltedInstruments.useQuery(
    undefined,
    { retry: false }
  );

  // Map real circuit breaker events to SurveillanceAlert interface
  const liveCbAlerts = useMemo<SurveillanceAlert[]>(() => {
    const events = cbEventsData?.events;
    if (!events || events.length === 0) return [];
    return events.map(e => ({
      id: String(e.id),
      alertType: "Circuit Breaker Triggered",
      instrument: e.instrument ?? "",
      entity: "Market",
      severity: "HIGH" as AlertSeverity,
      status: (e.status === "LIFTED" || e.status === "EXPIRED" ? "CLOSED" : "OPEN") as AlertStatus,
      timestamp: e.haltedAt ? new Date(e.haltedAt).toLocaleTimeString() : "",
      details: `Price moved ${Number(e.actualMovePct).toFixed(2)}% — trading halted`,
      value: `${Number(e.actualMovePct).toFixed(2)}%`,
    }));
  }, [cbEventsData]);

  // Merge static alerts with real CB events
  const mergedAlerts = useMemo(() => {
    if (liveCbAlerts.length === 0) return liveAlerts;
    return [...liveCbAlerts, ...liveAlerts.filter(a => a.alertType !== "Circuit Breaker Triggered")];
  }, [liveCbAlerts, liveAlerts]);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 3000);
    return () => clearInterval(id);
  }, []);

  const openAlerts = mergedAlerts.filter(a => a.status === "OPEN" || a.status === "INVESTIGATING" || a.status === "ESCALATED").length;
  const criticalAlerts = mergedAlerts.filter(a => a.severity === "CRITICAL").length;
  const breaches = POSITION_LIMITS.filter(p => p.utilizationPct >= 90).length;

  if (cbEventsLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={5} />;
  return (
    <div className="page-container space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2" style={{ fontFamily: "'DM Serif Display', serif" }}>
            <Eye className="w-6 h-6 text-primary" />
            Market Surveillance
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Real-time trade monitoring, position limits, and market abuse detection</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-positive animate-pulse" />
            <span className="text-xs text-positive font-medium">Monitoring Active</span>
          </div>
          <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" onClick={() => setShowAlertConfig(true)}>
            <Bell className="w-3.5 h-3.5" />Alerts
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Open Alerts",      value: openAlerts,     icon: AlertTriangle, color: openAlerts > 0 ? "text-yellow-400" : "text-positive" },
          { label: "Critical",         value: criticalAlerts, icon: Zap,           color: criticalAlerts > 0 ? "text-negative" : "text-positive" },
          { label: "Position Breaches",value: breaches,       icon: TrendingUp,    color: breaches > 0 ? "text-orange-400" : "text-positive" },
          { label: "Trades Monitored", value: `${(14280 + tick * 3).toLocaleString()}`, icon: Activity, color: "text-foreground" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="stat-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{label}</span>
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="alerts">Surveillance Alerts ({openAlerts})</TabsTrigger>
          <TabsTrigger value="positions">Position Limits</TabsTrigger>
          <TabsTrigger value="anomalies">Market Anomalies</TabsTrigger>
        </TabsList>

        <TabsContent value="alerts" className="mt-4">
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b border-border bg-secondary/50">
                    {["ID","Alert Type","Instrument","Entity","Severity","Time","Details","Value","Status","Actions"].map(h => (
                      <th key={h} className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {mergedAlerts.map(a => (
                    <tr key={a.id} className={`transition-colors hover:bg-secondary/30 ${a.severity === "CRITICAL" ? "bg-negative/5" : ""}`}>
                      <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{a.id}</td>
                      <td className="px-3 py-3 text-sm font-semibold text-foreground">{a.alertType}</td>
                      <td className="px-3 py-3 text-xs font-mono text-primary">{a.instrument}</td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">{a.entity}</td>
                      <td className="px-3 py-3"><span className={`text-xs font-bold ${SEVERITY_CONFIG[a.severity]}`}>{a.severity}</span></td>
                      <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{a.timestamp}</td>
                      <td className="px-3 py-3 text-xs text-muted-foreground max-w-[180px] truncate">{a.details}</td>
                      <td className="px-3 py-3 font-mono text-xs text-foreground">{a.value ?? "—"}</td>
                      <td className="px-3 py-3"><Badge className={"text-[10px] " + ALERT_STATUS_CONFIG[a.status]}>{a.status}</Badge></td>
                      <td className="px-3 py-3">
                        {(a.status === "OPEN") && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                            setLiveAlerts(prev => prev.map(x => x.id === a.id ? { ...x, status: "INVESTIGATING" as AlertStatus } : x));
                            toast.info(`Alert ${a.id} under investigation`);
                          }}>Investigate</Button>
                        )}
                        {(a.status === "INVESTIGATING") && (
                          <Button size="sm" variant="outline" className="h-7 text-xs text-positive border-positive/30 hover:bg-positive/10" onClick={() => {
                            setLiveAlerts(prev => prev.map(x => x.id === a.id ? { ...x, status: "CLOSED" as AlertStatus } : x));
                            toast.success(`Alert ${a.id} closed`);
                          }}>Close</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="positions" className="mt-4">
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  {["Entity","Instrument","Direction","Current Position","Limit","Utilization","Last Updated","Status"].map(h => (
                    <th key={h} className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {POSITION_LIMITS.map(p => {
                  const color = p.utilizationPct >= 90 ? "text-negative" : p.utilizationPct >= 75 ? "text-yellow-400" : "text-positive";
                  return (
                    <tr key={`${p.entity}-${p.instrument}`} className={`transition-colors hover:bg-secondary/30 ${p.utilizationPct >= 90 ? "bg-negative/5" : ""}`}>
                      <td className="px-3 py-3 font-semibold text-foreground text-sm">{p.entity}</td>
                      <td className="px-3 py-3 font-mono text-xs text-primary">{p.instrument}</td>
                      <td className="px-3 py-3">
                        <Badge className={`text-[10px] ${p.direction === "LONG" ? "badge-settled" : "badge-cancelled"}`}>{p.direction}</Badge>
                      </td>
                      <td className="px-3 py-3 font-mono text-sm text-foreground">{p.currentPosition.toLocaleString()}</td>
                      <td className="px-3 py-3 font-mono text-sm text-muted-foreground">{p.limit.toLocaleString()}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-2 bg-secondary rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${p.utilizationPct >= 90 ? "bg-negative" : p.utilizationPct >= 75 ? "bg-yellow-400" : "bg-positive"}`} style={{ width: `${p.utilizationPct}%` }} />
                          </div>
                          <span className={`font-mono text-xs font-semibold ${color}`}>{p.utilizationPct.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{p.lastUpdated}</td>
                      <td className="px-3 py-3">
                        {p.utilizationPct >= 90
                          ? <Badge className="badge-cancelled text-[10px]"><AlertTriangle className="w-3 h-3 mr-1" />Near Limit</Badge>
                          : <Badge className="badge-settled text-[10px]">Normal</Badge>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="anomalies" className="mt-4">
          <MlAnomalyFeed />
          <div className="mt-6 rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  {["ID","Type","Instrument","Time","Price Before","Price After","Change %","Volume Spike","Status"].map(h => (
                    <th key={h} className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ANOMALIES.map(a => (
                  <tr key={a.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{a.id}</td>
                    <td className="px-3 py-3 font-semibold text-foreground text-sm">{a.type}</td>
                    <td className="px-3 py-3 font-mono text-xs text-primary">{a.instrument}</td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{a.timestamp}</td>
                    <td className="px-3 py-3 font-mono text-xs text-foreground">{a.priceBefore.toLocaleString()}</td>
                    <td className="px-3 py-3 font-mono text-xs text-foreground">{a.priceAfter.toLocaleString()}</td>
                    <td className={`px-3 py-3 font-mono text-sm font-semibold ${a.changePct >= 0 ? "text-positive" : "text-negative"}`}>
                      {a.changePct >= 0 ? "+" : ""}{a.changePct.toFixed(2)}%
                    </td>
                    <td className="px-3 py-3 font-mono text-sm text-yellow-400">{a.volumeSpike.toFixed(1)}x</td>
                    <td className="px-3 py-3">
                      <Badge className={`text-[10px] ${a.status === "NORMAL" ? "badge-settled" : a.status === "INVESTIGATED" ? "badge-active" : "badge-pending"}`}>
                        {a.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Alert Configuration Dialog */}
      <Dialog open={showAlertConfig} onOpenChange={setShowAlertConfig}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" />
              Alert Configuration
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">Configure which surveillance events trigger alerts and how you are notified.</p>
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Alert Types</p>
              {[
                { key: "positionBreach" as const,    label: "Position Limit Breach" },
                { key: "washTrading" as const,       label: "Wash Trading Detection" },
                { key: "priceManipulation" as const, label: "Price Manipulation" },
                { key: "volumeSpike" as const,       label: "Unusual Volume Spike" },
                { key: "circuitBreaker" as const,    label: "Circuit Breaker Triggered" },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm text-foreground">{label}</span>
                  <Switch
                    checked={alertSettings[key]}
                    onCheckedChange={val => setAlertSettings(s => ({ ...s, [key]: val }))}
                  />
                </div>
              ))}
            </div>
            <div className="space-y-3 border-t border-border pt-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notification Channels</p>
              {[
                { key: "emailNotify" as const, label: "Email Notifications" },
                { key: "smsNotify" as const,   label: "SMS Notifications" },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm text-foreground">{label}</span>
                  <Switch
                    checked={alertSettings[key]}
                    onCheckedChange={val => setAlertSettings(s => ({ ...s, [key]: val }))}
                  />
                </div>
              ))}
            </div>
            <Button
              className="w-full"
              onClick={() => { setShowAlertConfig(false); toast.success("Alert configuration saved"); }}
            >
              Save Configuration
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
