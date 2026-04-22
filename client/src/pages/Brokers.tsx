/**
 * NEXCOM Exchange — Registered Brokers
 * Broker directory, performance, commissions, and client management
 */
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Briefcase, Star, TrendingUp, Users, Phone, Mail, Globe, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { PageSkeleton } from "@/components/PageSkeleton";

type BrokerStatus = "ACTIVE" | "SUSPENDED" | "PROBATION";

interface Broker {
  id: string;
  name: string;
  firm: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  specialties: string[];
  clients: number;
  monthlyVolume: number;
  commissionRate: number;
  rating: number;
  status: BrokerStatus;
  licenseNo: string;
  licenseExpiry: string;
  joinedDate: string;
  completedTrades: number;
}

const BROKERS: Broker[] = [
  { id: "BRK001", name: "Olumide Adeyemi",    firm: "Lagos Commodity Brokers Ltd",    city: "Lagos",     country: "Nigeria", phone: "+234-801-234-5678", email: "o.adeyemi@lcb.ng",      website: "lcb.ng",          specialties: ["Grains","Oilseeds","Metals"],       clients: 284, monthlyVolume: 48200000, commissionRate: 0.25, rating: 4.8, status: "ACTIVE",    licenseNo: "NCX-BRK-001", licenseExpiry: "2027-06-30", joinedDate: "2021-03-15", completedTrades: 12480 },
  { id: "BRK002", name: "Chidinma Okafor",    firm: "Abuja Capital Markets",          city: "Abuja",     country: "Nigeria", phone: "+234-802-345-6789", email: "c.okafor@acm.ng",       website: "acm.ng",          specialties: ["Energy","Metals","Equities"],       clients: 196, monthlyVolume: 38400000, commissionRate: 0.30, rating: 4.6, status: "ACTIVE",    licenseNo: "NCX-BRK-002", licenseExpiry: "2027-03-31", joinedDate: "2021-06-20", completedTrades: 9840 },
  { id: "BRK003", name: "Kwame Mensah",       firm: "Accra Commodities House",        city: "Accra",     country: "Ghana",   phone: "+233-501-234-567",  email: "k.mensah@ach.gh",       website: "ach.gh",          specialties: ["Cocoa","Coffee","Soft Commodities"],clients: 142, monthlyVolume: 28600000, commissionRate: 0.35, rating: 4.5, status: "ACTIVE",    licenseNo: "NCX-BRK-003", licenseExpiry: "2026-12-31", joinedDate: "2021-09-10", completedTrades: 7240 },
  { id: "BRK004", name: "Fatima Musa",        firm: "Kano Agri Brokers",              city: "Kano",      country: "Nigeria", phone: "+234-803-456-7890", email: "f.musa@kab.ng",         website: "kab.ng",          specialties: ["Groundnut","Sesame","Livestock"],   clients: 118, monthlyVolume: 18400000, commissionRate: 0.40, rating: 4.3, status: "ACTIVE",    licenseNo: "NCX-BRK-004", licenseExpiry: "2027-09-30", joinedDate: "2022-01-05", completedTrades: 5620 },
  { id: "BRK005", name: "Emeka Eze",          firm: "Port Harcourt Energy Brokers",   city: "PH",        country: "Nigeria", phone: "+234-804-567-8901", email: "e.eze@pheb.ng",         website: "pheb.ng",         specialties: ["Crude Oil","Gas","Petroleum"],      clients: 88,  monthlyVolume: 62400000, commissionRate: 0.20, rating: 4.9, status: "ACTIVE",    licenseNo: "NCX-BRK-005", licenseExpiry: "2028-03-31", joinedDate: "2021-01-15", completedTrades: 18240 },
  { id: "BRK006", name: "Amara Diallo",       firm: "Dakar West Africa Brokers",      city: "Dakar",     country: "Senegal", phone: "+221-77-123-4567",  email: "a.diallo@dwab.sn",      website: "dwab.sn",         specialties: ["Millet","Sorghum","Groundnut"],     clients: 72,  monthlyVolume: 8400000,  commissionRate: 0.45, rating: 4.1, status: "ACTIVE",    licenseNo: "NCX-BRK-006", licenseExpiry: "2027-06-30", joinedDate: "2022-04-20", completedTrades: 3840 },
  { id: "BRK007", name: "Ngozi Obi",          firm: "Enugu Metals & Minerals",        city: "Enugu",     country: "Nigeria", phone: "+234-805-678-9012", email: "n.obi@emm.ng",          website: "emm.ng",          specialties: ["Gold","Silver","Copper","Tin"],     clients: 156, monthlyVolume: 32400000, commissionRate: 0.28, rating: 4.7, status: "ACTIVE",    licenseNo: "NCX-BRK-007", licenseExpiry: "2027-12-31", joinedDate: "2021-07-10", completedTrades: 8640 },
  { id: "BRK008", name: "Tunde Fashola",      firm: "Kaduna Grain Brokers",           city: "Kaduna",    country: "Nigeria", phone: "+234-806-789-0123", email: "t.fashola@kgb.ng",      website: "kgb.ng",          specialties: ["Maize","Wheat","Sorghum"],          clients: 94,  monthlyVolume: 14200000, commissionRate: 0.38, rating: 4.2, status: "PROBATION", licenseNo: "NCX-BRK-008", licenseExpiry: "2026-09-30", joinedDate: "2022-08-15", completedTrades: 4280 },
  { id: "BRK009", name: "Blessing Nwosu",     firm: "Ibadan Agri Finance",            city: "Ibadan",    country: "Nigeria", phone: "+234-807-890-1234", email: "b.nwosu@iaf.ng",        website: "iaf.ng",          specialties: ["Cassava","Yam","Plantain"],         clients: 62,  monthlyVolume: 6800000,  commissionRate: 0.50, rating: 3.9, status: "PROBATION", licenseNo: "NCX-BRK-009", licenseExpiry: "2026-06-30", joinedDate: "2023-01-20", completedTrades: 2140 },
  { id: "BRK010", name: "Seun Adeleke",       firm: "Benin City Commodity Brokers",   city: "Benin",     country: "Nigeria", phone: "+234-808-901-2345", email: "s.adeleke@bccb.ng",     website: "bccb.ng",         specialties: ["Rubber","Palm Oil","Timber"],       clients: 48,  monthlyVolume: 4200000,  commissionRate: 0.55, rating: 3.6, status: "SUSPENDED", licenseNo: "NCX-BRK-010", licenseExpiry: "2026-03-31", joinedDate: "2023-04-10", completedTrades: 1240 },
];

