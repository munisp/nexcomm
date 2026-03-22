/**
 * ComplianceDashboard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Unified compliance operations centre for NEXCOM compliance officers.
 * Aggregates:
 *   - KYC queue stats (pending / under review / approved / rejected)
 *   - AML flag stats (open / reviewed / escalated / SAR filed)
 *   - Re-KYC due dates (overdue / due this week / upcoming)
 *   - DFSP KYC stats (pending / approved / EDD required)
 *   - Recent activity feed
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Shield, AlertTriangle, Clock, CheckCircle, XCircle,
  Users, FileWarning, RefreshCw, ArrowRight, Activity,
  ShieldAlert, ShieldCheck, TrendingUp, AlertCircle
} from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";

// ── Stat card ──────────────────────────────────────────────────────────────

function StatCard({
  title, value, sub, icon: Icon, color, href
}: {
  title: string; value: number | string; sub?: string;
  icon: React.ElementType; color: string; href?: string;
}) {
  const inner = (
    <Card className={`border-l-4 ${color} bg-slate-900 border-slate-700 hover:bg-slate-800 transition-colors`}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide">{title}</p>
            <p className="text-3xl font-bold text-white mt-1">{value}</p>
            {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
          </div>
          <Icon className="h-8 w-8 text-slate-500" />
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

// ── Main component ─────────────────────────────────────────────────────────

export default function ComplianceDashboard() {
  const [tab, setTab] = useState("overview");

  // KYC queue stats (user KYC applications)
  const kycQueueQuery = trpc.kycAnalysis.adminListKycQueue.useQuery({ status: "ALL", limit: 100 });
  const kycQueue: any[] = (kycQueueQuery.data as any)?.records ?? (kycQueueQuery.data as any) ?? [];
  const kycPending = kycQueue.filter((r: any) => r.status === "PENDING").length;
  const kycUnderReview = kycQueue.filter((r: any) => r.status === "UNDER_REVIEW").length;
  const kycApproved = kycQueue.filter((r: any) => r.status === "APPROVED").length;
  const kycRejected = kycQueue.filter((r: any) => r.status === "REJECTED").length;

  // AML flag stats — live aggregated dashboard stats
  const amlStatsQuery = trpc.aml.getDashboardStats.useQuery();
  const amlStats = amlStatsQuery.data as {
    total?: number; open?: number; reviewed?: number;
    escalated?: number; sarFiled?: number;
    cleared?: number; critical?: number; high?: number;
    sarTotal?: number; sarPending?: number; activeRules?: number;
  } | undefined;

  // Re-KYC flags
  const reKycQuery = trpc.kycAnalysis.listReKycFlags.useQuery({ includeResolved: false });
  const reKycFlags: any[] = reKycQuery.data?.flags ?? [];
  const now = Date.now();
  // Flags older than 90 days without resolution are considered overdue
  const reKycOverdue = reKycFlags.filter((f: any) => !f.resolvedAt && new Date(f.createdAt).getTime() < now - 90 * 24 * 3600 * 1000).length;
  const reKycThisWeek = reKycFlags.filter((f: any) => {
    if (f.resolvedAt) return false;
    const created = new Date(f.createdAt).getTime();
    return created >= now - 7 * 24 * 3600 * 1000;
  }).length;

  // DFSP KYC stats
  const dfspStatsQuery = trpc.dfspKyc.kycStats.useQuery();
  const dfspStats = dfspStatsQuery.data as {
    total?: number; pending?: number; approved?: number;
    rejected?: number; eddRequired?: number;
  } | undefined;

  // Recent AML flags for activity feed
  const amlFlagsQuery = trpc.aml.adminListFlags.useQuery({ limit: 10, offset: 0 });
  const recentFlags: any[] = (amlFlagsQuery.data?.flags ?? []).slice(0, 8);

  const isLoading = kycQueueQuery.isLoading || amlStatsQuery.isLoading || dfspStatsQuery.isLoading;

  const refresh = () => {
    kycQueueQuery.refetch();
    amlStatsQuery.refetch();
    reKycQuery.refetch();
    dfspStatsQuery.refetch();
    amlFlagsQuery.refetch();
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 bg-slate-950 min-h-screen">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Shield className="h-6 w-6 text-emerald-400" />
              Compliance Operations Centre
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Unified view of KYC queue, AML flags, re-KYC schedules, and DFSP compliance
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}
            className="border-slate-600 text-slate-300 hover:bg-slate-800">
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="overview" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white text-slate-300">Overview</TabsTrigger>
            <TabsTrigger value="kyc" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white text-slate-300">KYC Queue</TabsTrigger>
            <TabsTrigger value="aml" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white text-slate-300">AML Flags</TabsTrigger>
            <TabsTrigger value="rekyc" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white text-slate-300">Re-KYC</TabsTrigger>
            <TabsTrigger value="dfsp" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white text-slate-300">DFSP KYC</TabsTrigger>
          </TabsList>

          {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
          <TabsContent value="overview" className="space-y-6 mt-6">
            {/* KYC Queue */}
            <div>
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                <Users className="h-4 w-4" /> User KYC Queue
              </h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard title="Pending" value={kycPending} icon={Clock}
                  color="border-amber-500" href="/compliance" />
                <StatCard title="Under Review" value={kycUnderReview} icon={Activity}
                  color="border-blue-500" href="/compliance" />
                <StatCard title="Approved" value={kycApproved} icon={CheckCircle}
                  color="border-emerald-500" href="/compliance" />
                <StatCard title="Rejected" value={kycRejected} icon={XCircle}
                  color="border-red-500" href="/compliance" />
              </div>
            </div>

            {/* AML Flags */}
            <div>
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> AML Flags
              </h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard title="Open Flags" value={amlStats?.open ?? 0} icon={AlertTriangle}
                  color="border-red-500" href="/aml" />
                <StatCard title="Under Review" value={amlStats?.reviewed ?? 0} icon={Activity}
                  color="border-blue-500" href="/aml" />
                <StatCard title="Escalated" value={amlStats?.escalated ?? 0} icon={ShieldAlert}
                  color="border-orange-500" href="/aml" />
                <StatCard title="SAR Filed" value={amlStats?.sarFiled ?? 0} icon={FileWarning}
                  color="border-purple-500" href="/sar-filing" />
              </div>
            </div>

            {/* Re-KYC */}
            <div>
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                <RefreshCw className="h-4 w-4" /> Re-KYC Schedule
              </h2>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <StatCard title="Overdue" value={reKycOverdue} icon={AlertCircle}
                  color="border-red-600" sub="Immediate action required"
                  href="/admin/re-kyc-flags" />
                <StatCard title="Due This Week" value={reKycThisWeek} icon={Clock}
                  color="border-amber-500" sub="Action required soon"
                  href="/admin/re-kyc-flags" />
                <StatCard title="Total Pending" value={reKycFlags.filter((f: any) => !f.resolvedAt).length}
                  icon={RefreshCw} color="border-slate-500"
                  href="/admin/re-kyc-flags" />
              </div>
            </div>

            {/* DFSP KYC */}
            <div>
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> DFSP KYC (Mojaloop)
              </h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard title="Pending Review" value={dfspStats?.pending ?? 0} icon={Clock}
                  color="border-amber-500" href="/admin/dfsp-kyc" />
                <StatCard title="Approved" value={dfspStats?.approved ?? 0} icon={CheckCircle}
                  color="border-emerald-500" href="/admin/dfsp-kyc" />
                <StatCard title="EDD Required" value={dfspStats?.eddRequired ?? 0} icon={ShieldAlert}
                  color="border-orange-500" href="/admin/dfsp-kyc" />
                <StatCard title="Rejected" value={dfspStats?.rejected ?? 0} icon={XCircle}
                  color="border-red-500" href="/admin/dfsp-kyc" />
              </div>
            </div>

            {/* Recent AML Activity */}
            <Card className="bg-slate-900 border-slate-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-white text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-emerald-400" />
                    Recent AML Activity
                  </span>
                  <Link href="/aml">
                    <Button variant="ghost" size="sm" className="text-emerald-400 hover:text-emerald-300 h-7 px-2">
                      View All <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {recentFlags.length === 0 ? (
                  <p className="text-slate-500 text-sm text-center py-4">No recent AML flags</p>
                ) : (
                  <div className="space-y-2">
                    {recentFlags.map((flag: any) => (
                      <div key={flag.id} className="flex items-center justify-between py-2 border-b border-slate-800 last:border-0">
                        <div className="flex items-center gap-3">
                          <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0" />
                          <div>
                            <p className="text-sm text-white">{flag.reason ?? "AML flag triggered"}</p>
                            <p className="text-xs text-slate-400">
                              {flag.createdAt ? formatDistanceToNow(new Date(flag.createdAt), { addSuffix: true }) : ""}
                            </p>
                          </div>
                        </div>
                        <Badge variant="outline" className={
                          flag.status === "OPEN" ? "border-red-500 text-red-400" :
                          flag.status === "REVIEWED" ? "border-blue-500 text-blue-400" :
                          flag.status === "ESCALATED" ? "border-orange-500 text-orange-400" :
                          "border-slate-500 text-slate-400"
                        }>
                          {flag.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── KYC QUEUE TAB ─────────────────────────────────────────────── */}
          <TabsContent value="kyc" className="mt-6">
            <Card className="bg-slate-900 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center justify-between">
                  <span>KYC Application Queue</span>
                  <Link href="/compliance">
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                      Open Full Review <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {kycQueue.slice(0, 15).map((item: any) => (
                    <div key={item.id} className="flex items-center justify-between p-3 bg-slate-800 rounded-lg">
                      <div>
                        <p className="text-sm text-white font-medium">
                          {item.user?.name ?? `User #${item.userId}`}
                        </p>
                        <p className="text-xs text-slate-400">
                          Submitted {item.submittedAt ? formatDistanceToNow(new Date(item.submittedAt), { addSuffix: true }) : ""}
                        </p>
                      </div>
                      <Badge variant="outline" className={
                        item.status === "PENDING" ? "border-amber-500 text-amber-400" :
                        item.status === "UNDER_REVIEW" ? "border-blue-500 text-blue-400" :
                        item.status === "APPROVED" ? "border-emerald-500 text-emerald-400" :
                        "border-red-500 text-red-400"
                      }>
                        {item.status}
                      </Badge>
                    </div>
                  ))}
                  {kycQueue.length === 0 && (
                    <p className="text-slate-500 text-sm text-center py-8">No KYC applications in queue</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── AML FLAGS TAB ─────────────────────────────────────────────── */}
          <TabsContent value="aml" className="mt-6">
            <Card className="bg-slate-900 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center justify-between">
                  <span>AML Flag Summary</span>
                  <Link href="/aml">
                    <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white">
                      Open AML Dashboard <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  {[
                    { label: "Total Flags", value: amlStats?.total ?? 0, color: "text-white" },
                    { label: "Open", value: amlStats?.open ?? 0, color: "text-red-400" },
                    { label: "Reviewed", value: amlStats?.reviewed ?? 0, color: "text-blue-400" },
                    { label: "Escalated", value: amlStats?.escalated ?? 0, color: "text-orange-400" },
                    { label: "SAR Filed", value: amlStats?.sarFiled ?? 0, color: "text-purple-400" },
                    { label: "Critical", value: amlStats?.critical ?? 0, color: "text-red-500" },
                    { label: "High Severity", value: amlStats?.high ?? 0, color: "text-orange-500" },
                    { label: "Active Rules", value: amlStats?.activeRules ?? 0, color: "text-emerald-400" },
                  ].map(s => (
                    <div key={s.label} className="bg-slate-800 rounded-lg p-4">
                      <p className="text-xs text-slate-400">{s.label}</p>
                      <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  {recentFlags.map((flag: any) => (
                    <div key={flag.id} className="flex items-center justify-between p-3 bg-slate-800 rounded-lg">
                      <div>
                        <p className="text-sm text-white">{flag.reason ?? "AML flag"}</p>
                        <p className="text-xs text-slate-400">
                          {flag.transactionRef ?? ""} · {flag.createdAt ? formatDistanceToNow(new Date(flag.createdAt), { addSuffix: true }) : ""}
                        </p>
                      </div>
                      <Badge variant="outline" className={
                        flag.status === "OPEN" ? "border-red-500 text-red-400" :
                        flag.status === "REVIEWED" ? "border-blue-500 text-blue-400" :
                        "border-orange-500 text-orange-400"
                      }>
                        {flag.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── RE-KYC TAB ────────────────────────────────────────────────── */}
          <TabsContent value="rekyc" className="mt-6">
            <Card className="bg-slate-900 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center justify-between">
                  <span>Re-KYC Schedule</span>
                  <Link href="/admin/re-kyc-flags">
                    <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white">
                      Manage Re-KYC <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {reKycFlags.slice(0, 15).map((flag: any) => {
                    const dueDate = flag.dueDate ? new Date(flag.dueDate) : null;
                    const isOverdue = dueDate && dueDate.getTime() < now;
                    return (
                      <div key={flag.id} className="flex items-center justify-between p-3 bg-slate-800 rounded-lg">
                        <div>
                          <p className="text-sm text-white font-medium">
                            {flag.user?.name ?? `User #${flag.userId}`}
                          </p>
                          <p className="text-xs text-slate-400">
                            {flag.reason ?? "Periodic re-verification"} ·{" "}
                            {dueDate ? `Due ${formatDistanceToNow(dueDate, { addSuffix: true })}` : "No due date"}
                          </p>
                        </div>
                        <Badge variant="outline" className={
                          isOverdue ? "border-red-500 text-red-400" :
                          flag.status === "PENDING" ? "border-amber-500 text-amber-400" :
                          "border-emerald-500 text-emerald-400"
                        }>
                          {isOverdue ? "OVERDUE" : flag.status}
                        </Badge>
                      </div>
                    );
                  })}
                  {reKycFlags.length === 0 && (
                    <p className="text-slate-500 text-sm text-center py-8">No re-KYC flags pending</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── DFSP KYC TAB ──────────────────────────────────────────────── */}
          <TabsContent value="dfsp" className="mt-6">
            <Card className="bg-slate-900 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center justify-between">
                  <span>DFSP KYC Applications</span>
                  <Link href="/admin/dfsp-kyc">
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                      Open Review Panel <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  {[
                    { label: "Total", value: dfspStats?.total ?? 0, color: "text-white" },
                    { label: "Pending", value: dfspStats?.pending ?? 0, color: "text-amber-400" },
                    { label: "Approved", value: dfspStats?.approved ?? 0, color: "text-emerald-400" },
                    { label: "EDD Required", value: dfspStats?.eddRequired ?? 0, color: "text-orange-400" },
                  ].map(s => (
                    <div key={s.label} className="bg-slate-800 rounded-lg p-4">
                      <p className="text-xs text-slate-400">{s.label}</p>
                      <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 p-4 bg-slate-800 rounded-lg border border-amber-500/30">
                  <TrendingUp className="h-5 w-5 text-amber-400 flex-shrink-0" />
                  <p className="text-sm text-slate-300">
                    DFSP KYC applications with HIGH AML risk are automatically flagged for Enhanced Due Diligence (EDD).
                    Review and approve/reject from the DFSP KYC Review panel.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
