import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { PageSkeleton } from "@/components/PageSkeleton";
  ShieldAlert,
  Zap,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Plus,
  Unlock,
  Eye,
  BarChart3,
} from "lucide-react";

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  accent?: string;
}) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${accent ?? "text-foreground"}`}>{value}</p>
          </div>
          <Icon className="h-8 w-8 text-muted-foreground/40" />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE: "bg-red-500/20 text-red-400 border-red-500/30",
    LIFTED: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    EXPIRED: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
    PENDING: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    CONFIRMED: "bg-red-500/20 text-red-400 border-red-500/30",
    DISMISSED: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  };
  return (
    <Badge variant="outline" className={`text-xs ${map[status] ?? ""}`}>
      {status}
    </Badge>
  );
}

// ─── Create Rule Dialog ───────────────────────────────────────────────────────

function CreateRuleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [instrument, setInstrument] = useState("*");
  const [assetClass, setAssetClass] = useState("COMMODITY");
  const [triggerPct, setTriggerPct] = useState("5");
  const [windowMinutes, setWindowMinutes] = useState("15");
  const [haltDurationMinutes, setHaltDurationMinutes] = useState("30");
  const [notes, setNotes] = useState("");

  const createMutation = trpc.surveillance.adminCreateCircuitBreakerRule.useMutation({
    onSuccess: () => {
      toast.success("Circuit breaker rule created");
      utils.surveillance.adminListCircuitBreakerRules.invalidate();
      utils.surveillance.adminGetSurveillanceStats.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = () => {
    const pct = parseFloat(triggerPct);
    const win = parseInt(windowMinutes);
    const halt = parseInt(haltDurationMinutes);
    if (isNaN(pct) || isNaN(win) || isNaN(halt)) {
      toast.error("Please fill all numeric fields correctly");
      return;
    }
    createMutation.mutate({
      instrument: instrument.trim() || "*",
      assetClass,
      triggerPct: pct,
      windowMinutes: win,
      haltDurationMinutes: halt,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Circuit Breaker Rule</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Instrument (use * for all)</Label>
            <Input value={instrument} onChange={(e) => setInstrument(e.target.value)} placeholder="e.g. MAIZE-NG or *" />
          </div>
          <div className="space-y-1">
            <Label>Asset Class</Label>
            <Select value={assetClass} onValueChange={setAssetClass}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["COMMODITY", "FOREX", "EQUITY", "DIGITAL_ASSET", "INDEX"].map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Trigger % Move</Label>
              <Input type="number" min="0.1" max="100" step="0.1" value={triggerPct} onChange={(e) => setTriggerPct(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Window (min)</Label>
              <Input type="number" min="1" max="1440" value={windowMinutes} onChange={(e) => setWindowMinutes(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Halt (min)</Label>
              <Input type="number" min="1" max="1440" value={haltDurationMinutes} onChange={(e) => setHaltDurationMinutes(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reason or description" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create Rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Review Wash Trade Dialog ─────────────────────────────────────────────────

function ReviewWashTradeDialog({
  flagId,
  open,
  onClose,
}: {
  flagId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [decision, setDecision] = useState<"CONFIRMED" | "DISMISSED">("DISMISSED");
  const [penaltyApplied, setPenaltyApplied] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");

  const reviewMutation = trpc.surveillance.adminReviewWashTradeFlag.useMutation({
    onSuccess: () => {
      toast.success(`Flag ${decision.toLowerCase()}`);
      utils.surveillance.adminListWashTradeFlags.invalidate();
      utils.surveillance.adminGetSurveillanceStats.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (!flagId) return;
    reviewMutation.mutate({
      flagId,
      decision,
      penaltyApplied,
      reviewNotes: reviewNotes.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Review Wash Trade Flag</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Decision</Label>
            <Select value={decision} onValueChange={(v) => setDecision(v as "CONFIRMED" | "DISMISSED")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CONFIRMED">Confirm (wash trade)</SelectItem>
                <SelectItem value="DISMISSED">Dismiss (false positive)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="penalty"
              checked={penaltyApplied}
              onChange={(e) => setPenaltyApplied(e.target.checked)}
              className="w-4 h-4"
            />
            <Label htmlFor="penalty">Apply penalty to user</Label>
          </div>
          <div className="space-y-1">
            <Label>Review Notes</Label>
            <Input value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="Optional notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={reviewMutation.isPending}
            variant={decision === "CONFIRMED" ? "destructive" : "default"}
          >
            {reviewMutation.isPending ? "Saving…" : "Submit Review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TradeSurveillance() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [showCreateRule, setShowCreateRule] = useState(false);
  const [reviewFlagId, setReviewFlagId] = useState<number | null>(null);
  const [washStatusFilter, setWashStatusFilter] = useState<"PENDING" | "CONFIRMED" | "DISMISSED" | "">("");
  const [haltEventPage, setHaltEventPage] = useState(1);
  const [washPage, setWashPage] = useState(1);

  const statsQuery = trpc.surveillance.adminGetSurveillanceStats.useQuery(undefined, { refetchInterval: 30_000 });
  const rulesQuery = trpc.surveillance.adminListCircuitBreakerRules.useQuery({ activeOnly: false });
  const haltedQuery = trpc.surveillance.adminGetHaltedInstruments.useQuery(undefined, { refetchInterval: 15_000 });
  const eventsQuery = trpc.surveillance.adminListCircuitBreakerEvents.useQuery({ page: haltEventPage, limit: 20 });
  const washQuery = trpc.surveillance.adminListWashTradeFlags.useQuery({
    page: washPage,
    limit: 20,
    status: washStatusFilter || undefined,
  });

  const liftHaltMutation = trpc.surveillance.adminLiftHalt.useMutation({
    onSuccess: () => {
      toast.success("Halt lifted");
      utils.surveillance.adminGetHaltedInstruments.invalidate();
      utils.surveillance.adminListCircuitBreakerEvents.invalidate();
      utils.surveillance.adminGetSurveillanceStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleRuleMutation = trpc.surveillance.adminUpdateCircuitBreakerRule.useMutation({
    onSuccess: () => {
      toast.success("Rule updated");
      utils.surveillance.adminListCircuitBreakerRules.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteRuleMutation = trpc.surveillance.adminDeleteCircuitBreakerRule.useMutation({
    onSuccess: () => {
      toast.success("Rule deleted");
      utils.surveillance.adminListCircuitBreakerRules.invalidate();
      utils.surveillance.adminGetSurveillanceStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const stats = statsQuery.data;

  if (user?.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Admin access required.
      </div>
    );
  }

  if (statsQuery.isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={5} />;
  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-amber-400" />
            Trade Surveillance
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Circuit breakers, halt management, and wash trade detection
          </p>
        </div>
        <Button onClick={() => setShowCreateRule(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New Circuit Breaker Rule
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Active Rules"
          value={stats?.circuitBreakers.activeRules ?? "—"}
          icon={Zap}
          accent="text-emerald-400"
        />
        <StatCard
          label="Active Halts"
          value={stats?.circuitBreakers.activeHalts ?? "—"}
          icon={ShieldAlert}
          accent={stats?.circuitBreakers.activeHalts ? "text-red-400" : "text-foreground"}
        />
        <StatCard
          label="Pending Wash Flags"
          value={stats?.washTrades.pendingFlags ?? "—"}
          icon={AlertTriangle}
          accent={stats?.washTrades.pendingFlags ? "text-amber-400" : "text-foreground"}
        />
        <StatCard
          label="Confirmed Wash Trades"
          value={stats?.washTrades.confirmedFlags ?? "—"}
          icon={BarChart3}
          accent="text-red-400"
        />
      </div>

      {/* Active Halts Banner */}
      {(haltedQuery.data?.length ?? 0) > 0 && (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-400 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              Currently Halted Instruments ({haltedQuery.data?.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {haltedQuery.data?.map((halt) => (
                <div
                  key={halt.id}
                  className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-1.5 text-sm"
                >
                  <span className="font-semibold text-red-300">{halt.instrument}</span>
                  <span className="text-muted-foreground text-xs">
                    until {new Date(halt.haltUntil).toLocaleTimeString()}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1 text-xs text-emerald-400 hover:text-emerald-300"
                    onClick={() => liftHaltMutation.mutate({ eventId: Number(halt.id) })}
                    disabled={liftHaltMutation.isPending}
                  >
                    <Unlock className="h-3 w-3 mr-1" />
                    Lift
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="rules">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="rules">Circuit Breaker Rules</TabsTrigger>
          <TabsTrigger value="events">Halt Events</TabsTrigger>
          <TabsTrigger value="wash">Wash Trade Flags</TabsTrigger>
        </TabsList>

        {/* Rules Tab */}
        <TabsContent value="rules" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Instrument</TableHead>
                    <TableHead>Asset Class</TableHead>
                    <TableHead>Trigger %</TableHead>
                    <TableHead>Window</TableHead>
                    <TableHead>Halt Duration</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rulesQuery.isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        Loading rules…
                      </TableCell>
                    </TableRow>
                  )}
                  {!rulesQuery.isLoading && (rulesQuery.data?.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No circuit breaker rules configured. Create one to begin monitoring.
                      </TableCell>
                    </TableRow>
                  )}
                  {rulesQuery.data?.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="font-mono font-semibold">
                        {rule.instrument === "*" ? (
                          <span className="text-amber-400">* (all instruments)</span>
                        ) : rule.instrument}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{rule.assetClass}</Badge>
                      </TableCell>
                      <TableCell className="text-amber-400 font-semibold">
                        {parseFloat(rule.triggerPct).toFixed(2)}%
                      </TableCell>
                      <TableCell className="text-muted-foreground">{rule.windowMinutes}m</TableCell>
                      <TableCell className="text-muted-foreground">{rule.haltDurationMinutes}m</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={rule.isActive
                            ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                            : "bg-zinc-500/20 text-zinc-400 border-zinc-500/30"}
                        >
                          {rule.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => toggleRuleMutation.mutate({ ruleId: rule.id, isActive: !rule.isActive })}
                            disabled={toggleRuleMutation.isPending}
                          >
                            {rule.isActive ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-red-400 hover:text-red-300"
                            onClick={() => {
                              if (confirm(`Delete rule for ${rule.instrument}?`)) {
                                deleteRuleMutation.mutate({ ruleId: rule.id });
                              }
                            }}
                            disabled={deleteRuleMutation.isPending}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Events Tab */}
        <TabsContent value="events" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Instrument</TableHead>
                    <TableHead>Move %</TableHead>
                    <TableHead>Price Before</TableHead>
                    <TableHead>Price After</TableHead>
                    <TableHead>Halted At</TableHead>
                    <TableHead>Halt Until</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {eventsQuery.isLoading && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        Loading events…
                      </TableCell>
                    </TableRow>
                  )}
                  {!eventsQuery.isLoading && (eventsQuery.data?.events.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        No circuit breaker events recorded.
                      </TableCell>
                    </TableRow>
                  )}
                  {eventsQuery.data?.events.map((evt) => (
                    <TableRow key={evt.id}>
                      <TableCell className="font-mono font-semibold">{evt.instrument}</TableCell>
                      <TableCell className="text-red-400 font-semibold">
                        {parseFloat(evt.actualMovePct).toFixed(2)}%
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {parseFloat(evt.priceBefore).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {parseFloat(evt.priceAfter).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(evt.haltedAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(evt.haltUntil).toLocaleString()}
                      </TableCell>
                      <TableCell><StatusBadge status={evt.status} /></TableCell>
                      <TableCell>
                        {evt.status === "ACTIVE" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-emerald-400 hover:text-emerald-300"
                            onClick={() => liftHaltMutation.mutate({ eventId: Number(evt.id) })}
                            disabled={liftHaltMutation.isPending}
                          >
                            <Unlock className="h-3 w-3 mr-1" />
                            Lift
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {/* Pagination */}
              {(eventsQuery.data?.total ?? 0) > 20 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <span className="text-xs text-muted-foreground">
                    {eventsQuery.data?.total} total events
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setHaltEventPage(p => Math.max(1, p - 1))} disabled={haltEventPage === 1}>Prev</Button>
                    <Button size="sm" variant="outline" onClick={() => setHaltEventPage(p => p + 1)} disabled={(haltEventPage * 20) >= (eventsQuery.data?.total ?? 0)}>Next</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Wash Trade Flags Tab */}
        <TabsContent value="wash" className="mt-4">
          <div className="flex items-center gap-3 mb-3">
            <Select
              value={washStatusFilter || "ALL"}
              onValueChange={(v) => setWashStatusFilter(v === "ALL" ? "" : v as "PENDING" | "CONFIRMED" | "DISMISSED")}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="CONFIRMED">Confirmed</SelectItem>
                <SelectItem value="DISMISSED">Dismissed</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {washQuery.data?.total ?? 0} flags
            </span>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User ID</TableHead>
                    <TableHead>Instrument</TableHead>
                    <TableHead>Buy Order</TableHead>
                    <TableHead>Sell Order</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Window</TableHead>
                    <TableHead>Detected</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Penalty</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {washQuery.isLoading && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                        Loading flags…
                      </TableCell>
                    </TableRow>
                  )}
                  {!washQuery.isLoading && (washQuery.data?.flags.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                        No wash trade flags detected.
                      </TableCell>
                    </TableRow>
                  )}
                  {washQuery.data?.flags.map((flag) => (
                    <TableRow key={flag.id}>
                      <TableCell className="font-mono text-xs">{flag.userId}</TableCell>
                      <TableCell className="font-semibold">{flag.instrument}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">#{flag.buyOrderId}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">#{flag.sellOrderId}</TableCell>
                      <TableCell className="text-xs">
                        {flag.quantity ? parseFloat(flag.quantity).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{flag.windowMinutes}m</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(flag.detectedAt).toLocaleString()}
                      </TableCell>
                      <TableCell><StatusBadge status={flag.status} /></TableCell>
                      <TableCell>
                        {flag.penaltyApplied ? (
                          <CheckCircle className="h-4 w-4 text-red-400" />
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground/40" />
                        )}
                      </TableCell>
                      <TableCell>
                        {flag.status === "PENDING" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => setReviewFlagId(Number(flag.id))}
                          >
                            <Eye className="h-3 w-3 mr-1" />
                            Review
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {/* Pagination */}
              {(washQuery.data?.total ?? 0) > 20 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <span className="text-xs text-muted-foreground">
                    {washQuery.data?.total} total flags
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setWashPage(p => Math.max(1, p - 1))} disabled={washPage === 1}>Prev</Button>
                    <Button size="sm" variant="outline" onClick={() => setWashPage(p => p + 1)} disabled={(washPage * 20) >= (washQuery.data?.total ?? 0)}>Next</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <CreateRuleDialog open={showCreateRule} onClose={() => setShowCreateRule(false)} />
      <ReviewWashTradeDialog
        flagId={reviewFlagId}
        open={reviewFlagId !== null}
        onClose={() => setReviewFlagId(null)}
      />
    </div>
  );
}
