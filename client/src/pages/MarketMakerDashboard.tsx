import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  TrendingUp, Users, AlertTriangle, CheckCircle2, Plus, RefreshCw,
  BarChart3, ShieldAlert, FileText, Loader2, ChevronRight, Star,
} from "lucide-react";
import PushNotificationSettings from "@/pages/PushNotificationSettings";
import { LivePriceTicker } from "@/components/LivePriceTicker";
import { useLocation } from "wouter";

// ─── Helpers ─────────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  SUSPENDED: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  REVOKED: "bg-red-500/20 text-red-400 border-red-500/30",
};
const PENALTY_COLORS: Record<string, string> = {
  PENDING: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  INVOICED: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  PAID: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  WAIVED: "bg-muted text-muted-foreground",
};

// ─── Create Profile Dialog ────────────────────────────────────────────────────
function CreateProfileDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [firmName, setFirmName] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [assetClasses, setAssetClasses] = useState<string[]>(["COMMODITY"]);
  const [instruments, setInstruments] = useState("CORN,WHEAT");

  const createMutation = trpc.marketMaker.adminCreateProfile.useMutation({
    onSuccess: () => {
      toast.success("Market maker profile created");
      setOpen(false);
      onCreated();
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleAssetClass = (cls: string) => {
    setAssetClasses(prev =>
      prev.includes(cls) ? prev.filter(c => c !== cls) : [...prev, cls]
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1">
          <Plus className="w-4 h-4" /> Register Market Maker
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Register Market Maker</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">User ID</Label>
              <Input value={userId} onChange={e => setUserId(e.target.value)} placeholder="12345" className="bg-background border-border text-foreground" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">License Number</Label>
              <Input value={licenseNumber} onChange={e => setLicenseNumber(e.target.value)} placeholder="SEC/MM/001" className="bg-background border-border text-foreground" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground text-xs">Firm Name</Label>
            <Input value={firmName} onChange={e => setFirmName(e.target.value)} placeholder="Apex Capital Ltd" className="bg-background border-border text-foreground" />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">Asset Classes</Label>
            <div className="flex flex-wrap gap-2">
              {["COMMODITY", "EQUITY", "FOREX", "BOND"].map(cls => (
                <button
                  key={cls}
                  type="button"
                  onClick={() => toggleAssetClass(cls)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    assetClasses.includes(cls)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:border-primary/50"
                  }`}
                >
                  {cls}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground text-xs">Instruments (comma-separated)</Label>
            <Input value={instruments} onChange={e => setInstruments(e.target.value)} placeholder="CORN,WHEAT,SOYBEAN" className="bg-background border-border text-foreground" />
          </div>
          <Button
            className="w-full"
            disabled={createMutation.isPending || !userId || !firmName || assetClasses.length === 0}
            onClick={() => createMutation.mutate({
              userId: parseInt(userId),
              firmName,
              licenseNumber: licenseNumber || undefined,
              assetClasses: assetClasses as ("COMMODITY" | "EQUITY" | "FOREX" | "BOND")[],
              instruments: instruments.split(",").map(s => s.trim()).filter(Boolean),
            })}
          >
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Register"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create Obligation Dialog ─────────────────────────────────────────────────
function CreateObligationDialog({ profileId, onCreated }: { profileId: number; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [instrument, setInstrument] = useState("");
  const [assetClass, setAssetClass] = useState<"COMMODITY" | "EQUITY" | "FOREX" | "BOND">("COMMODITY");
  const [minBidSize, setMinBidSize] = useState("100");
  const [minAskSize, setMinAskSize] = useState("100");
  const [maxSpreadBps, setMaxSpreadBps] = useState("50");
  const [minUptimePct, setMinUptimePct] = useState("90");
  const [penaltyPerBreach, setPenaltyPerBreach] = useState("50000");

  const createMutation = trpc.marketMaker.adminCreateObligation.useMutation({
    onSuccess: () => {
      toast.success("Obligation created");
      setOpen(false);
      onCreated();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <Plus className="w-4 h-4" /> Add Obligation
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Add Market Making Obligation</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Instrument</Label>
              <Input value={instrument} onChange={e => setInstrument(e.target.value)} placeholder="CORN" className="bg-background border-border text-foreground" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Asset Class</Label>
              <Select value={assetClass} onValueChange={v => setAssetClass(v as typeof assetClass)}>
                <SelectTrigger className="bg-background border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["COMMODITY", "EQUITY", "FOREX", "BOND"].map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Min Bid Size</Label>
              <Input type="number" value={minBidSize} onChange={e => setMinBidSize(e.target.value)} className="bg-background border-border text-foreground" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Min Ask Size</Label>
              <Input type="number" value={minAskSize} onChange={e => setMinAskSize(e.target.value)} className="bg-background border-border text-foreground" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Max Spread (bps)</Label>
              <Input type="number" value={maxSpreadBps} onChange={e => setMaxSpreadBps(e.target.value)} className="bg-background border-border text-foreground" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Min Uptime %</Label>
              <Input type="number" value={minUptimePct} onChange={e => setMinUptimePct(e.target.value)} className="bg-background border-border text-foreground" />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Penalty/Breach (₦)</Label>
              <Input type="number" value={penaltyPerBreach} onChange={e => setPenaltyPerBreach(e.target.value)} className="bg-background border-border text-foreground" />
            </div>
          </div>
          <Button
            className="w-full"
            disabled={createMutation.isPending || !instrument}
            onClick={() => createMutation.mutate({
              marketMakerId: profileId,
              instrument,
              assetClass,
              minBidSize: parseFloat(minBidSize),
              minAskSize: parseFloat(minAskSize),
              maxSpreadBps: parseInt(maxSpreadBps),
              minUptimePct: parseFloat(minUptimePct),
              penaltyPerBreachNgn: parseFloat(penaltyPerBreach),
              effectiveFrom: new Date(),
            })}
          >
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Obligation"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MarketMakerDashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [penaltyFilter, setPenaltyFilter] = useState<"ALL" | "PENDING" | "INVOICED" | "PAID" | "WAIVED">("ALL");

  const statsQuery = trpc.marketMaker.adminGetStats.useQuery();
  const profilesQuery = trpc.marketMaker.adminListProfiles.useQuery({ status: "ALL" });
  const obligationsQuery = trpc.marketMaker.adminListObligations.useQuery(
    selectedProfileId ? { marketMakerId: selectedProfileId, activeOnly: false } : { activeOnly: false }
  );
  const reportsQuery = trpc.marketMaker.adminListPerformanceReports.useQuery({ penaltyStatus: penaltyFilter });
  const utils = trpc.useUtils();

  const updateStatusMutation = trpc.marketMaker.adminUpdateProfileStatus.useMutation({
    onSuccess: () => {
      toast.success("Status updated");
      utils.marketMaker.adminListProfiles.invalidate();
      utils.marketMaker.adminGetStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const updatePenaltyMutation = trpc.marketMaker.adminUpdatePenaltyStatus.useMutation({
    onSuccess: () => {
      toast.success("Penalty status updated");
      utils.marketMaker.adminListPerformanceReports.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deactivateObligationMutation = trpc.marketMaker.adminDeactivateObligation.useMutation({
    onSuccess: () => {
      toast.success("Obligation deactivated");
      utils.marketMaker.adminListObligations.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const runReportsMutation = trpc.marketMaker.adminRunPerformanceReportsNow.useMutation({
    onSuccess: (data) => {
      if (data.generated === 0) {
        toast.info("No new reports to generate", { description: "All active obligations already have a report for today." });
      } else {
        toast.success(`${data.generated} performance report(s) generated`, {
          description: data.lowUptimeAlerts > 0 ? `${data.lowUptimeAlerts} low-uptime alert(s) sent to owner.` : "All market makers are within uptime thresholds.",
        });
      }
      utils.marketMaker.adminListPerformanceReports.invalidate();
      utils.marketMaker.adminGetStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const stats = statsQuery.data;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Live Price Ticker — real-time WebSocket feed */}
      <LivePriceTicker className="-mx-6 -mt-6 mb-0" />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Market Maker Obligations</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage market maker profiles, obligations, and performance penalties
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => {
            utils.marketMaker.adminGetStats.invalidate();
            utils.marketMaker.adminListProfiles.invalidate();
            utils.marketMaker.adminListPerformanceReports.invalidate();
          }}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1 border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
            onClick={() => runReportsMutation.mutate()}
            disabled={runReportsMutation.isPending}
          >
            {runReportsMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <BarChart3 className="w-4 h-4" />
            )}
            Run Reports Now
          </Button>
          <CreateProfileDialog onCreated={() => {
            utils.marketMaker.adminListProfiles.invalidate();
            utils.marketMaker.adminGetStats.invalidate();
          }} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Users className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Active MMs</p>
                <p className="text-xl font-bold text-foreground">{stats?.profiles.active ?? "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Active Obligations</p>
                <p className="text-xl font-bold text-foreground">{stats?.obligations.active ?? "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending Penalties</p>
                <p className="text-xl font-bold text-foreground">
                  ₦{((stats?.penalties.totalPending ?? 0) / 1000).toFixed(0)}K
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Reports w/ Breaches</p>
                <p className="text-xl font-bold text-foreground">{stats?.penalties.reportsWithBreaches ?? "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="profiles">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="profiles">Profiles</TabsTrigger>
          <TabsTrigger value="obligations">Obligations</TabsTrigger>
          <TabsTrigger value="penalties">Penalty Reports</TabsTrigger>
        </TabsList>

        {/* Profiles Tab */}
        <TabsContent value="profiles" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-foreground">Registered Market Makers</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {profilesQuery.isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (profilesQuery.data?.length ?? 0) === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  No market makers registered yet.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="text-muted-foreground text-xs">Firm</TableHead>
                      <TableHead className="text-muted-foreground text-xs">License</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Asset Classes</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Status</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Registered</TableHead>
                      <TableHead className="text-muted-foreground text-xs text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {profilesQuery.data?.map(p => (
                      <TableRow key={p.id} className="border-border hover:bg-muted/30">
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium text-foreground">{p.firmName}</p>
                            <p className="text-xs text-muted-foreground">User #{p.userId}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{p.licenseNumber ?? "—"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {p.assetClasses.map(cls => (
                              <span key={cls} className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{cls}</span>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={STATUS_COLORS[p.status] ?? ""}>{p.status}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(p.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs h-7 text-blue-400 hover:text-blue-300"
                              onClick={() => setSelectedProfileId(p.id)}
                            >
                              Obligations <ChevronRight className="w-3 h-3 ml-1" />
                            </Button>
                            {p.status === "ACTIVE" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs h-7 text-amber-400 hover:text-amber-300"
                                onClick={() => updateStatusMutation.mutate({ profileId: Number(p.id), status: "SUSPENDED", reason: "Admin action" })}
                                disabled={updateStatusMutation.isPending}
                              >
                                Suspend
                              </Button>
                            )}
                            {p.status === "SUSPENDED" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs h-7 text-emerald-400 hover:text-emerald-300"
                                onClick={() => updateStatusMutation.mutate({ profileId: Number(p.id), status: "ACTIVE" })}
                                disabled={updateStatusMutation.isPending}
                              >
                                Reinstate
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Obligations Tab */}
        <TabsContent value="obligations" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base text-foreground">
                  {selectedProfileId ? `Obligations for Profile #${selectedProfileId}` : "All Obligations"}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {selectedProfileId && (
                    <>
                      <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setSelectedProfileId(null)}>
                        Show All
                      </Button>
                      <CreateObligationDialog profileId={selectedProfileId} onCreated={() => utils.marketMaker.adminListObligations.invalidate()} />
                    </>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {obligationsQuery.isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (obligationsQuery.data?.length ?? 0) === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  No obligations found.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="text-muted-foreground text-xs">Instrument</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Asset Class</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Max Spread</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Min Bid/Ask Size</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Min Uptime</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Penalty/Breach</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Status</TableHead>
                      <TableHead className="text-muted-foreground text-xs text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {obligationsQuery.data?.map(o => (
                      <TableRow key={o.id} className="border-border hover:bg-muted/30">
                        <TableCell className="text-sm font-medium text-foreground">{o.instrument}</TableCell>
                        <TableCell>
                          <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{o.assetClass}</span>
                        </TableCell>
                        <TableCell className="text-sm text-foreground">{o.maxSpreadBps} bps</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {parseFloat(o.minBidSize).toLocaleString()} / {parseFloat(o.minAskSize).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-sm text-foreground">{parseFloat(o.minUptimePct).toFixed(0)}%</TableCell>
                        <TableCell className="text-sm text-foreground">₦{parseFloat(o.penaltyPerBreachNgn).toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge className={o.isActive ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-muted text-muted-foreground"}>
                            {o.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {o.isActive && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs h-7 text-red-400 hover:text-red-300"
                              onClick={() => deactivateObligationMutation.mutate({ obligationId: Number(o.id) })}
                              disabled={deactivateObligationMutation.isPending}
                            >
                              Deactivate
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Penalty Reports Tab */}
        <TabsContent value="penalties" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base text-foreground">Performance & Penalty Reports</CardTitle>
                <Select value={penaltyFilter} onValueChange={v => setPenaltyFilter(v as typeof penaltyFilter)}>
                  <SelectTrigger className="w-36 h-8 text-xs bg-background border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["ALL", "PENDING", "INVOICED", "PAID", "WAIVED"].map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {reportsQuery.isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (reportsQuery.data?.length ?? 0) === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  No performance reports found.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="text-muted-foreground text-xs">MM / Instrument</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Date</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Uptime</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Breaches</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Penalty</TableHead>
                      <TableHead className="text-muted-foreground text-xs">Status</TableHead>
                      <TableHead className="text-muted-foreground text-xs text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportsQuery.data?.map(r => (
                      <TableRow key={r.id} className="border-border hover:bg-muted/30">
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium text-foreground">MM #{r.marketMakerId}</p>
                            <p className="text-xs text-muted-foreground">{r.instrument}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.reportDate}</TableCell>
                        <TableCell>
                          <span className={`text-sm font-medium ${parseFloat(r.uptimePct) >= 90 ? "text-emerald-400" : "text-red-400"}`}>
                            {parseFloat(r.uptimePct).toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell>
                          {r.totalBreaches > 0 ? (
                            <div className="text-xs space-y-0.5">
                              {r.spreadBreaches > 0 && <div className="text-amber-400">Spread: {r.spreadBreaches}</div>}
                              {r.sizeBreaches > 0 && <div className="text-orange-400">Size: {r.sizeBreaches}</div>}
                              {r.absenceBreaches > 0 && <div className="text-red-400">Absent: {r.absenceBreaches}</div>}
                            </div>
                          ) : (
                            <span className="text-xs text-emerald-400 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> None
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm font-medium text-foreground">
                          ₦{parseFloat(r.penaltyAmount).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge className={PENALTY_COLORS[r.penaltyStatus] ?? ""}>{r.penaltyStatus}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {r.penaltyStatus === "PENDING" && parseFloat(r.penaltyAmount) > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs h-7 text-blue-400 hover:text-blue-300"
                                onClick={() => updatePenaltyMutation.mutate({ reportId: Number(r.id), penaltyStatus: "INVOICED" })}
                                disabled={updatePenaltyMutation.isPending}
                              >
                                Invoice
                              </Button>
                            )}
                            {r.penaltyStatus === "INVOICED" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs h-7 text-emerald-400 hover:text-emerald-300"
                                onClick={() => updatePenaltyMutation.mutate({ reportId: Number(r.id), penaltyStatus: "PAID" })}
                                disabled={updatePenaltyMutation.isPending}
                              >
                                Mark Paid
                              </Button>
                            )}
                            {(r.penaltyStatus === "PENDING" || r.penaltyStatus === "INVOICED") && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs h-7 text-muted-foreground hover:text-foreground"
                                onClick={() => updatePenaltyMutation.mutate({ reportId: Number(r.id), penaltyStatus: "WAIVED", notes: "Admin waiver" })}
                                disabled={updatePenaltyMutation.isPending}
                              >
                                Waive
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Push Notification Settings */}
      <div className="mt-4 mb-20">
        <PushNotificationSettings compact />
      </div>

      {/* ── Bottom Nav ── */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-gray-950/95 backdrop-blur border-t border-gray-800 px-4 py-2 flex gap-2">
        <Button
          variant="outline"
          className="flex-1 h-10 text-xs border-gray-700 text-gray-300 hover:bg-gray-800 bg-transparent"
          onClick={() => navigate("/market-maker-dashboard")}
        >
          Dashboard
        </Button>
        <Button
          variant="outline"
          className="flex-1 h-10 text-xs border-amber-700/50 text-amber-300 hover:bg-amber-900/20 bg-transparent"
          onClick={() => navigate("/watchlist")}
        >
          <Star className="w-3.5 h-3.5 mr-1 fill-amber-400 text-amber-400" />
          Watchlist
        </Button>
        <Button
          variant="outline"
          className="flex-1 h-10 text-xs border-gray-700 text-gray-300 hover:bg-gray-800 bg-transparent"
          onClick={() => navigate("/trade")}
        >
          Trade
        </Button>
      </div>
    </div>
  );
}
