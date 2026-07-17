import { useState, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  Activity,
  ArrowRightLeft,
  Building2,
  CheckCircle2,
  Clock,
  Network,
  RefreshCw,
  TrendingUp,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import { MojaloopHubBanner } from "@/components/MojaloopHubBanner";
import { PageSkeleton } from "@/components/PageSkeleton";

// ─── Status badge helper ──────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    COMMITTED: { variant: "default", label: "Committed" },
    PENDING: { variant: "secondary", label: "Pending" },
    RESERVED: { variant: "outline", label: "Reserved" },
    ABORTED: { variant: "destructive", label: "Aborted" },
    EXPIRED: { variant: "destructive", label: "Expired" },
    ACCEPTED: { variant: "default", label: "Accepted" },
    REJECTED: { variant: "destructive", label: "Rejected" },
  };
  const cfg = variants[status] ?? { variant: "outline" as const, label: status };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color = "text-primary",
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          <div className={`p-2 rounded-lg bg-muted ${color}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Initiate Transfer Dialog ─────────────────────────────────────────────────
function InitiateTransferDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    payeeFspId: "",
    payerIdentifier: "",
    payeeIdentifier: "",
    amount: "",
    currency: "USD",
    note: "",
  });

  const { data: dfsps } = trpc.mojaloop.listDfsps.useQuery({ activeOnly: true });

  // ── Fee calculation ────────────────────────────────────────────────────────
  const parsedAmount = parseFloat(form.amount);
  const feeQuery = trpc.mojaloopTiers.calculateFee.useQuery(
    {
      amount: parsedAmount > 0 ? parsedAmount : 1,
      currency: form.currency,
      fspId: form.payeeFspId || undefined,
    },
    { enabled: open && parsedAmount > 0 }
  );
  const feeData = feeQuery.data;

  const initiate = trpc.mojaloop.initiateTransfer.useMutation({
    onSuccess: (data) => {
      toast.success(`Transfer ${data.transferId.slice(0, 12)}… — ${data.transferState}`);
      setOpen(false);
      onSuccess();
    },
    onError: (err) => {
      toast.error(`Transfer failed: ${err.message}`);
    },
  });

  const handleSubmit = () => {
    if (!form.payeeFspId || !form.amount || !form.payerIdentifier || !form.payeeIdentifier) {
      toast.error("All fields are required.");
      return;
    }
    initiate.mutate({
      payeeFspId: form.payeeFspId,
      payerIdentifier: form.payerIdentifier,
      payeeIdentifier: form.payeeIdentifier,
      amount: form.amount,
      currency: form.currency,
      note: form.note || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <ArrowRightLeft className="w-4 h-4 mr-2" />
          Initiate Transfer
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Initiate Mojaloop Transfer</DialogTitle>
          <DialogDescription>
            Send a FSPIOP transfer between two DFSPs via the Mojaloop adapter.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Payee FSP</Label>
            <Select value={form.payeeFspId} onValueChange={(v) => setForm((f) => ({ ...f, payeeFspId: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select payee FSP" />
              </SelectTrigger>
              <SelectContent>
                {dfsps?.map((d) => (
                  <SelectItem key={d.fspId} value={d.fspId}>
                    {d.name} ({d.fspId})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Payer Identifier</Label>
              <Input
                placeholder="e.g. +234801234567"
                value={form.payerIdentifier}
                onChange={(e) => setForm((f) => ({ ...f, payerIdentifier: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Payee Identifier</Label>
              <Input
                placeholder="e.g. +254712345678"
                value={form.payeeIdentifier}
                onChange={(e) => setForm((f) => ({ ...f, payeeIdentifier: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["USD", "EUR", "GBP", "NGN", "KES", "GHS", "ZAR", "TZS", "UGX", "XOF"].map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {/* ── Fee Breakdown ── */}
          {parsedAmount > 0 && (
            <div className="rounded-lg border bg-muted/40 p-3 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fee Estimate</p>
              {feeQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Calculating…</p>
              ) : feeData ? (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Transfer amount</span>
                    <span className="font-medium">{parsedAmount.toLocaleString()} {form.currency}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Fee ({feeData.tierName} tier)</span>
                    <span className="font-medium text-amber-600">{feeData.fee.toLocaleString(undefined, { minimumFractionDigits: 2 })} {form.currency}</span>
                  </div>
                  <div className="flex justify-between text-sm border-t pt-1 mt-1">
                    <span className="font-semibold">Total debit</span>
                    <span className="font-bold">{(parsedAmount + feeData.fee).toLocaleString(undefined, { minimumFractionDigits: 2 })} {form.currency}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{feeData.breakdown}</p>
                </>
              ) : null}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={initiate.isPending}>
            {initiate.isPending ? "Sending..." : "Send Transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Register DFSP Dialog ─────────────────────────────────────────────────────
function RegisterDfspDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fspId: "", name: "", currency: "USD", country: "" });

  const register = trpc.mojaloop.registerDfsp.useMutation({
    onSuccess: () => {
      toast.success(`${form.fspId} registered successfully.`);
      setOpen(false);
      onSuccess();
    },
    onError: (err) => {
      toast.error(`Registration failed: ${err.message}`);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Building2 className="w-4 h-4 mr-2" />
          Register DFSP
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Register DFSP</DialogTitle>
          <DialogDescription>
            Register a new Digital Financial Service Provider with the Mojaloop adapter.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>FSP ID</Label>
            <Input
              placeholder="e.g. nexcom-exchange"
              value={form.fspId}
              onChange={(e) => setForm((f) => ({ ...f, fspId: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              placeholder="e.g. NEXCOM Exchange"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["USD", "EUR", "GBP", "NGN", "KES", "GHS", "ZAR"].map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Country (ISO)</Label>
              <Input
                placeholder="e.g. NG"
                maxLength={4}
                value={form.country}
                onChange={(e) => setForm((f) => ({ ...f, country: e.target.value.toUpperCase() }))}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={() => register.mutate({ fspId: form.fspId, name: form.name, currency: form.currency, country: form.country || undefined })}
            disabled={register.isPending}
          >
            {register.isPending ? "Registering..." : "Register"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Mojaloop() {
  const [transferPage, setTransferPage] = useState(0);
  const [quotePage, setQuotePage] = useState(0);
  const [transferStatusFilter, setTransferStatusFilter] = useState<string>("all");
  const pageSize = 15;

  const utils = trpc.useUtils();
  const refresh = () => {
    utils.mojaloop.invalidate();
  };

  // Queries
  const { data: hubStatus } = trpc.mojaloop.hubStatus.useQuery(undefined, { refetchInterval: 30_000 });
  const { data: stats, isLoading: statsLoading } = trpc.mojaloop.stats.useQuery();
  const { data: dfspsData, isLoading: dfspsLoading } = trpc.mojaloop.listDfsps.useQuery({ activeOnly: false });
  const { data: transfersData, isLoading: transfersLoading } = trpc.mojaloop.listTransfers.useQuery({
    limit: pageSize,
    offset: transferPage * pageSize,
    status: transferStatusFilter !== "all" ? (transferStatusFilter as any) : undefined,
  });
  const { data: quotesData, isLoading: quotesLoading } = trpc.mojaloop.listQuotes.useQuery({
    limit: pageSize,
    offset: quotePage * pageSize,
  });
  const { data: volumeByCurrency } = trpc.mojaloop.volumeByCurrency.useQuery();
  const { data: recentActivity } = trpc.mojaloop.recentActivity.useQuery({ limit: 8 });
  const [reconcFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const { data: reconcReport } = trpc.mojaloop.reconciliationReport.useQuery({ fromDate: reconcFromDate });

  // Build daily volume chart data from reconciliation report
  const dailyVolumeData = useMemo(() => {
    if (!reconcReport?.byDay) return [];
    return reconcReport.byDay
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        date: new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        committed: Number(d.committedAmount ?? 0),
        aborted: Number(d.abortedCount ?? 0) * 1000, // approximate: abortedCount * avg amount
        count: Number(d.abortedCount ?? 0) + Number(d.committedCount ?? 0),
      }));
  }, [reconcReport]);

  // Derived stats
  const transferStats = stats?.transfers ?? {};
  const committedCount = (transferStats["COMMITTED"] as any)?.count ?? 0;
  const pendingCount = (transferStats["PENDING"] as any)?.count ?? 0;
  const abortedCount = (transferStats["ABORTED"] as any)?.count ?? 0;
  const totalTransfers = Object.values(transferStats).reduce((acc: number, v: any) => acc + (v?.count ?? 0), 0);

  const totalVolume = volumeByCurrency?.reduce((acc, v) => acc + Number(v.totalAmount ?? 0), 0) ?? 0;

  if (statsLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
  return (
    <div className="flex flex-col">
      <MojaloopHubBanner />
      <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Network className="w-6 h-6 text-primary" />
            Mojaloop Payments
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            FSPIOP-compliant DFSP adapter — interoperable payments across financial institutions
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border ${
              hubStatus?.online
                ? "bg-green-500/10 text-green-600 border-green-500/20"
                : "bg-red-500/10 text-red-600 border-red-500/20"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                hubStatus?.online ? "bg-green-500 animate-pulse" : "bg-red-500"
              }`} />
              {hubStatus?.online ? "Hub Online" : (hubStatus ? "Hub Offline" : "Checking...")}
            </span>
            {hubStatus?.latencyMs !== undefined && (
              <span className="text-xs text-muted-foreground">{hubStatus.latencyMs}ms latency</span>
            )}
            {hubStatus && !hubStatus.online && (
              <Badge variant="outline" className="text-xs">Standalone Mode</Badge>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <RegisterDfspDialog onSuccess={refresh} />
          <InitiateTransferDialog onSuccess={refresh} />
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Active DFSPs"
          value={statsLoading ? "—" : (stats?.activeDfsps ?? 0)}
          subtitle="Registered participants"
          icon={Users}
          color="text-blue-500"
        />
        <StatCard
          title="Total Transfers"
          value={statsLoading ? "—" : totalTransfers}
          subtitle={`${committedCount} committed`}
          icon={ArrowRightLeft}
          color="text-green-500"
        />
        <StatCard
          title="Pending"
          value={statsLoading ? "—" : pendingCount}
          subtitle="Awaiting settlement"
          icon={Clock}
          color="text-yellow-500"
        />
        <StatCard
          title="Total Volume"
          value={statsLoading ? "—" : `$${totalVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
          subtitle="All currencies (USD equiv)"
          icon={TrendingUp}
          color="text-purple-500"
        />
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="transfers">
        <TabsList>
          <TabsTrigger value="transfers">
            <ArrowRightLeft className="w-4 h-4 mr-2" />
            Transfers
          </TabsTrigger>
          <TabsTrigger value="quotes">
            <Zap className="w-4 h-4 mr-2" />
            Quotes
          </TabsTrigger>
          <TabsTrigger value="dfsps">
            <Building2 className="w-4 h-4 mr-2" />
            DFSPs
          </TabsTrigger>
          <TabsTrigger value="activity">
            <Activity className="w-4 h-4 mr-2" />
            Activity
          </TabsTrigger>
        </TabsList>

        {/* ── Transfers Tab ── */}
        <TabsContent value="transfers" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Transfer Ledger</CardTitle>
                <Select value={transferStatusFilter} onValueChange={(v) => { setTransferStatusFilter(v); setTransferPage(0); }}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="COMMITTED">Committed</SelectItem>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="RESERVED">Reserved</SelectItem>
                    <SelectItem value="ABORTED">Aborted</SelectItem>
                    <SelectItem value="EXPIRED">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {transfersLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading transfers...</div>
              ) : !transfersData?.transfers?.length ? (
                <div className="text-center py-8 text-muted-foreground">No transfers found.</div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Transfer ID</TableHead>
                        <TableHead>Payer FSP</TableHead>
                        <TableHead>Payee FSP</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Currency</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transfersData.transfers.map((t) => (
                        <TableRow key={t.transferId}>
                          <TableCell className="font-mono text-xs">{t.transferId.slice(0, 12)}…</TableCell>
                          <TableCell>{t.payerFspId}</TableCell>
                          <TableCell>{t.payeeFspId}</TableCell>
                          <TableCell className="text-right font-medium">{Number(t.amount).toLocaleString()}</TableCell>
                          <TableCell>{t.currency}</TableCell>
                          <TableCell><StatusBadge status={t.status} /></TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(t.createdAt).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      Showing {transferPage * pageSize + 1}–{Math.min((transferPage + 1) * pageSize, transfersData.total)} of {transfersData.total}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={transferPage === 0} onClick={() => setTransferPage((p) => p - 1)}>Previous</Button>
                      <Button variant="outline" size="sm" disabled={(transferPage + 1) * pageSize >= transfersData.total} onClick={() => setTransferPage((p) => p + 1)}>Next</Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Daily Transfer Volume Chart */}
          {dailyVolumeData.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Daily Transfer Volume (Last 30 Days)
                </CardTitle>
                <CardDescription>Committed vs. aborted transfer amounts by day</CardDescription>
              </CardHeader>
              <CardContent>
                <div style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dailyVolumeData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="committedGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="abortedGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        tickLine={false}
                        axisLine={false}
                        interval={Math.max(0, Math.floor(dailyVolumeData.length / 8) - 1)}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`}
                      />
                      <RechartsTooltip
                        contentStyle={{
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        formatter={((value: number, name: string) => [
                          `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
                          name === "committed" ? "Committed" : "Aborted",
                        ]) as any}
                      />
                      <Area
                        type="monotone"
                        dataKey="committed"
                        stroke="#22c55e"
                        strokeWidth={2}
                        fill="url(#committedGrad)"
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Area
                        type="monotone"
                        dataKey="aborted"
                        stroke="#ef4444"
                        strokeWidth={1.5}
                        fill="url(#abortedGrad)"
                        dot={false}
                        activeDot={{ r: 3 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center gap-6 mt-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-green-500 inline-block" /> Committed volume</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-red-500 inline-block" /> Aborted volume</span>
                  <span className="ml-auto">Source: mojaloop_transfers</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Volume by currency */}
          {volumeByCurrency && volumeByCurrency.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Volume by Currency</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Currency</TableHead>
                      <TableHead className="text-right">Total Transfers</TableHead>
                      <TableHead className="text-right">Total Amount</TableHead>
                      <TableHead className="text-right">Committed</TableHead>
                      <TableHead className="text-right">Aborted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {volumeByCurrency.map((v) => (
                      <TableRow key={v.currency}>
                        <TableCell className="font-medium">{v.currency}</TableCell>
                        <TableCell className="text-right">{Number(v.count).toLocaleString()}</TableCell>
                        <TableCell className="text-right">{Number(v.totalAmount ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-right text-green-600">{Number(v.committedCount ?? 0).toLocaleString()}</TableCell>
                        <TableCell className="text-right text-red-500">{Number(v.abortedCount ?? 0).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Quotes Tab ── */}
        <TabsContent value="quotes">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quote Requests</CardTitle>
              <CardDescription>FSPIOP quote negotiations between DFSPs</CardDescription>
            </CardHeader>
            <CardContent>
              {quotesLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading quotes...</div>
              ) : !quotesData?.quotes?.length ? (
                <div className="text-center py-8 text-muted-foreground">No quotes found.</div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Quote ID</TableHead>
                        <TableHead>Payer FSP</TableHead>
                        <TableHead>Payee FSP</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Currency</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {quotesData.quotes.map((q) => (
                        <TableRow key={q.quoteId}>
                          <TableCell className="font-mono text-xs">{q.quoteId.slice(0, 12)}…</TableCell>
                          <TableCell>{q.payerFspId}</TableCell>
                          <TableCell>{q.payeeFspId}</TableCell>
                          <TableCell className="text-right font-medium">{Number(q.amount).toLocaleString()}</TableCell>
                          <TableCell>{q.currency}</TableCell>
                          <TableCell><StatusBadge status={q.status} /></TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(q.createdAt).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      Showing {quotePage * pageSize + 1}–{Math.min((quotePage + 1) * pageSize, quotesData.total)} of {quotesData.total}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={quotePage === 0} onClick={() => setQuotePage((p) => p - 1)}>Previous</Button>
                      <Button variant="outline" size="sm" disabled={(quotePage + 1) * pageSize >= quotesData.total} onClick={() => setQuotePage((p) => p + 1)}>Next</Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── DFSPs Tab ── */}
        <TabsContent value="dfsps">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Registered DFSPs</CardTitle>
              <CardDescription>Digital Financial Service Providers connected to NEXCOM via Mojaloop</CardDescription>
            </CardHeader>
            <CardContent>
              {dfspsLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading DFSPs...</div>
              ) : !dfspsData?.length ? (
                <div className="text-center py-8 text-muted-foreground">No DFSPs registered.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>FSP ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Country</TableHead>
                      <TableHead>Currencies</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Registered</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dfspsData.map((d) => (
                      <TableRow key={d.fspId}>
                        <TableCell className="font-mono text-sm font-medium">{d.fspId}</TableCell>
                        <TableCell>{d.name}</TableCell>
                        <TableCell>{d.country ?? "—"}</TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {((d.currencies as string[]) ?? []).map((c) => (
                              <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          {d.isActive ? (
                            <span className="flex items-center gap-1 text-green-600 text-sm">
                              <CheckCircle2 className="w-4 h-4" /> Active
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-muted-foreground text-sm">
                              <XCircle className="w-4 h-4" /> Inactive
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(d.createdAt).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Activity Tab ── */}
        <TabsContent value="activity">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent Transfer Activity</CardTitle>
              <CardDescription>Latest Mojaloop transfer events across all DFSPs</CardDescription>
            </CardHeader>
            <CardContent>
              {!recentActivity?.length ? (
                <div className="text-center py-8 text-muted-foreground">No recent activity.</div>
              ) : (
                <div className="space-y-3">
                  {recentActivity.map((t) => (
                    <div key={t.transferId} className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${t.status === "COMMITTED" ? "bg-green-500" : t.status === "ABORTED" ? "bg-red-500" : "bg-yellow-500"}`} />
                        <div>
                          <p className="text-sm font-medium font-mono">{t.transferId.slice(0, 16)}…</p>
                          <p className="text-xs text-muted-foreground">{t.payerFspId} → {t.payeeFspId}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">{Number(t.amount).toLocaleString()} {t.currency}</p>
                        <p className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString()}</p>
                      </div>
                      <StatusBadge status={t.status} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
}
