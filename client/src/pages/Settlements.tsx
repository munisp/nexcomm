/**
 * NEXCOM Exchange — Settlements & Clearing
 * T+2 settlement tracking for all filled orders.
 * Users see their own settlements; admins see all and can update status.
 */
import { useState, useEffect } from "react";

// ─── Settlement countdown timer ───────────────────────────────────────────────
function SettlementCountdown({ settlementDate, status }: { settlementDate: Date | null; status: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!settlementDate || status === "SETTLED" || status === "FAILED") return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [settlementDate, status]);

  if (!settlementDate) return <span className="text-muted-foreground">—</span>;

  const target = new Date(settlementDate).getTime();
  const diffMs = target - now;

  if (status === "SETTLED") {
    return (
      <span className="text-xs text-green-400 font-medium flex items-center gap-1">
        <CheckCircle className="w-3 h-3" />
        Settled {new Date(settlementDate).toLocaleDateString()}
      </span>
    );
  }

  if (diffMs <= 0) {
    return (
      <span className="text-xs text-amber-400 font-medium flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" />
        Overdue
      </span>
    );
  }

  const totalMins = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;

  const isUrgent = days === 0;

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{new Date(settlementDate).toLocaleDateString()}</span>
      <span className={`text-xs font-mono font-semibold flex items-center gap-1 ${
        isUrgent ? "text-amber-400" : "text-slate-300"
      }`}>
        <Clock className="w-3 h-3" />
        {days > 0 ? `${days}d ${hours}h` : `${hours}h ${mins}m`}
      </span>
    </div>
  );
}
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePreferences } from "@/contexts/PreferencesContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { CheckCircle, Clock, XCircle, AlertTriangle, RefreshCw, Filter, Shield, Zap, TrendingUp, BarChart2 } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useOfflineQueue } from "@/hooks/useOfflineQueue";

const STATUS_COLORS: Record<string, string> = {
  PENDING:   "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  MATCHED:   "bg-blue-500/20 text-blue-400 border-blue-500/30",
  SETTLED:   "bg-green-500/20 text-green-400 border-green-500/30",
  FAILED:    "bg-red-500/20 text-red-400 border-red-500/30",
  DISPUTED:  "bg-orange-500/20 text-orange-400 border-orange-500/30",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  PENDING:   <Clock className="w-3 h-3" />,
  MATCHED:   <CheckCircle className="w-3 h-3" />,
  SETTLED:   <CheckCircle className="w-3 h-3" />,
  FAILED:    <XCircle className="w-3 h-3" />,
  DISPUTED:  <AlertTriangle className="w-3 h-3" />,
};

// ─── Settlement Status Timeline ───────────────────────────────────────────────
const SETTLEMENT_STEPS = [
  { key: "PENDING",  label: "Pending",  desc: "Order filled, awaiting matching" },
  { key: "MATCHED",  label: "Matched",  desc: "Counterparty matched, clearing in progress" },
  { key: "SETTLED",  label: "Settled",  desc: "Funds and securities transferred" },
];

function SettlementStatusTimeline({ status, settlementDate }: { status: string; settlementDate: Date | null }) {
  const isFailed   = status === "FAILED";
  const isDisputed = status === "DISPUTED";
  const currentIdx = SETTLEMENT_STEPS.findIndex(s => s.key === status);

  return (
    <div className="py-3 px-4">
      <div className="flex items-start gap-0">
        {SETTLEMENT_STEPS.map((step, idx) => {
          const isPast    = !isFailed && !isDisputed && idx < currentIdx;
          const isCurrent = !isFailed && !isDisputed && idx === currentIdx;
          const isFuture  = idx > currentIdx || isFailed || isDisputed;
          return (
            <div key={step.key} className="flex items-start flex-1">
              <div className="flex flex-col items-center">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 text-xs font-bold ${
                  isPast    ? "bg-green-500 border-green-500 text-white" :
                  isCurrent ? "bg-blue-500 border-blue-500 text-white animate-pulse" :
                              "bg-muted border-muted-foreground/30 text-muted-foreground"
                }`}>
                  {isPast ? <CheckCircle className="w-3.5 h-3.5" /> : idx + 1}
                </div>
                <p className={`text-xs font-medium mt-1 text-center ${
                  isPast ? "text-green-400" : isCurrent ? "text-blue-400" : "text-muted-foreground"
                }`}>{step.label}</p>
                <p className="text-xs text-muted-foreground/70 text-center max-w-[80px] leading-tight mt-0.5">{step.desc}</p>
              </div>
              {idx < SETTLEMENT_STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mt-3.5 mx-1 ${
                  isPast ? "bg-green-500" : "bg-muted-foreground/20"
                }`} />
              )}
            </div>
          );
        })}
      </div>
      {(isFailed || isDisputed) && (
        <div className={`mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-md ${
          isFailed ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-orange-500/10 text-orange-400 border border-orange-500/20"
        }`}>
          {isFailed ? <XCircle className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
          {isFailed ? "Settlement failed — contact support to resolve" : "Settlement disputed — under review"}
        </div>
      )}
      {settlementDate && (
        <p className="text-xs text-muted-foreground mt-2">Settlement date: {new Date(settlementDate).toLocaleDateString()}</p>
      )}
    </div>
  );
}

