/**
 * NEXCOM Exchange — Participant Performance Metrics
 * Admin page for recording and reviewing monthly broker/market-maker performance stats.
 */
import { useState, useMemo } from "react";
import {
  BarChart3, TrendingUp, Users, DollarSign, Star, Plus, Edit2, Trash2,
  Loader2, ChevronDown, Award, Activity, CheckCircle2, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

type ParticipantType = "BROKER" | "MARKET_MAKER";

interface MetricForm {
  userId: string;
  participantType: ParticipantType;
  periodYear: number;
  periodMonth: number;
  tradeCount: string;
  volumeUsd: string;
  clientCount: string;
  avgSpread: string;
  uptimePct: string;
  rating: string;
  complianceScore: string;
  notes: string;
}

const DEFAULT_FORM: MetricForm = {
  userId: "",
  participantType: "BROKER",
  periodYear: CURRENT_YEAR,
  periodMonth: new Date().getMonth() + 1,
  tradeCount: "",
  volumeUsd: "",
  clientCount: "",
  avgSpread: "",
  uptimePct: "",
  rating: "",
  complianceScore: "100",
  notes: "",
};

export default function PerformanceMetrics() {
  const [participantTypeFilter, setParticipantTypeFilter] = useState<ParticipantType | "ALL">("ALL");
  const [yearFilter, setYearFilter] = useState<number>(CURRENT_YEAR);
  const [monthFilter, setMonthFilter] = useState<number | undefined>(undefined);
  const [showDialog, setShowDialog] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<MetricForm>(DEFAULT_FORM);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const utils = trpc.useUtils();

  const metricsQuery = trpc.participantPerformance.adminList.useQuery({
    participantType: participantTypeFilter === "ALL" ? undefined : participantTypeFilter,
    periodYear: yearFilter,
    periodMonth: monthFilter,
    limit: 200,
  });

  const upsertMutation = trpc.participantPerformance.upsertMetrics.useMutation({
    onSuccess: () => {
      toast.success(editId ? "Metrics updated" : "Metrics recorded");
      utils.participantPerformance.adminList.invalidate();
      setShowDialog(false);
      setForm(DEFAULT_FORM);
      setEditId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.participantPerformance.deleteMetrics.useMutation({
    onSuccess: () => {
      toast.success("Record deleted");
      utils.participantPerformance.adminList.invalidate();
      setDeleteId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const metrics = metricsQuery.data?.metrics ?? [];

  // Summary cards
  const summary = useMemo(() => {
    const brokers = metrics.filter(m => m.participantType === "BROKER");
    const mms = metrics.filter(m => m.participantType === "MARKET_MAKER");
    const totalVol = metrics.reduce((s, m) => s + parseFloat(m.volumeUsd ?? "0"), 0);
    const avgRating = metrics.length > 0
      ? metrics.reduce((s, m) => s + parseFloat(m.rating ?? "0"), 0) / metrics.length
      : 0;
    return { brokers: brokers.length, mms: mms.length, totalVol, avgRating };
  }, [metrics]);

  function openCreate() {
    setForm(DEFAULT_FORM);
    setEditId(null);
    setShowDialog(true);
  }

  function openEdit(m: typeof metrics[0]) {
    setForm({
      userId: String(m.userId),
      participantType: m.participantType as ParticipantType,
      periodYear: m.periodYear,
      periodMonth: m.periodMonth,
      tradeCount: String(m.tradeCount ?? ""),
      volumeUsd: m.volumeUsd ?? "",
      clientCount: String(m.clientCount ?? ""),
      avgSpread: m.avgSpread ?? "",
      uptimePct: m.uptimePct ?? "",
      rating: m.rating ?? "",
      complianceScore: String(m.complianceScore ?? 100),
      notes: m.notes ?? "",
    });
    setEditId(m.id);
    setShowDialog(true);
  }

  function handleSubmit() {
    const userId = parseInt(form.userId);
    if (!userId || isNaN(userId)) { toast.error("User ID is required"); return; }
    upsertMutation.mutate({
      userId,
      participantType: form.participantType,
      periodYear: form.periodYear,
      periodMonth: form.periodMonth,
      tradeCount: form.tradeCount ? parseInt(form.tradeCount) : undefined,
      volumeUsd: form.volumeUsd ? parseFloat(form.volumeUsd) : undefined,
      clientCount: form.clientCount ? parseInt(form.clientCount) : undefined,
      avgSpread: form.avgSpread ? parseFloat(form.avgSpread) : undefined,
      uptimePct: form.uptimePct ? parseFloat(form.uptimePct) : undefined,
      rating: form.rating ? parseFloat(form.rating) : undefined,
      complianceScore: form.complianceScore ? parseInt(form.complianceScore) : undefined,
      notes: form.notes || undefined,
    });
  }

  function ratingColor(r: string | null) {
    if (!r) return "text-muted-foreground";
    const v = parseFloat(r);
    if (v >= 4) return "text-emerald-400";
    if (v >= 3) return "text-yellow-400";
    return "text-red-400";
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Award className="w-6 h-6 text-primary" />
            Participant Performance Metrics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monthly broker and market maker performance tracking
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="w-4 h-4" /> Record Metrics
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Users className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Brokers</p>
                <p className="text-xl font-bold text-foreground">{summary.brokers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Activity className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Market Makers</p>
                <p className="text-xl font-bold text-foreground">{summary.mms}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Volume</p>
                <p className="text-xl font-bold text-foreground">
                  ${summary.totalVol >= 1e6
                    ? `${(summary.totalVol / 1e6).toFixed(1)}M`
                    : summary.totalVol.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                <Star className="w-4 h-4 text-yellow-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg Rating</p>
                <p className="text-xl font-bold text-foreground">
                  {summary.avgRating > 0 ? summary.avgRating.toFixed(2) : "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="bg-card border-border">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-3">
            <Select value={participantTypeFilter} onValueChange={(v) => setParticipantTypeFilter(v as typeof participantTypeFilter)}>
              <SelectTrigger className="w-44 bg-background border-border">
                <SelectValue placeholder="Participant Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Types</SelectItem>
                <SelectItem value="BROKER">Brokers</SelectItem>
                <SelectItem value="MARKET_MAKER">Market Makers</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(yearFilter)} onValueChange={(v) => setYearFilter(parseInt(v))}>
              <SelectTrigger className="w-28 bg-background border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select
              value={monthFilter ? String(monthFilter) : "ALL"}
              onValueChange={(v) => setMonthFilter(v === "ALL" ? undefined : parseInt(v))}
            >
              <SelectTrigger className="w-36 bg-background border-border">
                <SelectValue placeholder="All Months" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Months</SelectItem>
                {MONTHS.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Metrics Table */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-foreground">Performance Records</CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            {metrics.length} record{metrics.length !== 1 ? "s" : ""} found
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {metricsQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : metrics.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No performance records found for the selected period.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={openCreate}>
                Record First Metrics
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground text-xs">User ID</TableHead>
                    <TableHead className="text-muted-foreground text-xs">Type</TableHead>
                    <TableHead className="text-muted-foreground text-xs">Period</TableHead>
                    <TableHead className="text-muted-foreground text-xs text-right">Trades</TableHead>
                    <TableHead className="text-muted-foreground text-xs text-right">Volume (USD)</TableHead>
                    <TableHead className="text-muted-foreground text-xs text-right">Clients</TableHead>
                    <TableHead className="text-muted-foreground text-xs text-right">Uptime</TableHead>
                    <TableHead className="text-muted-foreground text-xs text-right">Rating</TableHead>
                    <TableHead className="text-muted-foreground text-xs text-right">Compliance</TableHead>
                    <TableHead className="text-muted-foreground text-xs w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.map(m => (
                    <TableRow key={m.id} className="border-border hover:bg-muted/30">
                      <TableCell className="text-sm font-mono text-foreground">#{m.userId}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={
                          m.participantType === "BROKER"
                            ? "border-blue-500/30 text-blue-400 text-xs"
                            : "border-purple-500/30 text-purple-400 text-xs"
                        }>
                          {m.participantType === "BROKER" ? "Broker" : "Market Maker"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {MONTHS[m.periodMonth - 1]?.slice(0, 3)} {m.periodYear}
                      </TableCell>
                      <TableCell className="text-sm text-right text-foreground">{(m.tradeCount ?? 0).toLocaleString()}</TableCell>
                      <TableCell className="text-sm text-right text-foreground">
                        ${parseFloat(m.volumeUsd ?? "0").toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </TableCell>
                      <TableCell className="text-sm text-right text-foreground">{m.clientCount ?? 0}</TableCell>
                      <TableCell className="text-sm text-right">
                        {m.uptimePct ? (
                          <span className={parseFloat(m.uptimePct) >= 90 ? "text-emerald-400" : "text-red-400"}>
                            {parseFloat(m.uptimePct).toFixed(1)}%
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-right">
                        {m.rating ? (
                          <span className={ratingColor(m.rating)}>
                            ★ {parseFloat(m.rating).toFixed(2)}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-right">
                        <span className={
                          (m.complianceScore ?? 100) >= 90 ? "text-emerald-400" :
                          (m.complianceScore ?? 100) >= 70 ? "text-yellow-400" : "text-red-400"
                        }>
                          {m.complianceScore ?? 100}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => openEdit(m)}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-red-400"
                            onClick={() => setDeleteId(m.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={(o) => { if (!o) { setShowDialog(false); setEditId(null); setForm(DEFAULT_FORM); } }}>
        <DialogContent className="max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {editId ? "Edit Performance Metrics" : "Record Performance Metrics"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">User ID *</Label>
                <Input
                  type="number"
                  placeholder="e.g. 42"
                  value={form.userId}
                  onChange={e => setForm(f => ({ ...f, userId: e.target.value }))}
                  className="bg-background border-border text-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Participant Type *</Label>
                <Select value={form.participantType} onValueChange={(v) => setForm(f => ({ ...f, participantType: v as ParticipantType }))}>
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BROKER">Broker</SelectItem>
                    <SelectItem value="MARKET_MAKER">Market Maker</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Year *</Label>
                <Select value={String(form.periodYear)} onValueChange={(v) => setForm(f => ({ ...f, periodYear: parseInt(v) }))}>
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Month *</Label>
                <Select value={String(form.periodMonth)} onValueChange={(v) => setForm(f => ({ ...f, periodMonth: parseInt(v) }))}>
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Trade Count</Label>
                <Input type="number" placeholder="0" value={form.tradeCount} onChange={e => setForm(f => ({ ...f, tradeCount: e.target.value }))} className="bg-background border-border text-foreground" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Volume (USD)</Label>
                <Input type="number" placeholder="0.00" value={form.volumeUsd} onChange={e => setForm(f => ({ ...f, volumeUsd: e.target.value }))} className="bg-background border-border text-foreground" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Client Count</Label>
                <Input type="number" placeholder="0" value={form.clientCount} onChange={e => setForm(f => ({ ...f, clientCount: e.target.value }))} className="bg-background border-border text-foreground" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Avg Spread (bps)</Label>
                <Input type="number" placeholder="0.00" value={form.avgSpread} onChange={e => setForm(f => ({ ...f, avgSpread: e.target.value }))} className="bg-background border-border text-foreground" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Uptime %</Label>
                <Input type="number" placeholder="99.9" min="0" max="100" value={form.uptimePct} onChange={e => setForm(f => ({ ...f, uptimePct: e.target.value }))} className="bg-background border-border text-foreground" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Rating (0–5)</Label>
                <Input type="number" placeholder="4.5" min="0" max="5" step="0.1" value={form.rating} onChange={e => setForm(f => ({ ...f, rating: e.target.value }))} className="bg-background border-border text-foreground" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Compliance Score (0–100)</Label>
                <Input type="number" placeholder="100" min="0" max="100" value={form.complianceScore} onChange={e => setForm(f => ({ ...f, complianceScore: e.target.value }))} className="bg-background border-border text-foreground" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Notes</Label>
                <Input placeholder="Optional notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="bg-background border-border text-foreground" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDialog(false); setEditId(null); setForm(DEFAULT_FORM); }}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={upsertMutation.isPending}>
              {upsertMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editId ? "Update" : "Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteId !== null} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <DialogContent className="max-w-sm bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Delete Record?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            This will permanently delete this performance record. This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && deleteMutation.mutate({ id: deleteId })}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
