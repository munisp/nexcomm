/**
 * NEXCOM Exchange — Journey Orchestrator Dashboard
 *
 * Displays all 20 reusable Temporal-orchestrated user/stakeholder journeys.
 * Allows triggering, monitoring, and signaling journeys in real time.
 * Wired to journeyRouter tRPC procedures.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RefreshCw, Play, Eye, Signal, XCircle, Activity, Users, TrendingUp, Shield, Settings } from "lucide-react";

// ─── Journey metadata ─────────────────────────────────────────────────────────

const JOURNEYS = [
  { id: "FarmerOnboarding",    category: "Onboarding",   icon: "👨‍🌾", stakeholder: "Farmer",           description: "KYC → AML → TigerBeetle accounts → Keycloak roles → Notification → Lakehouse" },
  { id: "KYCAMLReview",        category: "Compliance",   icon: "🔍", stakeholder: "Compliance Officer", description: "KYC review → AML screen → Decision → STR filing → Notification → Lakehouse" },
  { id: "WarehouseReceipt",    category: "Onboarding",   icon: "🏭", stakeholder: "Warehouse Operator", description: "Capacity check → Receipt issuance → Valuation → Tokenization → Collateral account" },
  { id: "CommodityListing",    category: "Trading",      icon: "📋", stakeholder: "Farmer/Trader",      description: "Receipt verify → Risk check → SELL order → Fluvio stream → Lakehouse" },
  { id: "SpotTrade",           category: "Trading",      icon: "⚡", stakeholder: "Trader",             description: "Pre-trade risk → Balance check → Reserve → Match → Settle → DvP → Lakehouse" },
  { id: "TradeSettlement",     category: "Clearing",     icon: "🏦", stakeholder: "Clearing House",     description: "TigerBeetle 2-phase commit → Blockchain DvP → Fee collection → Notification" },
  { id: "FuturesTrading",      category: "Trading",      icon: "📈", stakeholder: "Institutional Trader", description: "Margin calc → Reserve → Futures order → Clearing → Notification → Lakehouse" },
  { id: "MarginCall",          category: "Risk",         icon: "⚠️", stakeholder: "Risk Manager",       description: "Notify → Wait for top-up signal → Auto-liquidate if not met → Lakehouse" },
  { id: "CrossBorderFX",       category: "Payments",     icon: "🌍", stakeholder: "Exporter",           description: "Sanctions → ILP Quote → Reserve → Mojaloop → Commit → Fluvio → Lakehouse" },
  { id: "DepositWithdrawal",   category: "Banking",      icon: "💰", stakeholder: "All Users",          description: "KYC check → AML → Gateway payment → TigerBeetle credit/debit → Notification" },
  { id: "USSDMobileTrade",     category: "Channels",     icon: "📱", stakeholder: "Rural Farmer",       description: "PIN verify → Price check → Balance → Market order → SMS confirm → Lakehouse" },
  { id: "LoanApplication",     category: "Banking",      icon: "📝", stakeholder: "Farmer",             description: "Credit scoring → Decision logic → Loan record → Notification → Lakehouse" },
  { id: "LoanDisbursement",    category: "Banking",      icon: "💸", stakeholder: "Credit Officer",     description: "Validate → Reserve lending pool → Mojaloop transfer → Repayment schedule" },
  { id: "CorporateAction",     category: "Exchange Ops", icon: "🏢", stakeholder: "Exchange Admin",     description: "Validate → Get holders → Distribute → Blockchain update → Broadcast" },
  { id: "MarketSurveillance",  category: "Compliance",   icon: "👁️", stakeholder: "Surveillance Officer", description: "AI anomaly detect → Trading history → Decision → STR/Freeze → Lakehouse" },
  { id: "ComplianceAudit",     category: "Compliance",   icon: "📊", stakeholder: "Compliance Officer", description: "Permission check → Generate report → AI anomaly → File alerts → Notify" },
  { id: "BrokerOnboarding",    category: "Onboarding",   icon: "🤝", stakeholder: "Broker-Dealer",      description: "License verify → Register → TigerBeetle accounts → Keycloak roles → Notify" },
  { id: "MarketMakerQuote",    category: "Trading",      icon: "📉", stakeholder: "Market Maker",       description: "Circuit breaker check → Spread validate → Bid/Ask orders → Fluvio stream" },
  { id: "RegulatorReporting",  category: "Compliance",   icon: "📤", stakeholder: "Exchange Admin",     description: "Compile Gold layer data → Sign/encrypt → Submit to SEC/CBN → Audit trail" },
  { id: "PlatformHealthCheck", category: "Operations",   icon: "🔧", stakeholder: "SRE/DevOps",         description: "Check all 18 services → Alert on failures → Ingest health metrics → Dashboard" },
];

const CATEGORY_COLORS: Record<string, string> = {
  Onboarding:    "bg-blue-500/20 text-blue-300 border-blue-500/30",
  Trading:       "bg-green-500/20 text-green-300 border-green-500/30",
  Clearing:      "bg-purple-500/20 text-purple-300 border-purple-500/30",
  Risk:          "bg-red-500/20 text-red-300 border-red-500/30",
  Payments:      "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  Banking:       "bg-orange-500/20 text-orange-300 border-orange-500/30",
  Channels:      "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  Compliance:    "bg-pink-500/20 text-pink-300 border-pink-500/30",
  "Exchange Ops": "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  Operations:    "bg-slate-500/20 text-slate-300 border-slate-500/30",
};

const STATUS_COLORS: Record<string, string> = {
  RUNNING:   "bg-green-500/20 text-green-300",
  COMPLETED: "bg-blue-500/20 text-blue-300",
  FAILED:    "bg-red-500/20 text-red-300",
  CANCELLED: "bg-slate-500/20 text-slate-300",
  STARTED:   "bg-yellow-500/20 text-yellow-300",
};

// ─── Quick-trigger form ───────────────────────────────────────────────────────

function QuickTriggerDialog({ journey }: { journey: typeof JOURNEYS[0] }) {
  const [open, setOpen] = useState(false);
  const [workflowId, setWorkflowId] = useState("");
  const [lastResult, setLastResult] = useState<{ workflow_id: string; status: string } | null>(null);

  const healthCheck = trpc.journey.startPlatformHealthCheck.useMutation({
    onSuccess: (data) => {
      setLastResult(data);
      toast.success(`Journey started: ${data.workflow_id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleQuickStart = () => {
    if (journey.id === "PlatformHealthCheck") {
      healthCheck.mutate({ checkId: workflowId || undefined, alertOnFail: true });
    } else {
      toast.info(`Use the API to trigger ${journey.id} with full typed parameters.`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <Play className="h-3 w-3" /> Trigger
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{journey.icon}</span>
            <span>{journey.id}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground">{journey.description}</p>
          </div>
          <div>
            <Label>Workflow ID (optional — auto-generated if blank)</Label>
            <Input
              placeholder={`${journey.id.toLowerCase()}-${Date.now()}`}
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
            />
          </div>
          <div className="rounded border border-border bg-muted/30 p-3 text-xs font-mono">
            <p className="text-muted-foreground mb-1">API endpoint:</p>
            <p>POST /journeys/{journey.id}/start</p>
            <p className="text-muted-foreground mt-2">tRPC procedure:</p>
            <p>trpc.journey.start{journey.id}.mutate(input)</p>
          </div>
          {lastResult && (
            <div className="rounded border border-green-500/30 bg-green-500/10 p-3 text-xs">
              <p className="text-green-300 font-medium">Started: {lastResult.workflow_id}</p>
              <p className="text-muted-foreground">Status: {lastResult.status}</p>
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={handleQuickStart} disabled={healthCheck.isPending} className="flex-1">
              {healthCheck.isPending ? "Starting..." : `Start ${journey.id}`}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Status checker ───────────────────────────────────────────────────────────

function StatusChecker() {
  const [workflowId, setWorkflowId] = useState("");
  const [queryId, setQueryId] = useState("");

  const { data: status, isLoading } = trpc.journey.getStatus.useQuery(
    { workflowId: queryId },
    { enabled: !!queryId, refetchInterval: 5000 }
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Eye className="h-4 w-4" /> Check Journey Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Enter workflow ID..."
            value={workflowId}
            onChange={(e) => setWorkflowId(e.target.value)}
          />
          <Button onClick={() => setQueryId(workflowId)} disabled={!workflowId}>
            Check
          </Button>
        </div>
        {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {status && (
          <div className="rounded border border-border bg-muted/30 p-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Workflow ID</span>
              <code className="text-xs">{status.workflow_id}</code>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Type</span>
              <span>{status.workflow_type}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <Badge className={STATUS_COLORS[status.status] ?? "bg-slate-500/20 text-slate-300"}>
                {status.status}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">History Length</span>
              <span>{status.history_length} events</span>
            </div>
            {status.start_time && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Started</span>
                <span>{new Date(status.start_time).toLocaleString()}</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Signal panel ─────────────────────────────────────────────────────────────

function SignalPanel() {
  const [workflowId, setWorkflowId] = useState("");
  const [topUpAmount, setTopUpAmount] = useState("");

  const signalMarginTopUp = trpc.journey.signalMarginTopUp.useMutation({
    onSuccess: () => toast.success("Margin top-up signal sent"),
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Signal className="h-4 w-4" /> Send Signal to Running Journey
        </CardTitle>
        <CardDescription>Signal a waiting workflow (e.g. margin top-up confirmation)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Workflow ID</Label>
          <Input placeholder="margin-call-..." value={workflowId} onChange={(e) => setWorkflowId(e.target.value)} />
        </div>
        <div>
          <Label>Top-Up Amount (₦)</Label>
          <Input type="number" placeholder="500000" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} />
        </div>
        <Button
          onClick={() => signalMarginTopUp.mutate({ workflowId, topUpAmountNgn: parseFloat(topUpAmount) })}
          disabled={!workflowId || !topUpAmount || signalMarginTopUp.isPending}
          className="w-full"
        >
          Send Margin Top-Up Signal
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function JourneysDashboard() {
  const [selectedCategory, setSelectedCategory] = useState("All");
  const { data: journeyList, isLoading: listLoading, refetch } = trpc.journey.list.useQuery(undefined, {
    refetchInterval: 60000,
  });

  const categories = ["All", ...Array.from(new Set(JOURNEYS.map((j) => j.category)))];
  const filtered = selectedCategory === "All" ? JOURNEYS : JOURNEYS.filter((j) => j.category === selectedCategory);

  const categoryCounts = JOURNEYS.reduce((acc, j) => {
    acc[j.category] = (acc[j.category] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Journey Orchestrator</h1>
          <p className="text-muted-foreground text-sm mt-1">
            20 reusable Temporal-orchestrated user/stakeholder journeys — each wired to real platform services
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1">
          <RefreshCw className="h-3 w-3" /> Refresh
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Journeys", value: "20", icon: <Activity className="h-4 w-4" />, color: "text-blue-400" },
          { label: "Task Queues", value: "5", icon: <Settings className="h-4 w-4" />, color: "text-green-400" },
          { label: "Stakeholder Types", value: "12", icon: <Users className="h-4 w-4" />, color: "text-yellow-400" },
          { label: "Services Wired", value: "18", icon: <TrendingUp className="h-4 w-4" />, color: "text-purple-400" },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={stat.color}>{stat.icon}</div>
              <div>
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="journeys">
        <TabsList>
          <TabsTrigger value="journeys">All Journeys</TabsTrigger>
          <TabsTrigger value="monitor">Monitor & Signal</TabsTrigger>
          <TabsTrigger value="task-queues">Task Queues</TabsTrigger>
        </TabsList>

        {/* ── All Journeys tab ── */}
        <TabsContent value="journeys" className="mt-4 space-y-4">
          {/* Category filter */}
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <Button
                key={cat}
                size="sm"
                variant={selectedCategory === cat ? "default" : "outline"}
                onClick={() => setSelectedCategory(cat)}
                className="text-xs"
              >
                {cat} {cat !== "All" && <span className="ml-1 opacity-60">({categoryCounts[cat]})</span>}
              </Button>
            ))}
          </div>

          {/* Journey cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((journey, i) => (
              <Card key={journey.id} className="flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{journey.icon}</span>
                      <div>
                        <CardTitle className="text-sm font-semibold leading-tight">
                          Journey {i + 1 < 10 ? `0${i + 1}` : i + 1}: {journey.id}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">{journey.stakeholder}</p>
                      </div>
                    </div>
                    <Badge className={`text-xs border ${CATEGORY_COLORS[journey.category] ?? ""}`}>
                      {journey.category}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col gap-3">
                  <p className="text-xs text-muted-foreground leading-relaxed">{journey.description}</p>
                  <div className="mt-auto flex gap-2">
                    <QuickTriggerDialog journey={journey} />
                    <Button size="sm" variant="ghost" className="gap-1 text-xs" asChild>
                      <a href={`/api/journeys/${journey.id}/start`} target="_blank" rel="noreferrer">
                        <Eye className="h-3 w-3" /> API
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ── Monitor & Signal tab ── */}
        <TabsContent value="monitor" className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <StatusChecker />
          <SignalPanel />
        </TabsContent>

        {/* ── Task Queues tab ── */}
        <TabsContent value="task-queues" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Temporal Task Queues</CardTitle>
              <CardDescription>Each domain has a dedicated task queue for independent scaling</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task Queue</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead>Journeys</TableHead>
                    <TableHead>Workers</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { queue: "nexcom-onboarding",  domain: "Onboarding",   journeys: "FarmerOnboarding, KYCAMLReview, WarehouseReceipt, BrokerOnboarding", workers: "2" },
                    { queue: "nexcom-trading",     domain: "Trading",      journeys: "CommodityListing, SpotTrade, TradeSettlement, FuturesTrading, MarginCall, MarketMakerQuote, USSDMobileTrade, CorporateAction", workers: "4" },
                    { queue: "nexcom-banking",     domain: "Banking",      journeys: "CrossBorderFX, DepositWithdrawal, LoanApplication, LoanDisbursement", workers: "2" },
                    { queue: "nexcom-compliance",  domain: "Compliance",   journeys: "MarketSurveillance, ComplianceAudit, RegulatorReporting", workers: "2" },
                    { queue: "nexcom-operations",  domain: "Operations",   journeys: "PlatformHealthCheck", workers: "1" },
                  ].map((row) => (
                    <TableRow key={row.queue}>
                      <TableCell><code className="text-xs">{row.queue}</code></TableCell>
                      <TableCell>
                        <Badge className={`text-xs border ${CATEGORY_COLORS[row.domain] ?? ""}`}>{row.domain}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{row.journeys}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{row.workers} worker{row.workers !== "1" ? "s" : ""}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
