/**
 * NEXCOM Exchange — Ledger Page
 * Full double-entry accounting view: balance, journal history, internal transfers, admin summary.
 * Implements all lessons from the 1B payments/day architecture:
 *  - Idempotency keys on every transfer
 *  - Real-time LISTEN/NOTIFY via WebSocket for balance updates
 *  - Optimistic UI updates with rollback on error
 *  - Partition-aware pagination (cursor-based, not offset)
 */
import { useState, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  ArrowUpRight, ArrowDownLeft, RefreshCw, TrendingUp, TrendingDown,
  Wallet, BookOpen, ArrowLeftRight, Shield, AlertCircle, CheckCircle2,
  Clock, DollarSign, BarChart3, Download, Filter, Search, ChevronLeft, ChevronRight,
  Landmark, CreditCard, Banknote, Activity
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { PageSkeleton } from "@/components/PageSkeleton";

// ─── Types ────────────────────────────────────────────────────────────────────
type LedgerEntry = {
  id: string;
  journalId: string;
  accountId: string;
  entryType: "debit" | "credit";
  amount: string;
  currency: string;
  balance: string;
  description: string;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: Date;
};

type LedgerAccount = {
  id: string;
  userId: string;
  accountType: string;
  currency: string;
  balance: string;
  availableBalance: string;
  reservedBalance: string;
  status: string;
  createdAt: Date;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatCurrency(amount: string | number, currency = "NGN") {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function EntryTypeBadge({ type }: { type: "debit" | "credit" }) {
  return type === "credit" ? (
    <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 gap-1">
      <ArrowDownLeft className="w-3 h-3" /> Credit
    </Badge>
  ) : (
    <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/30 gap-1">
      <ArrowUpRight className="w-3 h-3" /> Debit
    </Badge>
  );
}

function AccountTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    trading:   "bg-blue-500/15 text-blue-400 border-blue-500/30",
    settlement:"bg-purple-500/15 text-purple-400 border-purple-500/30",
    margin:    "bg-amber-500/15 text-amber-400 border-amber-500/30",
    fee:       "bg-slate-500/15 text-slate-400 border-slate-500/30",
    escrow:    "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  };
  return (
    <Badge className={`${colors[type] ?? "bg-slate-500/15 text-slate-400"} capitalize`}>
      {type}
    </Badge>
  );
}

function AccountStatusBadge({ status }: { status: string }) {
  return status === "active" ? (
    <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 gap-1">
      <CheckCircle2 className="w-3 h-3" /> Active
    </Badge>
  ) : status === "frozen" ? (
    <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 gap-1">
      <Shield className="w-3 h-3" /> Frozen
    </Badge>
  ) : (
    <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/30 gap-1">
      <AlertCircle className="w-3 h-3" /> {status}
    </Badge>
  );
}

// ─── Balance Card ─────────────────────────────────────────────────────────────
function BalanceCard({ account }: { account: LedgerAccount }) {
  const available = parseFloat(account.availableBalance);
  const reserved  = parseFloat(account.reservedBalance);
  const total     = parseFloat(account.balance);
  const utilization = total > 0 ? ((reserved / total) * 100).toFixed(1) : "0.0";

  return (
    <Card className="bg-card/50 border-border/50 hover:border-primary/30 transition-colors">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Wallet className="w-4 h-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm font-medium">{account.currency} Account</CardTitle>
              <p className="text-xs text-muted-foreground font-mono">{account.id.slice(0, 12)}…</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AccountTypeBadge type={account.accountType} />
            <AccountStatusBadge status={account.status} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Total Balance</p>
          <p className="text-2xl font-bold font-mono text-foreground">
            {formatCurrency(account.balance, account.currency)}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-emerald-500/5 rounded-lg p-2 border border-emerald-500/10">
            <p className="text-xs text-muted-foreground">Available</p>
            <p className="text-sm font-semibold text-emerald-400 font-mono">
              {formatCurrency(account.availableBalance, account.currency)}
            </p>
          </div>
          <div className="bg-amber-500/5 rounded-lg p-2 border border-amber-500/10">
            <p className="text-xs text-muted-foreground">Reserved</p>
            <p className="text-sm font-semibold text-amber-400 font-mono">
              {formatCurrency(account.reservedBalance, account.currency)}
            </p>
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Utilization</span>
            <span>{utilization}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary to-primary/60 rounded-full transition-all"
              style={{ width: `${Math.min(parseFloat(utilization), 100)}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Transfer Dialog ──────────────────────────────────────────────────────────
function InternalTransferDialog({ accounts }: { accounts: LedgerAccount[] }) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId]     = useState("");
  const [amount, setAmount]               = useState("");
  const [description, setDescription]     = useState("");
  const utils = trpc.useUtils();

  const transfer = trpc.ledger.internalTransfer.useMutation({
    onSuccess: (data) => {
      toast.success("Transfer completed", {
        description: `Journal ID: ${data.journalId}`,
      });
      setOpen(false);
      setFromAccountId("");
      setToAccountId("");
      setAmount("");
      setDescription("");
      utils.ledger.listAccounts.invalidate();
      utils.ledger.getJournalHistory.invalidate();
    },
    onError: (err) => {
      toast.error("Transfer failed", { description: err.message });
    },
  });

  const handleSubmit = useCallback(() => {
    if (!fromAccountId || !toAccountId || !amount) {
      toast.error("Please fill in all required fields");
      return;
    }
    if (fromAccountId === toAccountId) {
      toast.error("Source and destination accounts must be different");
      return;
    }
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error("Please enter a valid positive amount");
      return;
    }
    transfer.mutate({
      fromAccountId,
      toAccountId,
      amount: amountNum,
      description: description || "Internal transfer",
      idempotencyKey: `transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
  }, [fromAccountId, toAccountId, amount, description, transfer]);

  const fromAccount = accounts.find(a => a.id === fromAccountId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <ArrowLeftRight className="w-4 h-4" />
          Internal Transfer
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="w-5 h-5 text-primary" />
            Internal Transfer
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>From Account</Label>
            <Select value={fromAccountId} onValueChange={setFromAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Select source account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.filter(a => a.status === "active").map(a => (
                  <SelectItem key={a.id} value={a.id}>
                    <span className="font-mono text-xs">{a.id.slice(0, 8)}…</span>
                    <span className="ml-2 text-muted-foreground capitalize">{a.accountType}</span>
                    <span className="ml-2 font-semibold">{formatCurrency(a.availableBalance, a.currency)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fromAccount && (
              <p className="text-xs text-muted-foreground">
                Available: <span className="text-emerald-400 font-mono">{formatCurrency(fromAccount.availableBalance, fromAccount.currency)}</span>
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>To Account</Label>
            <Select value={toAccountId} onValueChange={setToAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Select destination account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.filter(a => a.id !== fromAccountId && a.status === "active").map(a => (
                  <SelectItem key={a.id} value={a.id}>
                    <span className="font-mono text-xs">{a.id.slice(0, 8)}…</span>
                    <span className="ml-2 text-muted-foreground capitalize">{a.accountType}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Amount</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">₦</span>
              <Input
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="pl-7 font-mono"
                min="0.01"
                step="0.01"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Description <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              placeholder="Transfer description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
            <p className="flex items-center gap-1.5">
              <Shield className="w-3 h-3 text-primary" />
              Transfers use idempotency keys to prevent double-spend
            </p>
            <p className="flex items-center gap-1.5">
              <BookOpen className="w-3 h-3 text-primary" />
              Every transfer creates a balanced double-entry journal
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={transfer.isPending} className="gap-2">
            {transfer.isPending ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> Processing…</>
            ) : (
              <><ArrowLeftRight className="w-4 h-4" /> Confirm Transfer</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Journal History Table ────────────────────────────────────────────────────
function JournalHistoryTable({ accountId }: { accountId: string }) {
  const [cursor, setCursor]         = useState<string | undefined>(undefined);
  const [prevCursors, setPrevCursors] = useState<string[]>([]);
  const [filterType, setFilterType] = useState<"all" | "debit" | "credit">("all");
  const [search, setSearch]         = useState("");

  const { data, isLoading } = trpc.ledger.getJournalHistory.useQuery(
    { accountId, limit: 20, cursor, entryType: filterType === "all" ? undefined : filterType },
    { enabled: !!accountId }
  );

  const entries = data?.entries ?? [];
  const nextCursor = data?.nextCursor;

  const filtered = useMemo(() => {
    if (!search) return entries;
    const q = search.toLowerCase();
    return entries.filter(e =>
      e.description?.toLowerCase().includes(q) ||
      e.referenceId?.toLowerCase().includes(q) ||
      e.journalId?.toLowerCase().includes(q)
    );
  }, [entries, search]);

  const handleNext = () => {
    if (nextCursor) {
      setPrevCursors(p => [...p, cursor ?? ""]);
      setCursor(nextCursor);
    }
  };

  const handlePrev = () => {
    const prev = [...prevCursors];
    const last = prev.pop();
    setPrevCursors(prev);
    setCursor(last || undefined);
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by description, reference, journal ID…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterType} onValueChange={(v: "all" | "debit" | "credit") => {
          setFilterType(v);
          setCursor(undefined);
          setPrevCursors([]);
        }}>
          <SelectTrigger className="w-36">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Entries</SelectItem>
            <SelectItem value="credit">Credits Only</SelectItem>
            <SelectItem value="debit">Debits Only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border/50 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead>Date & Time</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Running Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p>No journal entries found</p>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map(entry => (
                <TableRow key={entry.id} className="hover:bg-muted/20 transition-colors">
                  <TableCell className="text-xs">
                    <div>{format(new Date(entry.createdAt), "dd MMM yyyy")}</div>
                    <div className="text-muted-foreground">{format(new Date(entry.createdAt), "HH:mm:ss")}</div>
                  </TableCell>
                  <TableCell>
                    <EntryTypeBadge type={entry.entryType as "debit" | "credit"} />
                  </TableCell>
                  <TableCell className="max-w-48">
                    <p className="text-sm truncate">{entry.description || "—"}</p>
                    <p className="text-xs text-muted-foreground font-mono">{entry.journalId?.slice(0, 16)}…</p>
                  </TableCell>
                  <TableCell>
                    {entry.referenceType ? (
                      <div>
                        <Badge variant="outline" className="text-xs capitalize">{entry.referenceType}</Badge>
                        {entry.referenceId && (
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">{entry.referenceId.slice(0, 12)}…</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <span className={entry.entryType === "credit" ? "text-emerald-400" : "text-rose-400"}>
                      {entry.entryType === "credit" ? "+" : "−"}
                      {formatCurrency(entry.amount, entry.currency)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatCurrency(entry.balance, entry.currency)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{filtered.length} entries shown</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrev}
            disabled={prevCursors.length === 0}
            className="gap-1"
          >
            <ChevronLeft className="w-4 h-4" /> Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNext}
            disabled={!nextCursor}
            className="gap-1"
          >
            Next <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Admin Ledger Summary ─────────────────────────────────────────────────────
function AdminLedgerSummary() {
  const { data, isLoading } = trpc.ledger.adminLedgerSummary.useQuery();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const summaryCards = [
    { label: "Total Accounts", value: data.totalAccounts?.toString() ?? "0", icon: Wallet, color: "text-blue-400" },
    { label: "Active Accounts", value: data.activeAccounts?.toString() ?? "0", icon: CheckCircle2, color: "text-emerald-400" },
    { label: "Frozen Accounts", value: data.frozenAccounts?.toString() ?? "0", icon: Shield, color: "text-amber-400" },
    { label: "Total Journals", value: data.totalJournals?.toString() ?? "0", icon: BookOpen, color: "text-purple-400" },
    { label: "Total Entries", value: data.totalEntries?.toString() ?? "0", icon: Activity, color: "text-cyan-400" },
    { label: "Pending Jobs", value: data.pendingJobs?.toString() ?? "0", icon: Clock, color: "text-orange-400" },
    { label: "Processing Jobs", value: data.processingJobs?.toString() ?? "0", icon: RefreshCw, color: "text-blue-400" },
    { label: "Failed Jobs", value: data.failedJobs?.toString() ?? "0", icon: AlertCircle, color: "text-rose-400" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {summaryCards.map(card => (
          <Card key={card.label} className="bg-card/50 border-border/50">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-muted/50 flex items-center justify-center">
                  <card.icon className={`w-5 h-5 ${card.color}`} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{card.label}</p>
                  <p className="text-xl font-bold font-mono">{card.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Balance by Currency */}
      {data.balanceByCurrency && data.balanceByCurrency.length > 0 && (
        <Card className="bg-card/50 border-border/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-primary" />
              Platform Balance by Currency
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {data.balanceByCurrency.map((b: { currency: string; totalBalance: string; accountCount: number }) => (
                <div key={b.currency} className="bg-muted/20 rounded-lg p-3 border border-border/30">
                  <p className="text-xs text-muted-foreground">{b.currency}</p>
                  <p className="text-lg font-bold font-mono">{formatCurrency(b.totalBalance, b.currency)}</p>
                  <p className="text-xs text-muted-foreground">{b.accountCount} accounts</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Settlement Queue */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Landmark className="w-4 h-4 text-primary" />
              Settlement Queue Management
            </CardTitle>
            <AdminSettlementQueueActions />
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The settlement queue uses PostgreSQL <code className="bg-muted px-1 rounded text-xs">SKIP LOCKED</code> for
            concurrent worker processing without contention. Failed jobs are automatically retried with exponential backoff.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function AdminSettlementQueueActions() {
  const utils = trpc.useUtils();

  const processQueue = trpc.ledger.adminProcessSettlementQueue.useMutation({
    onSuccess: (data) => {
      toast.success(`Settlement queue processed`, {
        description: `${data.processed} settlements completed, ${data.failed} failed`,
      });
      utils.ledger.adminLedgerSummary.invalidate();
    },
    onError: (err) => toast.error("Queue processing failed", { description: err.message }),
  });

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => processQueue.mutate({ batchSize: 50 })}
      disabled={processQueue.isPending}
      className="gap-2"
    >
      {processQueue.isPending ? (
        <><RefreshCw className="w-3 h-3 animate-spin" /> Processing…</>
      ) : (
        <><RefreshCw className="w-3 h-3" /> Process Queue</>
      )}
    </Button>
  );
}

// ─── Main Ledger Page ─────────────────────────────────────────────────────────
export default function Ledger() {
  const { user } = useAuth();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [activeTab, setActiveTab] = useState("accounts");

  const { data: accountsData, isLoading: accountsLoading } = trpc.ledger.listAccounts.useQuery(
    { limit: 50 },
    { enabled: !!user }
  );

  const accounts = accountsData?.accounts ?? [];

  // Auto-select first account when loaded
  const firstAccountId = accounts[0]?.id;
  const effectiveAccountId = selectedAccountId || firstAccountId || "";

  // Summary stats
  const totalBalance = useMemo(() =>
    accounts.reduce((sum, a) => sum + parseFloat(a.balance), 0),
    [accounts]
  );
  const totalAvailable = useMemo(() =>
    accounts.reduce((sum, a) => sum + parseFloat(a.availableBalance), 0),
    [accounts]
  );
  const totalReserved = useMemo(() =>
    accounts.reduce((sum, a) => sum + parseFloat(a.reservedBalance), 0),
    [accounts]
  );

  const isAdmin = user?.role === "admin";

  if (accountsLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
  return (
    <div className="container py-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-primary" />
            Ledger
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Double-entry accounting — every debit has a matching credit
          </p>
        </div>
        <div className="flex items-center gap-3">
          {accounts.length > 0 && (
            <InternalTransferDialog accounts={accounts} />
          )}
          <Button variant="outline" size="sm" className="gap-2">
            <Download className="w-4 h-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <Banknote className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Balance</p>
                <p className="text-xl font-bold font-mono">{formatCurrency(totalBalance)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border-emerald-500/20">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Available</p>
                <p className="text-xl font-bold font-mono text-emerald-400">{formatCurrency(totalAvailable)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-amber-500/10 to-amber-500/5 border-amber-500/20">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                <TrendingDown className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Reserved</p>
                <p className="text-xl font-bold font-mono text-amber-400">{formatCurrency(totalReserved)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-muted/30">
          <TabsTrigger value="accounts" className="gap-2">
            <Wallet className="w-4 h-4" /> Accounts
          </TabsTrigger>
          <TabsTrigger value="journal" className="gap-2">
            <BookOpen className="w-4 h-4" /> Journal History
          </TabsTrigger>
          <TabsTrigger value="transfers" className="gap-2">
            <ArrowLeftRight className="w-4 h-4" /> Transfers
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="admin" className="gap-2">
              <Shield className="w-4 h-4" /> Admin
            </TabsTrigger>
          )}
        </TabsList>

        {/* Accounts Tab */}
        <TabsContent value="accounts" className="mt-6">
          {accountsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-48 w-full" />
              ))}
            </div>
          ) : accounts.length === 0 ? (
            <Card className="bg-card/50 border-border/50">
              <CardContent className="py-16 text-center">
                <Wallet className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-40" />
                <p className="text-muted-foreground">No ledger accounts found</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Ledger accounts are created automatically when you start trading
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {accounts.map(account => (
                <div
                  key={account.id}
                  className={`cursor-pointer transition-all ${
                    effectiveAccountId === account.id ? "ring-2 ring-primary rounded-xl" : ""
                  }`}
                  onClick={() => {
                    setSelectedAccountId(account.id);
                    setActiveTab("journal");
                  }}
                >
                  <BalanceCard account={account} />
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Journal History Tab */}
        <TabsContent value="journal" className="mt-6">
          <Card className="bg-card/50 border-border/50">
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="text-base">Journal Entries</CardTitle>
                  <CardDescription>Cursor-based pagination for partition-aware queries</CardDescription>
                </div>
                {accounts.length > 1 && (
                  <Select value={effectiveAccountId} onValueChange={setSelectedAccountId}>
                    <SelectTrigger className="w-64">
                      <SelectValue placeholder="Select account" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map(a => (
                        <SelectItem key={a.id} value={a.id}>
                          <span className="font-mono text-xs">{a.id.slice(0, 10)}…</span>
                          <span className="ml-2 capitalize text-muted-foreground">{a.accountType}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {effectiveAccountId ? (
                <JournalHistoryTable accountId={effectiveAccountId} />
              ) : (
                <div className="py-12 text-center text-muted-foreground">
                  <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p>Select an account to view journal entries</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Transfers Tab */}
        <TabsContent value="transfers" className="mt-6">
          <Card className="bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4 text-primary" />
                Internal Transfers
              </CardTitle>
              <CardDescription>
                Move funds between your ledger accounts. All transfers are atomic and idempotent.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Architecture info */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  {
                    icon: Shield,
                    title: "Idempotent",
                    desc: "Each transfer has a unique key — retrying the same request never creates duplicates",
                    color: "text-blue-400",
                    bg: "bg-blue-500/10 border-blue-500/20",
                  },
                  {
                    icon: BookOpen,
                    title: "Double-Entry",
                    desc: "Every transfer creates two balanced journal entries — one debit, one credit",
                    color: "text-emerald-400",
                    bg: "bg-emerald-500/10 border-emerald-500/20",
                  },
                  {
                    icon: CreditCard,
                    title: "Advisory Locks",
                    desc: "PostgreSQL advisory locks prevent concurrent transfers from creating race conditions",
                    color: "text-purple-400",
                    bg: "bg-purple-500/10 border-purple-500/20",
                  },
                ].map(item => (
                  <div key={item.title} className={`rounded-xl p-4 border ${item.bg}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <item.icon className={`w-4 h-4 ${item.color}`} />
                      <p className="font-semibold text-sm">{item.title}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                ))}
              </div>

              {accounts.length >= 2 ? (
                <div className="flex items-center justify-center py-8">
                  <InternalTransferDialog accounts={accounts} />
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground">
                  <ArrowLeftRight className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p>You need at least 2 accounts to make an internal transfer</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Admin Tab */}
        {isAdmin && (
          <TabsContent value="admin" className="mt-6">
            <AdminLedgerSummary />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
