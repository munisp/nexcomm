import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  TrendingUp, CheckCircle2, AlertTriangle, BarChart3, Loader2, ShieldCheck,
} from "lucide-react";

const PENALTY_COLORS: Record<string, string> = {
  PENDING: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  INVOICED: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  PAID: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  WAIVED: "bg-muted text-muted-foreground",
};

export default function MarketMakerPerformance() {
  const { user } = useAuth();
  const profileQuery = trpc.marketMaker.myProfile.useQuery();
  const obligationsQuery = trpc.marketMaker.myObligations.useQuery();
  const reportsQuery = trpc.marketMaker.myPerformanceReports.useQuery({ limit: 50 });

  if (profileQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profileQuery.data) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card className="bg-card border-border">
          <CardContent className="p-12 text-center">
            <ShieldCheck className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-foreground mb-2">No Market Maker Profile</h2>
            <p className="text-sm text-muted-foreground">
              Your account does not have an active market maker profile. Contact an administrator to register.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const profile = profileQuery.data;
  const reports = reportsQuery.data ?? [];
  const totalPenaltyPending = reports
    .filter(r => r.penaltyStatus === "PENDING")
    .reduce((sum, r) => sum + parseFloat(r.penaltyAmount), 0);
  const avgUptime = reports.length > 0
    ? reports.reduce((sum, r) => sum + parseFloat(r.uptimePct), 0) / reports.length
    : 0;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Market Making Performance</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{profile.firmName} — License: {profile.licenseNumber ?? "N/A"}</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Active Obligations</p>
                <p className="text-xl font-bold text-foreground">{obligationsQuery.data?.length ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg Uptime</p>
                <p className={`text-xl font-bold ${avgUptime >= 90 ? "text-emerald-400" : "text-red-400"}`}>
                  {avgUptime.toFixed(1)}%
                </p>
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
                <p className="text-xl font-bold text-foreground">₦{(totalPenaltyPending / 1000).toFixed(0)}K</p>
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
                <p className="text-xs text-muted-foreground">Total Reports</p>
                <p className="text-xl font-bold text-foreground">{reports.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Obligations */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-foreground">My Obligations</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {obligationsQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (obligationsQuery.data?.length ?? 0) === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">No active obligations.</div>
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Performance Reports */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-foreground">Performance Reports</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {reportsQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : reports.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">No performance reports yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground text-xs">Instrument</TableHead>
                  <TableHead className="text-muted-foreground text-xs">Date</TableHead>
                  <TableHead className="text-muted-foreground text-xs">Uptime</TableHead>
                  <TableHead className="text-muted-foreground text-xs">Avg Spread</TableHead>
                  <TableHead className="text-muted-foreground text-xs">Breaches</TableHead>
                  <TableHead className="text-muted-foreground text-xs">Penalty</TableHead>
                  <TableHead className="text-muted-foreground text-xs">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map(r => (
                  <TableRow key={r.id} className="border-border hover:bg-muted/30">
                    <TableCell className="text-sm font-medium text-foreground">{r.instrument}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.reportDate}</TableCell>
                    <TableCell>
                      <span className={`text-sm font-medium ${parseFloat(r.uptimePct) >= 90 ? "text-emerald-400" : "text-red-400"}`}>
                        {parseFloat(r.uptimePct).toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.avgSpreadBps ?? 0} bps</TableCell>
                    <TableCell>
                      {r.totalBreaches > 0 ? (
                        <span className="text-xs text-red-400">{r.totalBreaches} breach{r.totalBreaches !== 1 ? "es" : ""}</span>
                      ) : (
                        <span className="text-xs text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> None
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-foreground">₦{parseFloat(r.penaltyAmount).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge className={PENALTY_COLORS[r.penaltyStatus] ?? ""}>{r.penaltyStatus}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