const STATUS_CONFIG: Record<BrokerStatus, { label: string; className: string }> = {
  ACTIVE:    { label: "Active",    className: "badge-settled" },
  SUSPENDED: { label: "Suspended", className: "badge-cancelled" },
  PROBATION: { label: "Probation", className: "badge-pending" },
};

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`w-3 h-3 ${i <= Math.round(rating) ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground"}`} />
      ))}
      <span className="text-xs font-mono text-foreground ml-1">{rating.toFixed(1)}</span>
    </div>
  );
}

export default function Brokers() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  const [detail, setDetail] = useState<Broker | null>(null);

  const notifyOwner = trpc.system.notifyOwner.useMutation();

  // Real broker data from the broker router
  const { data: brokerData, isLoading: brokerLoading } = trpc.broker.adminListBrokerProfiles.useQuery(
    { limit: 100, offset: 0 },
    { retry: false }
  );

  // Map real broker profiles to the Broker interface, falling back to static data
  const liveBrokers = useMemo<Broker[]>(() => {
    if (!brokerData?.profiles || brokerData.profiles.length === 0) return BROKERS;
    return brokerData.profiles.map(p => ({
      id: String(p.id),
      name: p.firmName,
      firm: p.firmName,
      city: p.state ?? "Nigeria",
      country: "Nigeria",
      phone: p.contactPhone ?? "",
      email: p.contactEmail ?? "",
      website: "",
      specialties: p.regulatoryBody ? [p.regulatoryBody] : [],
      clients: 0,
      monthlyVolume: 0,
      commissionRate: Number(p.commissionRate ?? 0),
      rating: 4.0,
      status: (p.accountStatus === "ACTIVE" ? "ACTIVE" : p.accountStatus === "SUSPENDED" ? "SUSPENDED" : "PROBATION") as BrokerStatus,
      licenseNo: p.secLicenseNumber ?? "",
      licenseExpiry: "",
      joinedDate: p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : "",
      completedTrades: 0,
    }));
  }, [brokerData]);

  const filtered = liveBrokers.filter(b => {
    const q = search.toLowerCase();
    const matchSearch = !search || b.name.toLowerCase().includes(q) || b.firm.toLowerCase().includes(q) || b.city.toLowerCase().includes(q);
    const matchTab = tab === "all" || b.status.toLowerCase() === tab;
    return matchSearch && matchTab;
  });

  const totalVolume = liveBrokers.reduce((s, b) => s + b.monthlyVolume, 0);
  const totalClients = liveBrokers.reduce((s, b) => s + b.clients, 0);
  const avgRating = liveBrokers.length > 0 ? liveBrokers.reduce((s, b) => s + b.rating, 0) / liveBrokers.length : 0;

  if (brokerLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
  return (
    <div className="page-container space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2" style={{ fontFamily: "'DM Serif Display', serif" }}>
            <Briefcase className="w-6 h-6 text-primary" />
            Registered Brokers
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Licensed commodity brokers and intermediaries on NEXCOM Exchange</p>
        </div>
        <Button size="sm" className="bg-primary hover:bg-primary/90 text-white" onClick={() => navigate("/onboarding/broker")}>
          Register as Broker
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Brokers",   value: liveBrokers.length,                          icon: Briefcase },
          { label: "Active",          value: liveBrokers.filter(b => b.status === "ACTIVE").length, icon: CheckCircle2 },
          { label: "Monthly Volume",  value: `$${(totalVolume / 1e6).toFixed(0)}M`,   icon: TrendingUp },
          { label: "Total Clients",   value: totalClients.toLocaleString(),            icon: Users },
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

      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="all">All ({liveBrokers.length})</TabsTrigger>
            <TabsTrigger value="active">Active ({liveBrokers.filter(b => b.status === "ACTIVE").length})</TabsTrigger>
            <TabsTrigger value="probation">Probation ({liveBrokers.filter(b => b.status === "PROBATION").length})</TabsTrigger>
            <TabsTrigger value="suspended">Suspended ({liveBrokers.filter(b => b.status === "SUSPENDED").length})</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:w-56">
          <Input placeholder="Search brokers..." value={search} onChange={e => setSearch(e.target.value)} className="h-9 pl-3" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(b => {
          const sc = STATUS_CONFIG[b.status];
          return (
            <div key={b.id} className="stat-card hover:border-primary/30 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-semibold text-foreground">{b.name}</div>
                  <div className="text-xs text-muted-foreground">{b.firm}</div>
                  <div className="text-xs text-muted-foreground">{b.city}, {b.country}</div>
                </div>
                <Badge className={"text-[10px] " + sc.className}>{sc.label}</Badge>
              </div>
              <div className="mb-3">
                <StarRating rating={b.rating} />
              </div>
              <div className="flex flex-wrap gap-1 mb-3">
                {b.specialties.map(s => (
                  <span key={s} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">{s}</span>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                <div className="bg-secondary/50 rounded p-2 text-center">
                  <div className="text-muted-foreground">Clients</div>
                  <div className="font-mono font-semibold text-foreground">{b.clients}</div>
                </div>
                <div className="bg-secondary/50 rounded p-2 text-center">
                  <div className="text-muted-foreground">Vol/Mo</div>
                  <div className="font-mono font-semibold text-foreground">${(b.monthlyVolume / 1e6).toFixed(1)}M</div>
                </div>
                <div className="bg-secondary/50 rounded p-2 text-center">
                  <div className="text-muted-foreground">Comm.</div>
                  <div className="font-mono font-semibold text-foreground">{b.commissionRate}%</div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1 h-8 text-xs" variant="outline" onClick={() => setDetail(b)}>View Profile</Button>
                <Button size="sm" className="flex-1 h-8 text-xs bg-primary hover:bg-primary/90 text-white" onClick={() => { notifyOwner.mutate({ title: `Broker Contact Request`, content: `A user wants to contact broker: ${b.name} (${b.firm})` }); toast.success(`Contact request sent to ${b.name}`); }}>Contact</Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!detail} onOpenChange={() => setDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{detail?.name}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-foreground">{detail.firm}</div>
                  <div className="text-xs text-muted-foreground">{detail.city}, {detail.country}</div>
                </div>
                <Badge className={"text-xs " + STATUS_CONFIG[detail.status].className}>{STATUS_CONFIG[detail.status].label}</Badge>
              </div>
              <StarRating rating={detail.rating} />
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "License No.",   value: detail.licenseNo },
                  { label: "License Expiry",value: detail.licenseExpiry },
                  { label: "Joined",        value: detail.joinedDate },
                  { label: "Commission",    value: `${detail.commissionRate}%` },
                  { label: "Total Clients", value: detail.clients },
                  { label: "Monthly Vol.",  value: `$${(detail.monthlyVolume / 1e6).toFixed(1)}M` },
                  { label: "Completed Trades", value: detail.completedTrades.toLocaleString() },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-secondary/50 rounded-lg p-2">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="font-semibold text-foreground mt-0.5">{value}</div>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-2">Specialties</div>
                <div className="flex flex-wrap gap-1">
                  {detail.specialties.map(s => (
                    <span key={s} className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">{s}</span>
                  ))}
                </div>
              </div>
              <div className="space-y-2 border-t border-border pt-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Phone className="w-3.5 h-3.5" /><span>{detail.phone}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Mail className="w-3.5 h-3.5" /><span>{detail.email}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Globe className="w-3.5 h-3.5" /><span>{detail.website}</span>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
