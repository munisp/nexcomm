/**
 * NEXCOM Exchange — Market Makers
 * Liquidity provider directory, performance, and obligations
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Users, Award, TrendingUp, AlertTriangle, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { PageSkeleton } from "@/components/PageSkeleton";

type MMStatus = "ACTIVE" | "SUSPENDED" | "PROBATION" | "PENDING";

interface MarketMaker {
  id: string;
  name: string;
  firm: string;
  country: string;
  instruments: string[];
  spreadObligation: number;
  dailyVolume: number;
  spreadCompliance: number;
  uptimeScore: number;
  performanceScore: number;
  status: MMStatus;
  licenseExpiry: string;
  joinedDate: string;
}

const MARKET_MAKERS: MarketMaker[] = [
  { id: "MM001", name: "Adewale Okonkwo",  firm: "Lagos Capital Markets Ltd",    country: "Nigeria",  instruments: ["MAIZE","SOYBEAN","GINGER","COCOA"],   spreadObligation: 0.5, dailyVolume: 12400000, spreadCompliance: 98.2, uptimeScore: 99.1, performanceScore: 97.8, status: "ACTIVE",    licenseExpiry: "2027-06-30", joinedDate: "2022-01-15" },
  { id: "MM002", name: "Kwame Asante",      firm: "Accra Trading House",          country: "Ghana",    instruments: ["COCOA","COFFEE","PALM-OIL","COTTON"], spreadObligation: 0.8, dailyVolume: 8900000,  spreadCompliance: 95.4, uptimeScore: 97.8, performanceScore: 94.2, status: "ACTIVE",    licenseExpiry: "2026-12-31", joinedDate: "2022-03-20" },
  { id: "MM003", name: "Fatima Al-Rashid",  firm: "Kano Commodities Corp",        country: "Nigeria",  instruments: ["GROUNDNUT","SESAME","GINGER","CHILI"],spreadObligation: 0.6, dailyVolume: 6200000,  spreadCompliance: 92.1, uptimeScore: 96.5, performanceScore: 91.8, status: "ACTIVE",    licenseExpiry: "2027-03-15", joinedDate: "2022-06-10" },
  { id: "MM004", name: "Emeka Nwosu",       firm: "Delta Agro Finance",           country: "Nigeria",  instruments: ["CASSAVA","YAM","PLANTAIN"],           spreadObligation: 1.0, dailyVolume: 3800000,  spreadCompliance: 88.5, uptimeScore: 94.2, performanceScore: 87.4, status: "PROBATION", licenseExpiry: "2026-09-30", joinedDate: "2023-01-05" },
  { id: "MM005", name: "Amara Diallo",      firm: "Dakar Grain Exchange",         country: "Senegal",  instruments: ["MILLET","SORGHUM","COWPEA"],          spreadObligation: 1.2, dailyVolume: 2100000,  spreadCompliance: 85.0, uptimeScore: 91.0, performanceScore: 83.5, status: "ACTIVE",    licenseExpiry: "2027-01-20", joinedDate: "2023-04-12" },
  { id: "MM006", name: "Chidi Obi",         firm: "Abuja Futures Ltd",            country: "Nigeria",  instruments: ["CRUDE-OIL","NATURAL-GAS","COAL"],     spreadObligation: 0.4, dailyVolume: 18500000, spreadCompliance: 99.0, uptimeScore: 99.8, performanceScore: 99.2, status: "ACTIVE",    licenseExpiry: "2028-06-30", joinedDate: "2021-07-01" },
  { id: "MM007", name: "Nkechi Eze",        firm: "Enugu Metals Trading",         country: "Nigeria",  instruments: ["GOLD","SILVER","COPPER","TIN"],        spreadObligation: 0.3, dailyVolume: 9800000,  spreadCompliance: 97.5, uptimeScore: 98.5, performanceScore: 96.8, status: "ACTIVE",    licenseExpiry: "2027-09-15", joinedDate: "2022-09-01" },
  { id: "MM008", name: "Seun Adeleke",      firm: "Ibadan Agri Capital",          country: "Nigeria",  instruments: ["TOMATO","PEPPER","ONION"],            spreadObligation: 1.5, dailyVolume: 1200000,  spreadCompliance: 78.2, uptimeScore: 88.0, performanceScore: 75.8, status: "SUSPENDED", licenseExpiry: "2026-06-30", joinedDate: "2023-07-15" },
  { id: "MM009", name: "Yemi Balogun",      firm: "Port Harcourt Energy MM",      country: "Nigeria",  instruments: ["CRUDE-OIL","DIESEL","KEROSENE"],      spreadObligation: 0.5, dailyVolume: 14200000, spreadCompliance: 98.8, uptimeScore: 99.5, performanceScore: 98.5, status: "ACTIVE",    licenseExpiry: "2028-03-31", joinedDate: "2021-11-20" },
  { id: "MM010", name: "Blessing Okafor",   firm: "Owerri Livestock Exchange",    country: "Nigeria",  instruments: ["CATTLE","GOAT","SHEEP","POULTRY"],    spreadObligation: 2.0, dailyVolume: 850000,   spreadCompliance: 82.0, uptimeScore: 90.0, performanceScore: 80.5, status: "PROBATION", licenseExpiry: "2026-08-15", joinedDate: "2023-10-01" },
  { id: "MM011", name: "Kofi Mensah",       firm: "Kumasi Cocoa Specialists",     country: "Ghana",    instruments: ["COCOA","COFFEE","SHEA"],              spreadObligation: 0.7, dailyVolume: 7400000,  spreadCompliance: 96.0, uptimeScore: 97.2, performanceScore: 95.1, status: "ACTIVE",    licenseExpiry: "2027-06-30", joinedDate: "2022-02-28" },
  { id: "MM012", name: "Aisha Musa",        firm: "Katsina Groundnut Corp",       country: "Nigeria",  instruments: ["GROUNDNUT","SESAME","COTTONSEED"],    spreadObligation: 0.9, dailyVolume: 4100000,  spreadCompliance: 90.5, uptimeScore: 93.8, performanceScore: 89.2, status: "ACTIVE",    licenseExpiry: "2027-04-30", joinedDate: "2022-11-10" },
];

const PENDING_APPS = [
  { id: "APP001", name: "Tunde Fashola",   firm: "Kaduna Grain Brokers",      instruments: ["MAIZE","WHEAT","SORGHUM"], country: "Nigeria", applied: "2026-02-28" },
  { id: "APP002", name: "Grace Osei",      firm: "Accra Futures House",       instruments: ["COCOA","COFFEE"],          country: "Ghana",   applied: "2026-03-01" },
  { id: "APP003", name: "Mohammed Bello",  firm: "Maiduguri Livestock MM",    instruments: ["CATTLE","GOAT"],           country: "Nigeria", applied: "2026-03-02" },
];

const STATUS_CONFIG: Record<MMStatus, { label: string; className: string }> = {
  ACTIVE:    { label: "Active",    className: "badge-settled" },
  SUSPENDED: { label: "Suspended", className: "badge-cancelled" },
  PROBATION: { label: "Probation", className: "badge-pending" },
  PENDING:   { label: "Pending",   className: "badge-active" },
};

export default function MarketMakers() {
  const [tab, setTab] = useState("all");
  const [detail, setDetail] = useState<MarketMaker | null>(null);
  const utils = trpc.useUtils();

  // Real market maker data
  const { data: mmProfiles, isLoading: mmProfilesLoading } = trpc.marketMaker.adminListProfiles.useQuery(
    { status: "ALL" },
    { retry: false }
  );

  // Pending onboarding applications (KYC status = PENDING)
  const { data: pendingData } = trpc.marketMakerOnboarding.adminListMarketMakerProfiles.useQuery(
    { kycStatus: "PENDING", limit: 50, offset: 0 },
    { retry: false }
  );
  const pendingApps = pendingData?.profiles ?? [];

  // Approve / reject mutations
  const reviewMutation = trpc.marketMakerOnboarding.adminReviewMarketMakerKYC.useMutation({
    onSuccess: () => {
      void utils.marketMakerOnboarding.adminListMarketMakerProfiles.invalidate();
    },
  });

  const liveMarketMakers = useMemo<MarketMaker[]>(() => {
    if (!mmProfiles || mmProfiles.length === 0) return MARKET_MAKERS;
    return mmProfiles.map(p => ({
      id: String(p.id),
      name: p.firmName,
      firm: p.firmName,
      country: "Nigeria",
      instruments: Array.isArray(p.instruments) ? p.instruments : [],
      spreadObligation: 0,
      dailyVolume: 0,
      spreadCompliance: 100,
      uptimeScore: 100,
      performanceScore: 100,
      status: (p.status === "ACTIVE" ? "ACTIVE" : p.status === "SUSPENDED" ? "SUSPENDED" : "PENDING") as MMStatus,
      licenseExpiry: "",
      joinedDate: p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : "",
    }));
  }, [mmProfiles]);

  const totalLiquidity = liveMarketMakers.reduce((s, m) => s + m.dailyVolume, 0);
  const active = liveMarketMakers.filter(m => m.status === "ACTIVE").length;
  const avgSpread = liveMarketMakers.length > 0 ? liveMarketMakers.reduce((s, m) => s + m.spreadObligation, 0) / liveMarketMakers.length : 0;

  const sorted = [...liveMarketMakers].sort((a, b) => b.performanceScore - a.performanceScore);

  const handleApprove = (id: number) => {
    reviewMutation.mutate(
      { marketMakerId: id, decision: "APPROVED" },
      { onSuccess: () => toast.success("Application approved — market maker onboarded"),
        onError: (e) => toast.error(e.message ?? "Approval failed") }
    );
  };
  const handleReject = (id: number) => {
    reviewMutation.mutate(
      { marketMakerId: id, decision: "REJECTED" },
      { onSuccess: () => toast.error("Application rejected"),
        onError: (e) => toast.error(e.message ?? "Rejection failed") }
    );
  };

  if (mmProfilesLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
  return (
    <div className="page-container space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2" style={{ fontFamily: "'DM Serif Display', serif" }}>
          <Users className="w-6 h-6 text-primary" />
          Market Makers
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">Liquidity providers, performance monitoring, and obligations</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total MMs",      value: liveMarketMakers.length,                    icon: Users },
          { label: "Active",         value: active,                                   icon: CheckCircle2 },
          { label: "Avg Spread Obl.",value: `${avgSpread.toFixed(2)}%`,              icon: TrendingUp },
          { label: "Total Liquidity",value: `$${(totalLiquidity / 1e6).toFixed(0)}M`,icon: Award },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="stat-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{label}</span>
              <Icon className="w-4 h-4 text-primary" />
            </div>
            <div className="text-xl font-bold font-mono text-foreground">{value}</div>
          </div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">All Market Makers</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="obligations">Obligations</TabsTrigger>
          <TabsTrigger value="applications">Applications ({pendingApps.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[800px]">
                <thead>
                  <tr className="border-b border-border bg-secondary/50">
                    {["ID","Name / Firm","Country","Instruments","Spread Obl.","Daily Vol.","Score","Status",""].map(h => (
                      <th key={h} className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {liveMarketMakers.map(mm => {
                    const sc = STATUS_CONFIG[mm.status];
                    return (
                      <tr key={mm.id} className="hover:bg-secondary/30 transition-colors">
                        <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{mm.id}</td>
                        <td className="px-3 py-3">
                          <div className="font-semibold text-foreground text-sm">{mm.name}</div>
                          <div className="text-xs text-muted-foreground">{mm.firm}</div>
                        </td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">{mm.country}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1">
                            {mm.instruments.slice(0, 3).map(i => (
                              <span key={i} className="text-[10px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground">{i}</span>
                            ))}
                            {mm.instruments.length > 3 && <span className="text-[10px] text-muted-foreground">+{mm.instruments.length - 3}</span>}
                          </div>
                        </td>
                        <td className="px-3 py-3 font-mono text-xs">{mm.spreadObligation}%</td>
                        <td className="px-3 py-3 font-mono text-xs">${(mm.dailyVolume / 1e6).toFixed(1)}M</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                              <div className="h-full bg-primary rounded-full" style={{ width: `${mm.performanceScore}%` }} />
                            </div>
                            <span className="font-mono text-xs text-foreground">{mm.performanceScore.toFixed(1)}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3"><Badge className={"text-[10px] " + sc.className}>{sc.label}</Badge></td>
                        <td className="px-3 py-3">
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setDetail(mm)}>View</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="performance" className="mt-4">
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  {["Rank","Name","Firm","Spread Compliance","Uptime","Performance","Volume"].map(h => (
                    <th key={h} className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((mm, i) => (
                  <tr key={mm.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-3 py-3">
                      <span className={`font-bold text-sm ${i === 0 ? "text-yellow-400" : i === 1 ? "text-muted-foreground" : i === 2 ? "text-amber-600" : "text-muted-foreground"}`}>
                        #{i + 1}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-semibold text-foreground text-sm">{mm.name}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{mm.firm}</td>
                    <td className="px-3 py-3">
                      <span className={`font-mono text-sm ${mm.spreadCompliance >= 95 ? "text-positive" : mm.spreadCompliance >= 85 ? "text-yellow-400" : "text-negative"}`}>
                        {mm.spreadCompliance.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-sm text-foreground">{mm.uptimeScore.toFixed(1)}%</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 bg-secondary rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${mm.performanceScore >= 95 ? "bg-positive" : mm.performanceScore >= 85 ? "bg-yellow-400" : "bg-negative"}`} style={{ width: `${mm.performanceScore}%` }} />
                        </div>
                        <span className="font-mono text-sm font-semibold text-foreground">{mm.performanceScore.toFixed(1)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">${(mm.dailyVolume / 1e6).toFixed(1)}M</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="obligations" className="mt-4">
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  {["Market Maker","Instruments","Spread Obligation","Compliance","License Expiry","Breach Status"].map(h => (
                    <th key={h} className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {liveMarketMakers.map(mm => {
                  const breach = mm.spreadCompliance < 85;
                  const expiringSoon = new Date(mm.licenseExpiry) < new Date(Date.now() + 90 * 86400000);
                  return (
                    <tr key={mm.id} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-3 py-3">
                        <div className="font-semibold text-foreground text-sm">{mm.name}</div>
                        <div className="text-xs text-muted-foreground">{mm.id}</div>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">{mm.instruments.join(", ")}</td>
                      <td className="px-3 py-3 font-mono text-sm">≤ {mm.spreadObligation}%</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${mm.spreadCompliance >= 95 ? "bg-positive" : mm.spreadCompliance >= 85 ? "bg-yellow-400" : "bg-negative"}`} style={{ width: `${mm.spreadCompliance}%` }} />
                          </div>
                          <span className={`font-mono text-xs ${mm.spreadCompliance >= 95 ? "text-positive" : mm.spreadCompliance >= 85 ? "text-yellow-400" : "text-negative"}`}>
                            {mm.spreadCompliance.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs">
                        <span className={expiringSoon ? "text-yellow-400 font-semibold" : "text-muted-foreground"}>{mm.licenseExpiry}</span>
                      </td>
                      <td className="px-3 py-3">
                        {breach
                          ? <Badge className="badge-cancelled text-[10px]"><AlertTriangle className="w-3 h-3 mr-1" />Breach</Badge>
                          : <Badge className="badge-settled text-[10px]"><CheckCircle2 className="w-3 h-3 mr-1" />Compliant</Badge>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="applications" className="mt-4">
          {pendingApps.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">No pending applications</div>
          ) : (
            <div className="space-y-3">
              {pendingApps.map(app => (
                <div key={app.id} className="stat-card flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-semibold text-foreground">{app.firmName}</span>
                      <Badge className="badge-active text-[10px]">Pending Review</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{app.tradingDesk ?? ""} · {app.contactEmail ?? ""}</div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {(app.instrumentObligations ?? []).map(i => (
                        <span key={i} className="text-[10px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground">{i}</span>
                      ))}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground mr-4">Applied: {new Date(app.createdAt).toLocaleDateString()}</div>
                  <div className="flex gap-2">
                    <Button size="sm" className="h-8 bg-positive hover:bg-positive/90 text-white" disabled={reviewMutation.isPending} onClick={() => handleApprove(app.id)}>Approve</Button>
                    <Button size="sm" variant="outline" className="h-8 text-negative border-negative/30 hover:bg-negative/10" disabled={reviewMutation.isPending} onClick={() => handleReject(app.id)}>Reject</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Detail Dialog */}
      <Dialog open={!!detail} onOpenChange={() => setDetail(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{detail?.name}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Firm",            value: detail.firm },
                  { label: "Country",         value: detail.country },
                  { label: "ID",              value: detail.id },
                  { label: "Status",          value: detail.status },
                  { label: "Spread Obl.",     value: `≤ ${detail.spreadObligation}%` },
                  { label: "Daily Volume",    value: `$${(detail.dailyVolume / 1e6).toFixed(1)}M` },
                  { label: "Spread Compliance", value: `${detail.spreadCompliance.toFixed(1)}%` },
                  { label: "Uptime",          value: `${detail.uptimeScore.toFixed(1)}%` },
                  { label: "Performance",     value: `${detail.performanceScore.toFixed(1)}/100` },
                  { label: "License Expiry",  value: detail.licenseExpiry },
                  { label: "Joined",          value: detail.joinedDate },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-secondary/50 rounded-lg p-2">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="font-semibold text-foreground mt-0.5">{value}</div>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-2">Instruments</div>
                <div className="flex flex-wrap gap-1">
                  {detail.instruments.map(i => (
                    <span key={i} className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">{i}</span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
