/**
 * NEXCOM Exchange — Corporate Actions
 * Dividends, splits, rights issues, IPOs, and other corporate events.
 * Admins can create, approve, reject, complete, and cancel actions.
 * Public users see a read-only view of approved/completed actions.
 */
import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Calendar, FileText, CheckCircle2, Clock, AlertCircle, Plus, Loader2, Search, RefreshCw, XCircle, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageSkeleton } from "@/components/PageSkeleton";

const ACTION_TYPES = ["DIVIDEND", "STOCK_SPLIT", "RIGHTS_ISSUE", "BONUS_ISSUE", "MERGER", "DELISTING", "IPO"] as const;
type ActionType = typeof ACTION_TYPES[number];

const ACTION_TYPE_ICONS: Record<string, string> = {
  DIVIDEND: "💰", STOCK_SPLIT: "✂️", RIGHTS_ISSUE: "📋", BONUS_ISSUE: "🎁",
  MERGER: "🤝", DELISTING: "🚫", IPO: "🚀",
};
const ACTION_TYPE_COLORS: Record<string, string> = {
  DIVIDEND:     "bg-positive/20 text-positive border-positive/30",
  STOCK_SPLIT:  "bg-blue-500/20 text-blue-400 border-blue-500/30",
  RIGHTS_ISSUE: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  BONUS_ISSUE:  "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  MERGER:       "bg-orange-500/20 text-orange-400 border-orange-500/30",
  DELISTING:    "bg-negative/20 text-negative border-negative/30",
  IPO:          "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
};
const STATUS_COLORS: Record<string, string> = {
  DRAFT:            "bg-muted text-muted-foreground",
  PENDING_APPROVAL: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  APPROVED:         "bg-positive/10 text-positive border-positive/30",
  REJECTED:         "bg-negative/10 text-negative border-negative/30",
  CANCELLED:        "bg-muted text-muted-foreground",
  COMPLETED:        "bg-blue-500/10 text-blue-400 border-blue-500/30",
};

type CorporateAction = {
  id: number;
  actionType: ActionType;
  status: string;
  symbol: string;
  title: string;
  description?: string | null;
  exDate?: Date | null;
  recordDate?: Date | null;
  paymentDate?: Date | null;
  announcementDate?: Date | null;
  dividendAmount?: string | null;
  dividendCurrency?: string | null;
  splitRatioFrom?: number | null;
  splitRatioTo?: number | null;
  rightsPrice?: string | null;
  rightsRatio?: string | null;
  ipoPrice?: string | null;
  ipoShares?: number | null;
  submittedAt?: Date | null;
  reviewedAt?: Date | null;
  reviewNotes?: string | null;
  createdAt?: Date | null;
};

