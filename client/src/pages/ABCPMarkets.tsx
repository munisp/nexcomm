import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Building2, TrendingUp, Shield, DollarSign, FileText, Plus, ChevronRight, Layers } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { PageSkeleton } from "@/components/PageSkeleton";

const ISSUANCE_TREND = [
  { month: "Oct", volume: 8.2 }, { month: "Nov", volume: 12.4 }, { month: "Dec", volume: 9.8 },
  { month: "Jan", volume: 18.6 }, { month: "Feb", volume: 22.1 }, { month: "Mar", volume: 25.4 },
];

function formatNgn(v: string | number | null | undefined) {
  if (!v) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (n >= 1e12) return `₦${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `₦${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `₦${(n / 1e6).toFixed(2)}M`;
  return `₦${n.toLocaleString()}`;
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-500/15 text-green-400 border-green-500/30",
  MATURED: "bg-gray-500/15 text-muted-foreground border-gray-500/30",
  PENDING_APPROVAL: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  DEFAULTED: "bg-red-500/15 text-red-400 border-red-500/30",
};

export default function ABCPMarkets() {
  const [tab, setTab] = useState("programs");
  const [investDialog, setInvestDialog] = useState<any>(null);
  const [investAmount, setInvestAmount] = useState("5000000");

  const { data: programs = [], isLoading } = trpc.abcp.list.useQuery();
  const { data: stats } = trpc.abcp.stats.useQuery();
  const investMutation = trpc.abcp.create.useMutation({
    onSuccess: () => { toast.success("Investment order placed"); setInvestDialog(null); },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/20">
            <Layers className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">ABCP Capital Markets</h1>
            <p className="text-sm text-muted-foreground">Asset-Backed Commercial Paper — warehouse receipt securitisation</p>
          </div>
        </div>
        <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10">
          SEC Nigeria Licensed
        </Badge>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Total Programs", value: stats?.totalPrograms ?? programs.length, icon: Layers, color: "text-amber-400" },
          { label: "Total Issuance", value: formatNgn(stats?.totalIssuanceNgn ?? "97000000000"), icon: DollarSign, color: "text-green-400" },
          { label: "Avg Yield", value: `${stats?.avgYieldPct ?? "14.8"}%`, icon: TrendingUp, color: "text-blue-400" },
          { label: "Coverage Ratio", value: `${stats?.avgCoverageRatioPct ?? "142"}%`, icon: Shield, color: "text-purple-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-[#111827] border-border/50">
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className={`w-8 h-8 ${color}`} />
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-bold text-white">{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Explainer Banner */}
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <FileText className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-300">What is ABCP?</p>
            <p className="text-xs text-amber-200/70 mt-1">
              Asset-Backed Commercial Paper (ABCP) is a short-term debt instrument backed by warehouse receipts.
              Farmers deposit commodities → receive EWRs → NEXCOM pools EWRs into a Special Purpose Vehicle (SPV) →
              SPV issues ABCP to institutional investors → farmers receive upfront financing at competitive rates.
              Regulated by SEC Nigeria under ISA 2025.
            </p>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-[#111827] border border-border/50 mb-6">
          <TabsTrigger value="programs">Active Programs</TabsTrigger>
          <TabsTrigger value="trend">Issuance Trend</TabsTrigger>
        </TabsList>

        <TabsContent value="programs">
          <div className="space-y-4">
            {isLoading ? (
              <Card className="bg-[#111827] border-border/50">
                <CardContent className="p-8 text-center text-muted-foreground">Loading programs…</CardContent>
              </Card>
            ) : programs.map((prog: any) => {
              const subscribed = parseFloat(prog.subscribedNgn ?? "0");
              const total = parseFloat(prog.totalIssuanceNgn ?? "1");
              const pct = Math.min(100, (subscribed / total) * 100);
  if (isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
              return (
                <Card key={prog.id} className="bg-[#111827] border-border/50 hover:border-amber-500/30 transition-colors">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-bold text-white">{prog.programName}</h3>
                          <Badge variant="outline" className={`text-xs ${STATUS_COLORS[prog.status] ?? ""}`}>
                            {prog.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{prog.spvName} · ISIN: {prog.isin}</p>
                        <p className="text-xs text-muted-foreground mt-1">{prog.collateralDescription}</p>
                      </div>
                      <Dialog open={investDialog?.id === prog.id} onOpenChange={(o) => !o && setInvestDialog(null)}>
                        <DialogTrigger asChild>
                          <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white text-xs"
                            onClick={() => setInvestDialog(prog)}>
                            Invest <ChevronRight className="w-3 h-3 ml-1" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="bg-[#111827] border-border text-white">
                          <DialogHeader><DialogTitle>Invest in {prog.programName}</DialogTitle></DialogHeader>
                          <div className="space-y-4 mt-2">
                            <div className="bg-[#0a0e1a] rounded-lg p-3 space-y-1 text-sm">
                              <div className="flex justify-between"><span className="text-muted-foreground">SPV</span><span>{prog.spvName}</span></div>
                              <div className="flex justify-between"><span className="text-muted-foreground">Yield</span><span className="text-green-400 font-bold">{prog.yieldPct}% p.a.</span></div>
                              <div className="flex justify-between"><span className="text-muted-foreground">Maturity</span><span>{prog.maturityDate ? new Date(prog.maturityDate).toLocaleDateString() : "—"}</span></div>
                              <div className="flex justify-between"><span className="text-muted-foreground">LTV</span><span>{prog.ltvPct}%</span></div>
                              <div className="flex justify-between"><span className="text-muted-foreground">Rating</span><span className="text-blue-300">{prog.creditRating} ({prog.ratingAgency})</span></div>
                            </div>
                            <div>
                              <Label className="text-muted-foreground">Investment Amount (₦)</Label>
                              <Input value={investAmount} onChange={e => setInvestAmount(e.target.value)}
                                className="bg-[#0a0e1a] border-border text-white mt-1" />
                              <p className="text-xs text-muted-foreground mt-1">Min: ₦{parseInt(prog.minInvestmentNgn ?? "5000000").toLocaleString()}</p>
                            </div>
                            <Button className="w-full bg-amber-600 hover:bg-amber-700" disabled={investMutation.isPending}
                              onClick={() => investMutation.mutate({ programName: prog.programName, sponsorName: prog.spvName ?? "NEXCOM SPV", programSizeNgn: investAmount, collateralType: "WAREHOUSE_RECEIPT", tenorDays: 90 })}>
                              {investMutation.isPending ? "Placing Order…" : "Confirm Investment"}
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                    <div className="grid grid-cols-4 gap-3 mb-4">
                      <div className="bg-[#0a0e1a] rounded p-2 text-center">
                        <p className="text-xs text-muted-foreground">Total Issuance</p>
                        <p className="text-sm font-bold text-white">{formatNgn(prog.totalIssuanceNgn)}</p>
                      </div>
                      <div className="bg-[#0a0e1a] rounded p-2 text-center">
                        <p className="text-xs text-muted-foreground">Subscribed</p>
                        <p className="text-sm font-bold text-green-400">{formatNgn(prog.subscribedNgn)}</p>
                      </div>
                      <div className="bg-[#0a0e1a] rounded p-2 text-center">
                        <p className="text-xs text-muted-foreground">Yield</p>
                        <p className="text-sm font-bold text-amber-400">{prog.yieldPct}%</p>
                      </div>
                      <div className="bg-[#0a0e1a] rounded p-2 text-center">
                        <p className="text-xs text-muted-foreground">LTV</p>
                        <p className="text-sm font-bold text-blue-400">{prog.ltvPct}%</p>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>Subscription Progress</span>
                        <span>{pct.toFixed(1)}%</span>
                      </div>
                      <Progress value={pct} className="h-2 bg-muted" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="trend">
          <Card className="bg-[#111827] border-border/50">
            <CardHeader><CardTitle className="text-white text-base">Monthly ABCP Issuance (₦B)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={ISSUANCE_TREND}>
                  <defs>
                    <linearGradient id="abcpGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="month" stroke="#6b7280" tick={{ fill: "#9ca3af", fontSize: 12 }} />
                  <YAxis stroke="#6b7280" tick={{ fill: "#9ca3af", fontSize: 12 }} tickFormatter={v => `₦${v}B`} />
                  <Tooltip contentStyle={{ background: "#111827", border: "1px solid #374151", color: "#fff" }}
                    formatter={(v: any) => [`₦${v}B`, "Issuance"]} />
                  <Area type="monotone" dataKey="volume" stroke="#f59e0b" fill="url(#abcpGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
