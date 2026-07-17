import { useState, useMemo } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  LineChart as ReLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Plus, TrendingUp, TrendingDown, Activity, DollarSign, RefreshCw, FlaskConical } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";

// ── Black-Scholes helpers (client-side, for visualiser only) ──────────────────
function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x) / Math.SQRT2);
  const erf = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  return 0.5 * (1 + sign * erf);
}
function bsGreeks(S: number, K: number, T: number, r: number, sigma: number, type: "CALL" | "PUT") {
  if (T <= 0) return { delta: type === "CALL" ? 1 : -1, gamma: 0, theta: 0, vega: 0 };
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const nd1 = normalCDF(d1);
  const nd2 = normalCDF(d2);
  const npd1 = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  const delta = type === "CALL" ? nd1 : nd1 - 1;
  const gamma = (npd1 / (S * sigma * Math.sqrt(T))) * 100; // ×100 for visibility
  const theta = (-(S * npd1 * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * (type === "CALL" ? nd2 : -normalCDF(-d2))) / 365;
  const vega = S * npd1 * Math.sqrt(T) / 100;
  return { delta, gamma, theta, vega };
}

type ContractRow = {
  id: number; symbol: string; strikePrice: string; expiryDate: Date | string;
  impliedVolatility: string; riskFreeRate: string; optionType: string; status: string;
  openInterest: number;
};

function GreeksVisualiser({ contracts }: { contracts: ContractRow[] }) {
  const activeContracts = contracts.filter(c => c.status === "ACTIVE");
  const [selectedId, setSelectedId] = useState<number | null>(activeContracts[0]?.id ?? null);
  const contract = activeContracts.find(c => c.id === selectedId);

  const chartData = useMemo(() => {
    if (!contract) return [];
    const K = parseFloat(contract.strikePrice);
    const sigma = parseFloat(contract.impliedVolatility);
    const r = parseFloat(contract.riskFreeRate);
    const T = Math.max(0.001, (new Date(contract.expiryDate).getTime() - Date.now()) / (365 * 24 * 3600 * 1000));
    const type = contract.optionType as "CALL" | "PUT";
    const points: { spot: number; delta: number; gamma: number; theta: number; vega: number }[] = [];
    for (let pct = 0.5; pct <= 1.5; pct += 0.02) {
      const S = K * pct;
      const g = bsGreeks(S, K, T, r, sigma, type);
      points.push({ spot: Math.round(S), ...g });
    }
    return points;
  }, [contract]);

  if (activeContracts.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-8 text-center text-muted-foreground">
          No active contracts to visualise.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-violet-400" /> Greeks Visualiser
          </CardTitle>
          <Select value={String(selectedId ?? "")} onValueChange={v => setSelectedId(Number(v))}>
            <SelectTrigger className="w-56 h-8 text-xs"><SelectValue placeholder="Select contract" /></SelectTrigger>
            <SelectContent>
              {activeContracts.map(c => (
                <SelectItem key={c.id} value={String(c.id)}>{c.symbol}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {contract && (
          <p className="text-xs text-muted-foreground">
            {contract.optionType} · Strike ₦{parseFloat(contract.strikePrice).toLocaleString()} · IV {(parseFloat(contract.impliedVolatility) * 100).toFixed(1)}% · Expiry {new Date(contract.expiryDate).toLocaleDateString()}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <ReLineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="spot" tick={{ fontSize: 10 }} tickFormatter={v => `₦${(Number(v) / 1000).toFixed(0)}k`} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
              formatter={((v: number, name: string) => [v.toFixed(4), name]) as any}
              labelFormatter={v => `Spot: ₦${Number(v).toLocaleString()}`}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="delta" stroke="#60a5fa" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="gamma" stroke="#34d399" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="theta" stroke="#f87171" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="vega"  stroke="#a78bfa" dot={false} strokeWidth={2} />
          </ReLineChart>
        </ResponsiveContainer>
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Greeks plotted across ±50% of strike price. Gamma ×100 for visibility. Theta per day.
        </p>
      </CardContent>
    </Card>
  );
}

function formatNum(n: number, decimals = 2) {
  return n.toLocaleString("en-NG", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    ACTIVE: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    EXPIRED: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    SETTLED: "bg-slate-500/15 text-muted-foreground border-slate-500/30",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${variants[status] ?? "bg-slate-500/15 text-muted-foreground border-slate-500/30"}`}>
      {status}
    </span>
  );
}

export default function OptionsAdmin() {
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "EXPIRED" | "SETTLED" | "ALL">("ACTIVE");
  const [typeFilter, setTypeFilter] = useState<"CALL" | "PUT" | "ALL">("ALL");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState<number | null>(null);
  const [settlementPrice, setSettlementPrice] = useState("");

  const [form, setForm] = useState({
    symbol: "",
    optionType: "CALL" as "CALL" | "PUT",
    strikePrice: "",
    expiryDate: "",
    contractSize: "1",
    riskFreeRate: "0.05",
    impliedVolatility: "0.20",
  });

  const utils = trpc.useUtils();

  const statsQuery = trpc.options.adminGetOptionsStats.useQuery();
  const contractsQuery = trpc.options.adminListOptionsContracts.useQuery({
    status: statusFilter,
    optionType: typeFilter,
    page,
    limit: 20,
  });

  // Fetch ALL active contracts for the Greeks visualiser (no status filter)
  const allActiveQuery = trpc.options.adminListOptionsContracts.useQuery({
    status: "ACTIVE",
    optionType: "ALL",
    page: 1,
    limit: 100,
  });

  const createMutation = trpc.options.adminCreateOptionsContract.useMutation({
    onSuccess: () => {
      toast.success("Options contract created");
      utils.options.adminListOptionsContracts.invalidate();
      utils.options.adminGetOptionsStats.invalidate();
      setCreateOpen(false);
      setForm({ symbol: "", optionType: "CALL", strikePrice: "", expiryDate: "", contractSize: "1", riskFreeRate: "0.05", impliedVolatility: "0.20" });
    },
    onError: (e) => toast.error(e.message),
  });

  const expireMutation = trpc.options.adminExpireOptionsContract.useMutation({
    onSuccess: () => {
      toast.success("Contract expired");
      utils.options.adminListOptionsContracts.invalidate();
      utils.options.adminGetOptionsStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const settleMutation = trpc.options.adminSettleExpiredOptions.useMutation({
    onSuccess: (data) => {
      toast.success(`Settled ${data.positionsSettled} positions. Total payout: ₦${formatNum(data.totalPayout)}`);
      utils.options.adminListOptionsContracts.invalidate();
      utils.options.adminGetOptionsStats.invalidate();
      setSettleOpen(false);
      setSettlementPrice("");
      setSelectedContractId(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const stats = statsQuery.data;
  const contracts = contractsQuery.data?.contracts ?? [];
  const total = contractsQuery.data?.total ?? 0;
  const allActiveContracts = allActiveQuery.data?.contracts ?? [];

  if (statsQuery.isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={5} />;
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Options Administration</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage call/put options contracts and settlements</p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="w-4 h-4" /> New Contract</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Options Contract</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Symbol</Label>
                    <Input placeholder="CORN-CALL-DEC26-45000" value={form.symbol}
                      onChange={e => setForm(f => ({ ...f, symbol: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Option Type</Label>
                    <Select value={form.optionType} onValueChange={v => setForm(f => ({ ...f, optionType: v as "CALL" | "PUT" }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CALL">CALL</SelectItem>
                        <SelectItem value="PUT">PUT</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Strike Price (₦)</Label>
                    <Input type="number" placeholder="45000" value={form.strikePrice}
                      onChange={e => setForm(f => ({ ...f, strikePrice: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Expiry Date</Label>
                    <Input type="date" value={form.expiryDate}
                      onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label>Contract Size</Label>
                    <Input type="number" value={form.contractSize}
                      onChange={e => setForm(f => ({ ...f, contractSize: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Risk-Free Rate</Label>
                    <Input type="number" step="0.01" value={form.riskFreeRate}
                      onChange={e => setForm(f => ({ ...f, riskFreeRate: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Implied Vol.</Label>
                    <Input type="number" step="0.01" value={form.impliedVolatility}
                      onChange={e => setForm(f => ({ ...f, impliedVolatility: e.target.value }))} />
                  </div>
                </div>
                <Button
                  className="w-full"
                  disabled={createMutation.isPending}
                  onClick={() => createMutation.mutate({
                    symbol: form.symbol,
                    optionType: form.optionType,
                    strikePrice: parseFloat(form.strikePrice),
                    expiryDate: form.expiryDate,
                    contractSize: parseFloat(form.contractSize),
                    riskFreeRate: parseFloat(form.riskFreeRate),
                    impliedVolatility: parseFloat(form.impliedVolatility),
                  })}
                >
                  {createMutation.isPending ? "Creating…" : "Create Contract"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Active Contracts", value: stats.activeContracts, icon: Activity, color: "text-emerald-400" },
              { label: "Open Interest", value: stats.totalOpenInterest.toLocaleString(), icon: TrendingUp, color: "text-blue-400" },
              { label: "Open Positions", value: stats.openPositions, icon: DollarSign, color: "text-violet-400" },
              { label: "Premium Collected", value: `₦${formatNum(stats.totalPremiumCollected)}`, icon: TrendingDown, color: "text-amber-400" },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label} className="bg-card border-border">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`p-2 rounded-lg bg-muted ${color}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-lg font-bold text-foreground">{value}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Greeks Visualiser */}
        <GreeksVisualiser contracts={allActiveContracts} />

        {/* Contracts Table */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Options Contracts</CardTitle>
              <div className="flex gap-2">
                <Select value={typeFilter} onValueChange={v => { setTypeFilter(v as typeof typeFilter); setPage(1); }}>
                  <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Types</SelectItem>
                    <SelectItem value="CALL">CALL</SelectItem>
                    <SelectItem value="PUT">PUT</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={v => { setStatusFilter(v as typeof statusFilter); setPage(1); }}>
                  <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Status</SelectItem>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="EXPIRED">Expired</SelectItem>
                    <SelectItem value="SETTLED">Settled</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="sm" onClick={() => utils.options.adminListOptionsContracts.invalidate()}>
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Strike</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="text-right">IV</TableHead>
                  <TableHead className="text-right">Open Int.</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No contracts found
                    </TableCell>
                  </TableRow>
                ) : contracts.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-sm font-medium">{c.symbol}</TableCell>
                    <TableCell>
                      <Badge variant={c.optionType === "CALL" ? "default" : "secondary"}>
                        {c.optionType === "CALL" ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                        {c.optionType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">₦{formatNum(parseFloat(c.strikePrice))}</TableCell>
                    <TableCell className="text-sm">{new Date(c.expiryDate).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right text-sm">{(parseFloat(c.impliedVolatility) * 100).toFixed(1)}%</TableCell>
                    <TableCell className="text-right">{c.openInterest.toLocaleString()}</TableCell>
                    <TableCell><StatusBadge status={c.status} /></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {c.status === "ACTIVE" && (
                          <>
                            <Button
                              variant="outline" size="sm"
                              className="h-7 text-xs"
                              onClick={() => {
                                setSelectedContractId(c.id);
                                setSettleOpen(true);
                              }}
                            >
                              Settle
                            </Button>
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 text-xs text-amber-400 hover:text-amber-300"
                              disabled={expireMutation.isPending}
                              onClick={() => expireMutation.mutate({ contractId: c.id })}
                            >
                              Expire
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {total > 20 && (
              <div className="flex justify-between items-center p-4 border-t border-border">
                <span className="text-sm text-muted-foreground">
                  Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
                  <Button variant="outline" size="sm" disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Settle Dialog */}
        <Dialog open={settleOpen} onOpenChange={setSettleOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Settle Options Contract</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Enter the final settlement price. All open positions will be cash-settled based on their intrinsic value at this price.
              </p>
              <div className="space-y-1">
                <Label>Settlement Price (₦)</Label>
                <Input
                  type="number"
                  placeholder="e.g. 47500"
                  value={settlementPrice}
                  onChange={e => setSettlementPrice(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                disabled={!settlementPrice || settleMutation.isPending}
                onClick={() => {
                  if (selectedContractId && settlementPrice) {
                    settleMutation.mutate({
                      contractId: selectedContractId,
                      settlementPrice: parseFloat(settlementPrice),
                    });
                  }
                }}
              >
                {settleMutation.isPending ? "Settling…" : "Confirm Settlement"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