function fmtDate(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// ── Create Dialog ─────────────────────────────────────────────────────────────
function CreateActionDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    actionType: "DIVIDEND" as ActionType,
    symbol: "", title: "", description: "",
    exDate: "", recordDate: "", paymentDate: "", announcementDate: "",
    dividendAmount: "", dividendCurrency: "USD",
    splitRatioFrom: "", splitRatioTo: "",
    rightsPrice: "", rightsRatio: "",
    ipoPrice: "", ipoShares: "",
  });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const createMutation = trpc.corporateActions.create.useMutation({
    onSuccess: () => { toast.success("Corporate action submitted for approval."); onCreated(); onClose(); },
    onError: (e) => toast.error(e.message),
  });

  function handleSubmit() {
    if (!form.symbol.trim() || !form.title.trim()) { toast.error("Symbol and title are required."); return; }
    createMutation.mutate({
      actionType: form.actionType,
      symbol: form.symbol.toUpperCase().trim(),
      title: form.title.trim(),
      description: form.description || undefined,
      exDate: form.exDate ? new Date(form.exDate) : undefined,
      recordDate: form.recordDate ? new Date(form.recordDate) : undefined,
      paymentDate: form.paymentDate ? new Date(form.paymentDate) : undefined,
      announcementDate: form.announcementDate ? new Date(form.announcementDate) : undefined,
      dividendAmount: form.dividendAmount ? parseFloat(form.dividendAmount) : undefined,
      dividendCurrency: form.dividendCurrency || undefined,
      splitRatioFrom: form.splitRatioFrom ? parseInt(form.splitRatioFrom) : undefined,
      splitRatioTo: form.splitRatioTo ? parseInt(form.splitRatioTo) : undefined,
      rightsPrice: form.rightsPrice ? parseFloat(form.rightsPrice) : undefined,
      rightsRatio: form.rightsRatio || undefined,
      ipoPrice: form.ipoPrice ? parseFloat(form.ipoPrice) : undefined,
      ipoShares: form.ipoShares ? parseInt(form.ipoShares) : undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create Corporate Action</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Action Type *</Label>
              <Select value={form.actionType} onValueChange={v => set("actionType", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTION_TYPES.map(t => <SelectItem key={t} value={t}>{ACTION_TYPE_ICONS[t]} {t.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Symbol *</Label>
              <Input placeholder="e.g. WHEAT-SPOT" value={form.symbol} onChange={e => set("symbol", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Title *</Label>
            <Input placeholder="e.g. Q1 2026 Dividend Declaration" value={form.title} onChange={e => set("title", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea placeholder="Optional details..." value={form.description} onChange={e => set("description", e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Announcement Date</Label><Input type="date" value={form.announcementDate} onChange={e => set("announcementDate", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Ex-Date</Label><Input type="date" value={form.exDate} onChange={e => set("exDate", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Record Date</Label><Input type="date" value={form.recordDate} onChange={e => set("recordDate", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Payment Date</Label><Input type="date" value={form.paymentDate} onChange={e => set("paymentDate", e.target.value)} /></div>
          </div>
          {form.actionType === "DIVIDEND" && (
            <div className="grid grid-cols-2 gap-4 p-3 bg-secondary/30 rounded-lg">
              <div className="space-y-1.5"><Label>Dividend Amount (per share)</Label><Input type="number" step="0.000001" placeholder="0.00" value={form.dividendAmount} onChange={e => set("dividendAmount", e.target.value)} /></div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={form.dividendCurrency} onValueChange={v => set("dividendCurrency", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem><SelectItem value="NGN">NGN</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem><SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          {form.actionType === "STOCK_SPLIT" && (
            <div className="grid grid-cols-2 gap-4 p-3 bg-secondary/30 rounded-lg">
              <div className="space-y-1.5"><Label>Split Ratio From</Label><Input type="number" min="1" placeholder="1" value={form.splitRatioFrom} onChange={e => set("splitRatioFrom", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Split Ratio To</Label><Input type="number" min="1" placeholder="2" value={form.splitRatioTo} onChange={e => set("splitRatioTo", e.target.value)} /></div>
            </div>
          )}
          {form.actionType === "RIGHTS_ISSUE" && (
            <div className="grid grid-cols-2 gap-4 p-3 bg-secondary/30 rounded-lg">
              <div className="space-y-1.5"><Label>Rights Price</Label><Input type="number" step="0.000001" placeholder="0.00" value={form.rightsPrice} onChange={e => set("rightsPrice", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Rights Ratio (e.g. "1:5")</Label><Input placeholder="1:5" value={form.rightsRatio} onChange={e => set("rightsRatio", e.target.value)} /></div>
            </div>
          )}
          {form.actionType === "IPO" && (
            <div className="grid grid-cols-2 gap-4 p-3 bg-secondary/30 rounded-lg">
              <div className="space-y-1.5"><Label>IPO Price</Label><Input type="number" step="0.000001" placeholder="0.00" value={form.ipoPrice} onChange={e => set("ipoPrice", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Total Shares Offered</Label><Input type="number" min="1" placeholder="1000000" value={form.ipoShares} onChange={e => set("ipoShares", e.target.value)} /></div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Submit for Approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Review Dialog ─────────────────────────────────────────────────────────────
function ReviewDialog({ action, mode, onClose, onDone }: {
  action: CorporateAction | null;
  mode: "approve" | "reject" | "complete" | "cancel";
  onClose: () => void;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState("");
  const utils = trpc.useUtils();
  const done = () => { onDone(); onClose(); utils.corporateActions.list.invalidate(); };

  const approveMutation = trpc.corporateActions.approve.useMutation({ onSuccess: () => { toast.success("Action approved."); done(); }, onError: e => toast.error(e.message) });
  const rejectMutation  = trpc.corporateActions.reject.useMutation({  onSuccess: () => { toast.success("Action rejected."); done(); }, onError: e => toast.error(e.message) });
  const completeMutation = trpc.corporateActions.complete.useMutation({ onSuccess: () => { toast.success("Action completed."); done(); }, onError: e => toast.error(e.message) });
  const cancelMutation  = trpc.corporateActions.cancel.useMutation({  onSuccess: () => { toast.success("Action cancelled."); done(); }, onError: e => toast.error(e.message) });

  if (!action) return null;
  const isPending = approveMutation.isPending || rejectMutation.isPending || completeMutation.isPending || cancelMutation.isPending;

  function handleConfirm() {
    if (!action) return;
    if (mode === "approve") approveMutation.mutate({ id: action.id, reviewNotes: notes || undefined });
    else if (mode === "reject") { if (!notes.trim()) { toast.error("Rejection reason is required."); return; } rejectMutation.mutate({ id: action.id, reviewNotes: notes }); }
    else if (mode === "complete") completeMutation.mutate({ id: action.id });
    else cancelMutation.mutate({ id: action.id, reviewNotes: notes || undefined });
  }

  const cfg = {
    approve:  { title: "Approve Action",       btn: "Approve",        variant: "default" as const },
    reject:   { title: "Reject Action",        btn: "Reject",         variant: "destructive" as const },
    complete: { title: "Mark as Completed",    btn: "Mark Completed", variant: "default" as const },
    cancel:   { title: "Cancel Action",        btn: "Cancel Action",  variant: "destructive" as const },
  }[mode];

  return (
    <Dialog open={!!action} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{cfg.title}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="p-3 bg-secondary/30 rounded-lg">
            <div className="text-sm font-semibold">{action.title}</div>
            <div className="text-xs text-muted-foreground font-mono">{action.symbol} · {action.actionType}</div>
          </div>
          <div className="space-y-1.5">
            <Label>{mode === "reject" ? "Rejection Reason *" : "Notes (optional)"}</Label>
            <Textarea
              placeholder={mode === "reject" ? "Explain why this action is being rejected..." : "Add any notes..."}
              value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant={cfg.variant} onClick={handleConfirm} disabled={isPending}>
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{cfg.btn}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CorporateActions() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<{ action: CorporateAction; mode: "approve" | "reject" | "complete" | "cancel" } | null>(null);
  const utils = trpc.useUtils();

  const statusFilter = tab === "all" ? undefined : tab.toUpperCase().replace("-", "_") as any;
  const { data, isLoading, refetch } = trpc.corporateActions.list.useQuery({
    status: statusFilter,
    symbol: search.trim() || undefined,
    limit: 100,
  }, { refetchInterval: 60_000 });

  const actions = (data?.actions ?? []) as CorporateAction[];

  const counts = {
    pending: actions.filter(a => a.status === "PENDING_APPROVAL").length,
    approved: actions.filter(a => a.status === "APPROVED").length,
    completed: actions.filter(a => a.status === "COMPLETED").length,
    total: data?.total ?? 0,
  };

  const TABS = [
    { id: "all",              label: "All",      icon: <FileText className="w-3.5 h-3.5" /> },
    { id: "pending_approval", label: "Pending",  icon: <Clock className="w-3.5 h-3.5" /> },
    { id: "approved",         label: "Approved", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
    { id: "completed",        label: "Completed",icon: <TrendingUp className="w-3.5 h-3.5" /> },
    { id: "rejected",         label: "Rejected", icon: <XCircle className="w-3.5 h-3.5" /> },
  ];

  if (isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Calendar className="w-6 h-6 text-primary" />
            Corporate Actions
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Dividends, splits, rights issues, mergers, delistings, and IPOs</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="w-4 h-4 mr-1.5" />Refresh</Button>
          {isAdmin && <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-1.5" />New Action</Button>}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Pending Approval", value: counts.pending,   color: "text-amber-400" },
          { label: "Approved",         value: counts.approved,  color: "text-positive" },
          { label: "Completed",        value: counts.completed, color: "text-blue-400" },
          { label: "Total Actions",    value: counts.total,     color: "text-foreground" },
        ].map(c => (
          <Card key={c.label} className="bg-card/50">
            <CardContent className="pt-4 pb-3">
              <div className={`text-2xl font-bold font-mono ${c.color}`}>{c.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{c.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search by symbol..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Tabs + Table */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          {TABS.map(t => (
            <TabsTrigger key={t.id} value={t.id} className="flex items-center gap-1.5">
              {t.icon}{t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map(t => (
          <TabsContent key={t.id} value={t.id}>
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin mr-2" />Loading corporate actions...
              </div>
            ) : actions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <AlertCircle className="w-8 h-8 opacity-40" />
                <span className="text-sm">No corporate actions found.</span>
                {isAdmin && <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>Create the first one</Button>}
              </div>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-secondary/50">
                      <TableHead>Type</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Ex-Date</TableHead>
                      <TableHead>Payment Date</TableHead>
                      <TableHead>Submitted</TableHead>
                      {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {actions.map(action => (
                      <TableRow key={action.id} className="hover:bg-secondary/20">
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] ${ACTION_TYPE_COLORS[action.actionType] ?? ""}`}>
                            {ACTION_TYPE_ICONS[action.actionType]} {action.actionType.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell><span className="font-mono text-sm font-semibold">{action.symbol}</span></TableCell>
                        <TableCell>
                          <div className="text-sm font-medium max-w-[200px] truncate">{action.title}</div>
                          {action.description && <div className="text-xs text-muted-foreground truncate max-w-[200px]">{action.description}</div>}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs ${STATUS_COLORS[action.status] ?? ""}`}>
                            {action.status.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtDate(action.exDate)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtDate(action.paymentDate)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtDate(action.submittedAt)}</TableCell>
                        {isAdmin && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {action.status === "PENDING_APPROVAL" && (
                                <>
                                  <Button size="sm" variant="outline" className="h-7 text-xs border-positive/30 text-positive hover:bg-positive hover:text-white" onClick={() => setReviewTarget({ action, mode: "approve" })}>Approve</Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs border-negative/30 text-negative hover:bg-negative hover:text-white" onClick={() => setReviewTarget({ action, mode: "reject" })}>Reject</Button>
                                </>
                              )}
                              {action.status === "APPROVED" && (
                                <Button size="sm" variant="outline" className="h-7 text-xs border-blue-500/30 text-blue-400 hover:bg-blue-500 hover:text-white" onClick={() => setReviewTarget({ action, mode: "complete" })}>Complete</Button>
                              )}
                              {["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(action.status) && (
                                <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-negative" onClick={() => setReviewTarget({ action, mode: "cancel" })}>Cancel</Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <CreateActionDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => utils.corporateActions.list.invalidate()} />
      {reviewTarget && (
        <ReviewDialog
          action={reviewTarget.action}
          mode={reviewTarget.mode}
          onClose={() => setReviewTarget(null)}
          onDone={() => utils.corporateActions.list.invalidate()}
        />
      )}
    </div>
  );
}