export default function Settlements() {
  const { user } = useAuth();
  const { formatCurrency, t } = usePreferences();
  const isAdmin = user?.role === "admin";

  const [statusFilter, setStatusFilter] = useState("ALL");
  const [assetFilter, setAssetFilter] = useState("ALL");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [updateDialog, setUpdateDialog] = useState<{ id: number; currentStatus: string } | null>(null);
  const [newStatus, setNewStatus] = useState<string>("MATCHED");
  const [notes, setNotes] = useState("");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const utils = trpc.useUtils();

  const { data: summary } = trpc.settlements.summary.useQuery();
  const { enqueue, queueDepth } = useOfflineQueue();
  const { data: metrics } = trpc.settlements.settlementMetrics.useQuery({ days: 7 });
  const { data: list = [], isLoading, refetch } = trpc.settlements.list.useQuery({
    status: statusFilter === "ALL" ? undefined : statusFilter as any,
    limit: 100,
  });

  const updateStatus = trpc.settlements.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("Settlement status updated");
      utils.settlements.list.invalidate();
      utils.settlements.summary.invalidate();
      setUpdateDialog(null);
      setNotes("");
    },
    onError: (e) => toast.error(e.message),
  });

  const adminProcess = trpc.settlements.adminProcess.useMutation({
    onSuccess: (data) => {
      toast.success(`Processed ${data.processed} settlement${data.processed !== 1 ? "s" : ""} — T+2 cycle complete`);
      utils.settlements.list.invalidate();
      utils.settlements.summary.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const bulkSettle = trpc.settlements.bulkSettle.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.settled} settlements marked as SETTLED`);
      utils.settlements.list.invalidate();
      utils.settlements.summary.invalidate();
      setSelectedIds([]);
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const selectAll = () => {
    const matchedIds = list.filter(s => s.status === "MATCHED").map(s => s.id);
    setSelectedIds(matchedIds);
  };

  const summaryCards = [
    { label: "Total", value: summary?.total ?? 0, icon: <Filter className="w-4 h-4" />, color: "text-foreground" },
    { label: "Pending", value: summary?.pending ?? 0, icon: <Clock className="w-4 h-4" />, color: "text-yellow-400" },
    { label: "Matched", value: summary?.matched ?? 0, icon: <CheckCircle className="w-4 h-4" />, color: "text-blue-400" },
    { label: "Settled", value: summary?.settled ?? 0, icon: <CheckCircle className="w-4 h-4" />, color: "text-green-400" },
    { label: "Failed", value: summary?.failed ?? 0, icon: <XCircle className="w-4 h-4" />, color: "text-red-400" },
    { label: "Net Settled", value: formatCurrency(summary?.totalNetAmount ?? 0, true), icon: <Shield className="w-4 h-4" />, color: "text-emerald-400" },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Settlements &amp; Clearing</h1>
          <p className="text-muted-foreground text-sm mt-1">T+2 settlement tracking for all filled orders</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && selectedIds.length > 0 && (
            <Button
              variant="default"
              size="sm"
              onClick={() => bulkSettle.mutate({ ids: selectedIds })}
              disabled={bulkSettle.isPending}
            >
              {bulkSettle.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
              Settle {selectedIds.length} Selected
            </Button>
          )}
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={selectAll}>
              Select All Matched
            </Button>
          )}
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => adminProcess.mutate()}
              disabled={adminProcess.isPending}
              title="Process all MATCHED settlements whose T+2 date has passed"
            >
              {adminProcess.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Shield className="w-4 h-4 mr-1" />}
              Process T+2
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {summaryCards.map(card => (
          <Card key={card.label} className="bg-card/50">
            <CardContent className="p-4">
              <div className={`flex items-center gap-2 ${card.color} mb-1`}>
                {card.icon}
                <span className="text-xs font-medium">{card.label}</span>
              </div>
              <div className="text-xl font-bold">{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* T+0 vs T+1 Settlement Timing Widget */}
      <Card className="bg-card/50 border-emerald-500/20">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-400" />
              <CardTitle className="text-base">Real-Time Settlement Performance</CardTitle>
            </div>
            <span className="text-xs text-muted-foreground">Last 7 days</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs font-semibold text-emerald-400">T+0 (Same Day)</span>
              </div>
              <div className="text-3xl font-bold text-emerald-400">{metrics?.t0Pct ?? 0}%</div>
              <div className="text-xs text-muted-foreground">{metrics?.t0Count ?? 0} settlements</div>
              <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                <div className="bg-emerald-400 h-1.5 rounded-full transition-all" style={{ width: `${metrics?.t0Pct ?? 0}%` }} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-blue-400" />
                <span className="text-xs font-semibold text-blue-400">T+1 (Next Day)</span>
              </div>
              <div className="text-3xl font-bold text-blue-400">{metrics?.t1Pct ?? 0}%</div>
              <div className="text-xs text-muted-foreground">{metrics?.t1Count ?? 0} settlements</div>
              <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                <div className="bg-blue-400 h-1.5 rounded-full transition-all" style={{ width: `${metrics?.t1Pct ?? 0}%` }} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="text-xs font-semibold text-amber-400">T+2+ (Delayed)</span>
              </div>
              <div className="text-3xl font-bold text-amber-400">{metrics?.t2PlusPct ?? 0}%</div>
              <div className="text-xs text-muted-foreground">{metrics?.t2PlusCount ?? 0} settlements</div>
              <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                <div className="bg-amber-400 h-1.5 rounded-full transition-all" style={{ width: `${metrics?.t2PlusPct ?? 0}%` }} />
              </div>
            </div>
            <div className="flex flex-col gap-1 border-l border-border pl-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground">Avg Settlement Time</span>
              </div>
              <div className="text-3xl font-bold">
                {metrics?.avgSettlementHours != null
                  ? metrics.avgSettlementHours < 1
                    ? `${Math.round(metrics.avgSettlementHours * 60)}m`
                    : `${metrics.avgSettlementHours}h`
                  : "—"}
              </div>
              <div className="text-xs text-muted-foreground">{metrics?.totalSettled ?? 0} total settled</div>
              <div className="mt-2 flex items-center gap-1.5">
                <BarChart2 className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Target: T+0 ≥ 80%</span>
              </div>
              <div className="mt-1">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  (metrics?.t0Pct ?? 0) >= 80 ? "bg-emerald-500/20 text-emerald-400"
                  : (metrics?.t0Pct ?? 0) >= 50 ? "bg-blue-500/20 text-blue-400"
                  : "bg-amber-500/20 text-amber-400"
                }`}>
                  {(metrics?.t0Pct ?? 0) >= 80 ? "On Target" : (metrics?.t0Pct ?? 0) >= 50 ? "Near Target" : "Below Target"}
                </span>
              </div>
            </div>
          </div>
          {metrics?.dailyBreakdown && metrics.dailyBreakdown.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground mb-2">Daily settlement breakdown</p>
              <div className="flex items-end gap-1 h-14">
                {metrics.dailyBreakdown.map((day) => {
                  const total = day.total || 1;
                  const t0H = Math.round((day.t0 / total) * 40);
                  const t1H = Math.round((day.t1 / total) * 40);
                  const t2H = Math.round((day.t2plus / total) * 40);
  if (isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
                  return (
                    <div key={day.date} className="flex-1 flex flex-col items-center gap-0.5" title={`${day.date}: ${day.t0} T+0, ${day.t1} T+1, ${day.t2plus} T+2+`}>
                      <div className="w-full flex flex-col-reverse rounded-sm overflow-hidden" style={{ height: 40 }}>
                        {t2H > 0 && <div className="w-full bg-amber-400/70" style={{ height: t2H }} />}
                        {t1H > 0 && <div className="w-full bg-blue-400/70" style={{ height: t1H }} />}
                        {t0H > 0 && <div className="w-full bg-emerald-400/70" style={{ height: t0H }} />}
                      </div>
                      <span className="text-[9px] text-muted-foreground">{day.date.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Settlement Ledger</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 mb-4">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="MATCHED">Matched</SelectItem>
                <SelectItem value="SETTLED">Settled</SelectItem>
                <SelectItem value="FAILED">Failed</SelectItem>
                <SelectItem value="DISPUTED">Disputed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={assetFilter} onValueChange={setAssetFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Asset Class" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Asset Classes</SelectItem>
                <SelectItem value="COMMODITY">Commodity</SelectItem>
                <SelectItem value="FOREX">Forex</SelectItem>
                <SelectItem value="EQUITY">Equity</SelectItem>
                <SelectItem value="DIGITAL_ASSET">Digital Asset</SelectItem>
                <SelectItem value="INDEX">Index</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading settlements...
            </div>
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Shield className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">No settlements found</p>
              <p className="text-xs mt-1">Settlements are created automatically when orders are filled</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {isAdmin && <TableHead className="w-10"></TableHead>}
                    <TableHead>ID</TableHead>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Gross</TableHead>
                    <TableHead>Fee</TableHead>
                    <TableHead>Net</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead>Settlement Date</TableHead>
                    <TableHead>Status</TableHead>
                    {isAdmin && <TableHead>Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map(s => (
                  <>
                    <TableRow
                      key={s.id}
                      className={`cursor-pointer hover:bg-muted/30 transition-colors ${selectedIds.includes(s.id) ? "bg-primary/5" : ""}`}
                      onClick={() => setExpandedRow(prev => prev === s.id ? null : s.id)}
                    >
                      {isAdmin && (
                        <TableCell>
                          {s.status === "MATCHED" && (
                            <Checkbox
                              checked={selectedIds.includes(s.id)}
                              onCheckedChange={() => toggleSelect(s.id)}
                            />
                          )}
                        </TableCell>
                      )}
                      <TableCell className="font-mono text-xs">#{s.id}</TableCell>
                      <TableCell className="font-medium">{s.symbol}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={s.side === "BUY" ? "text-green-400 border-green-500/30" : "text-red-400 border-red-500/30"}>
                          {s.side}
                        </Badge>
                      </TableCell>
                      <TableCell>{Number(s.quantity).toLocaleString()}</TableCell>
                      <TableCell>{formatCurrency(Number(s.price))}</TableCell>
                      <TableCell>{formatCurrency(Number(s.grossAmount))}</TableCell>
                      <TableCell className="text-muted-foreground">{formatCurrency(Number(s.fee))}</TableCell>
                      <TableCell className="font-semibold">{formatCurrency(Number(s.netAmount))}</TableCell>
                      <TableCell>{s.currency}</TableCell>
                      <TableCell>
                        <SettlementCountdown
                          settlementDate={s.settlementDate ? new Date(s.settlementDate) : null}
                          status={s.status}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`flex items-center gap-1 w-fit ${STATUS_COLORS[s.status] ?? ""}`}>
                          {STATUS_ICONS[s.status]}
                          {s.status}
                        </Badge>
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); setUpdateDialog({ id: s.id, currentStatus: s.status }); setNewStatus("MATCHED"); }}
                          >
                            Update
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                    {expandedRow === s.id && (
                      <TableRow key={`${s.id}-timeline`} className="bg-muted/10 hover:bg-muted/10">
                        <TableCell colSpan={isAdmin ? 14 : 12} className="p-0">
                          <SettlementStatusTimeline
                            status={s.status}
                            settlementDate={s.settlementDate ? new Date(s.settlementDate) : null}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Admin: Update status dialog */}
      <Dialog open={!!updateDialog} onOpenChange={() => setUpdateDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Settlement Status</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">New Status</label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MATCHED">Matched</SelectItem>
                  <SelectItem value="SETTLED">Settled</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                  <SelectItem value="DISPUTED">Disputed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Notes (optional)</label>
              <Input
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Add a note about this status change..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateDialog(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!updateDialog) return;
                updateStatus.mutate({
                  settlementId: updateDialog.id,
                  status: newStatus as any,
                  notes: notes || undefined,
                });
              }}
              disabled={updateStatus.isPending}
            >
              {updateStatus.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
              Update Status
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
