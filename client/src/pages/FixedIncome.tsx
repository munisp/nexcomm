import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { TrendingUp, Shield, DollarSign, Calendar, Building2, Award, ChevronRight, BarChart3, Landmark } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { PageSkeleton } from "@/components/PageSkeleton";

const YIELD_CURVE_DATA = [
  { tenor: "91D", yield: 22.5 }, { tenor: "182D", yield: 21.8 }, { tenor: "364D", yield: 20.2 },
  { tenor: "2Y", yield: 18.5 }, { tenor: "3Y", yield: 16.8 }, { tenor: "5Y", yield: 15.2 },
  { tenor: "7Y", yield: 14.8 }, { tenor: "10Y", yield: 14.5 },
];

const VOLUME_DATA = [
  { date: "Mon", volume: 12.4 }, { date: "Tue", volume: 18.7 }, { date: "Wed", volume: 9.2 },
  { date: "Thu", volume: 24.1 }, { date: "Fri", volume: 31.8 },
];

const TYPE_COLORS: Record<string, string> = {
  TREASURY_BOND: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  TREASURY_BILL: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  CORPORATE_BOND: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  ABCP: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  AGRI_BOND: "bg-green-500/15 text-green-400 border-green-500/30",
};

const TYPE_LABELS: Record<string, string> = {
  TREASURY_BOND: "FGN Bond", TREASURY_BILL: "T-Bill",
  CORPORATE_BOND: "Corp Bond", ABCP: "ABCP", AGRI_BOND: "Agri Bond",
};

function formatNgn(v: string | number | null | undefined) {
  if (!v) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (n >= 1e12) return `₦${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `₦${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `₦${(n / 1e6).toFixed(2)}M`;
  return `₦${n.toLocaleString()}`;
}

export default function FixedIncome() {
  const [tab, setTab] = useState("board");
  const [buyDialog, setBuyDialog] = useState<any>(null);
  const [faceValue, setFaceValue] = useState("1000000");

  const { data: instruments = [], isLoading } = trpc.fixedIncome.list.useQuery();
  const buyMutation = trpc.fixedIncome.buy.useMutation({
    onSuccess: () => { toast.success("Order placed successfully"); setBuyDialog(null); },
    onError: (e) => toast.error(e.message),
  });

  const totalOutstanding = instruments.reduce((s, i) => s + parseFloat(i.outstandingNgn ?? "0"), 0);
  const avgYield = instruments.length > 0
    ? instruments.reduce((s, i) => s + parseFloat(i.yieldPct ?? "0"), 0) / instruments.length
    : 0;

  if (isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-blue-500/20">
            <Landmark className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Fixed Income Board</h1>
            <p className="text-sm text-muted-foreground">Government bonds, T-bills, corporate bonds & agri-backed securities</p>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Total Outstanding", value: formatNgn(totalOutstanding), icon: DollarSign, color: "text-blue-400" },
          { label: "Instruments Listed", value: instruments.length.toString(), icon: BarChart3, color: "text-green-400" },
          { label: "Avg Yield", value: `${avgYield.toFixed(2)}%`, icon: TrendingUp, color: "text-amber-400" },
          { label: "Avg Credit Rating", value: "A-", icon: Award, color: "text-purple-400" },
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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-[#111827] border border-border/50 mb-6">
          <TabsTrigger value="board">Instruments</TabsTrigger>
          <TabsTrigger value="yield">Yield Curve</TabsTrigger>
          <TabsTrigger value="volume">Volume</TabsTrigger>
        </TabsList>

        {/* Instruments Table */}
        <TabsContent value="board">
          <Card className="bg-[#111827] border-border/50">
            <CardHeader>
              <CardTitle className="text-white text-base">Listed Instruments</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50 hover:bg-transparent">
                    <TableHead className="text-muted-foreground">Instrument</TableHead>
                    <TableHead className="text-muted-foreground">Type</TableHead>
                    <TableHead className="text-muted-foreground text-right">Face Value</TableHead>
                    <TableHead className="text-muted-foreground text-right">Yield</TableHead>
                    <TableHead className="text-muted-foreground text-right">Outstanding</TableHead>
                    <TableHead className="text-muted-foreground">Rating</TableHead>
                    <TableHead className="text-muted-foreground">Maturity</TableHead>
                    <TableHead className="text-muted-foreground"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Loading instruments…</TableCell></TableRow>
                  ) : instruments.map((inst) => (
                    <TableRow key={inst.id} className="border-border/50 hover:bg-secondary/30">
                      <TableCell>
                        <div>
                          <p className="font-medium text-white text-sm">{inst.ticker}</p>
                          <p className="text-xs text-muted-foreground">{inst.name}</p>
                          <p className="text-xs text-muted-foreground">{inst.isin}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${TYPE_COLORS[inst.type] ?? ""}`}>
                          {TYPE_LABELS[inst.type] ?? inst.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-white font-mono text-sm">
                        {formatNgn(inst.faceValueNgn)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-green-400 font-mono font-bold">{inst.yieldPct}%</span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">
                        {formatNgn(inst.outstandingNgn)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Shield className="w-3 h-3 text-blue-400" />
                          <span className="text-sm font-bold text-blue-300">{inst.creditRating ?? "NR"}</span>
                          <span className="text-xs text-muted-foreground">{inst.ratingAgency}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-muted-foreground" />
                          {inst.maturityDate ? new Date(inst.maturityDate).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Dialog open={buyDialog?.id === inst.id} onOpenChange={(o) => !o && setBuyDialog(null)}>
                          <DialogTrigger asChild>
                            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white text-xs"
                              onClick={() => setBuyDialog(inst)}>
                              Buy <ChevronRight className="w-3 h-3 ml-1" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="bg-[#111827] border-border text-white">
                            <DialogHeader>
                              <DialogTitle>Buy — {inst.ticker}</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 mt-2">
                              <div className="bg-[#0a0e1a] rounded-lg p-3 space-y-1 text-sm">
                                <div className="flex justify-between"><span className="text-muted-foreground">Issuer</span><span>{inst.issuerName}</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">Yield</span><span className="text-green-400 font-bold">{inst.yieldPct}%</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">Maturity</span><span>{inst.maturityDate ? new Date(inst.maturityDate).toLocaleDateString() : "—"}</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">Rating</span><span className="text-blue-300">{inst.creditRating} ({inst.ratingAgency})</span></div>
                              </div>
                              <div>
                                <Label className="text-muted-foreground">Face Value (₦)</Label>
                                <Input value={faceValue} onChange={e => setFaceValue(e.target.value)}
                                  className="bg-[#0a0e1a] border-border text-white mt-1" />
                                <p className="text-xs text-muted-foreground mt-1">Min: ₦{parseInt(inst.faceValueNgn ?? "1000000").toLocaleString()}</p>
                              </div>
                              <Button className="w-full bg-blue-600 hover:bg-blue-700"
                                disabled={buyMutation.isPending}
                                onClick={() => buyMutation.mutate({ instrumentId: inst.id, faceValueNgn: faceValue })}>
                                {buyMutation.isPending ? "Placing Order…" : "Confirm Purchase"}
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Yield Curve */}
        <TabsContent value="yield">
          <Card className="bg-[#111827] border-border/50">
            <CardHeader>
              <CardTitle className="text-white text-base">Nigeria Yield Curve</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={YIELD_CURVE_DATA}>
                  <defs>
                    <linearGradient id="yieldGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="tenor" stroke="#6b7280" tick={{ fill: "#9ca3af", fontSize: 12 }} />
                  <YAxis stroke="#6b7280" tick={{ fill: "#9ca3af", fontSize: 12 }} tickFormatter={v => `${v}%`} />
                  <Tooltip contentStyle={{ background: "#111827", border: "1px solid #374151", color: "#fff" }}
                    formatter={(v: any) => [`${v}%`, "Yield"]} />
                  <Area type="monotone" dataKey="yield" stroke="#3b82f6" fill="url(#yieldGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Volume */}
        <TabsContent value="volume">
          <Card className="bg-[#111827] border-border/50">
            <CardHeader>
              <CardTitle className="text-white text-base">Weekly Trading Volume (₦B)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={VOLUME_DATA}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="date" stroke="#6b7280" tick={{ fill: "#9ca3af", fontSize: 12 }} />
                  <YAxis stroke="#6b7280" tick={{ fill: "#9ca3af", fontSize: 12 }} tickFormatter={v => `₦${v}B`} />
                  <Tooltip contentStyle={{ background: "#111827", border: "1px solid #374151", color: "#fff" }}
                    formatter={(v: any) => [`₦${v}B`, "Volume"]} />
                  <Bar dataKey="volume" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
