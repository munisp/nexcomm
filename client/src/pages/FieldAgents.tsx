import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Users, MapPin, Trophy, Calendar, Star, Plus, Award, CheckCircle2 } from "lucide-react";

const STATES = ["Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT","Gombe","Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara"];

const VISIT_TYPES = [
  { value: "ONBOARDING" as const, label: "Farmer Onboarding" },
  { value: "CROP_INSPECTION" as const, label: "Crop Inspection" },
  { value: "LOAN_ASSESSMENT" as const, label: "Loan Assessment" },
  { value: "HARVEST_VERIFICATION" as const, label: "Harvest Verification" },
  { value: "REPAYMENT_COLLECTION" as const, label: "Repayment Collection" },
  { value: "FOLLOW_UP" as const, label: "Follow Up" },
];

export default function FieldAgents() {
  const [registerOpen, setRegisterOpen] = useState(false);
  const [visitOpen, setVisitOpen] = useState(false);
  const [form, setForm] = useState({ fullName: "", phone: "", stateOfOperation: "", lgaOfOperation: "" });
  const [visitForm, setVisitForm] = useState({ farmerId: "", visitType: "CROP_INSPECTION" as const, scheduledAt: "" });

  const { data: stats } = trpc.fieldAgent.networkStats.useQuery();
  const { data: leaderboard = [] } = trpc.fieldAgent.leaderboard.useQuery();
  const { data: myProfile } = trpc.fieldAgent.myProfile.useQuery();
  const { data: myVisits = [] } = trpc.fieldAgent.myVisits.useQuery();

  const registerMutation = trpc.fieldAgent.register.useMutation({
    onSuccess: () => { toast.success("Agent registration submitted for review"); setRegisterOpen(false); },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const scheduleMutation = trpc.fieldAgent.scheduleVisit.useMutation({
    onSuccess: () => { toast.success("Visit scheduled successfully"); setVisitOpen(false); },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-orange-500/20">
            <Users className="w-6 h-6 text-orange-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Field Agent Network</h1>
            <p className="text-sm text-gray-400">NEXCOM Xpert Programme — Farmer onboarding &amp; last-mile support</p>
          </div>
        </div>
        <div className="flex gap-2">
          {myProfile ? (
            <Dialog open={visitOpen} onOpenChange={setVisitOpen}>
              <DialogTrigger asChild>
                <Button className="bg-orange-600 hover:bg-orange-700 text-white">
                  <Calendar className="w-4 h-4 mr-2" /> Schedule Visit
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[#111827] border-gray-700 text-white max-w-md">
                <DialogHeader><DialogTitle>Schedule Farm Visit</DialogTitle></DialogHeader>
                <div className="space-y-4 mt-2">
                  <div>
                    <Label>Farmer ID *</Label>
                    <Input value={visitForm.farmerId} onChange={e => setVisitForm(f => ({ ...f, farmerId: e.target.value }))}
                      className="bg-[#0a0e1a] border-gray-600 text-white mt-1" placeholder="Farmer user ID" />
                  </div>
                  <div>
                    <Label>Visit Type *</Label>
                    <Select value={visitForm.visitType} onValueChange={v => setVisitForm(f => ({ ...f, visitType: v as typeof f.visitType }))}>
                      <SelectTrigger className="bg-[#0a0e1a] border-gray-600 text-white mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-[#111827] border-gray-700 text-white">
                        {VISIT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Scheduled Date &amp; Time *</Label>
                    <Input type="datetime-local" value={visitForm.scheduledAt} onChange={e => setVisitForm(f => ({ ...f, scheduledAt: e.target.value }))}
                      className="bg-[#0a0e1a] border-gray-600 text-white mt-1" />
                  </div>
                  <Button className="w-full bg-orange-600 hover:bg-orange-700"
                    disabled={scheduleMutation.isPending || !visitForm.farmerId || !visitForm.scheduledAt}
                    onClick={() => scheduleMutation.mutate({ farmerId: parseInt(visitForm.farmerId), visitType: visitForm.visitType, scheduledAt: visitForm.scheduledAt })}>
                    {scheduleMutation.isPending ? "Scheduling…" : "Schedule Visit"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          ) : (
            <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
              <DialogTrigger asChild>
                <Button className="bg-orange-600 hover:bg-orange-700 text-white">
                  <Plus className="w-4 h-4 mr-2" /> Become an Xpert
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[#111827] border-gray-700 text-white max-w-md">
                <DialogHeader><DialogTitle>Register as NEXCOM Xpert</DialogTitle></DialogHeader>
                <div className="space-y-4 mt-2">
                  <div>
                    <Label>Full Name *</Label>
                    <Input value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
                      className="bg-[#0a0e1a] border-gray-600 text-white mt-1" />
                  </div>
                  <div>
                    <Label>Phone Number *</Label>
                    <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      className="bg-[#0a0e1a] border-gray-600 text-white mt-1" placeholder="+234 800 000 0000" />
                  </div>
                  <div>
                    <Label>State of Operation *</Label>
                    <Select value={form.stateOfOperation} onValueChange={v => setForm(f => ({ ...f, stateOfOperation: v }))}>
                      <SelectTrigger className="bg-[#0a0e1a] border-gray-600 text-white mt-1"><SelectValue placeholder="Select state" /></SelectTrigger>
                      <SelectContent className="bg-[#111827] border-gray-700 text-white max-h-48 overflow-y-auto">
                        {STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>LGA</Label>
                    <Input value={form.lgaOfOperation} onChange={e => setForm(f => ({ ...f, lgaOfOperation: e.target.value }))}
                      className="bg-[#0a0e1a] border-gray-600 text-white mt-1" placeholder="Local Government Area" />
                  </div>
                  <Button className="w-full bg-orange-600 hover:bg-orange-700"
                    disabled={registerMutation.isPending || !form.fullName || !form.phone || !form.stateOfOperation}
                    onClick={() => registerMutation.mutate({ fullName: form.fullName, phone: form.phone, stateOfOperation: form.stateOfOperation, lgaOfOperation: form.lgaOfOperation || undefined })}>
                    {registerMutation.isPending ? "Submitting…" : "Submit Application"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Network Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        {[
          { label: "Total Agents", value: (stats?.totalAgents ?? 847).toLocaleString(), icon: Users, color: "text-orange-400" },
          { label: "Active Agents", value: (stats?.activeAgents ?? 612).toLocaleString(), icon: CheckCircle2, color: "text-green-400" },
          { label: "States Covered", value: stats?.statesCovered ?? 18, icon: MapPin, color: "text-blue-400" },
          { label: "Farmers Onboarded", value: (stats?.totalFarmersOnboarded ?? 94200).toLocaleString(), icon: Users, color: "text-purple-400" },
          { label: "Visits Completed", value: (stats?.totalVisitsCompleted ?? 284750).toLocaleString(), icon: Calendar, color: "text-cyan-400" },
          { label: "Avg Farmers/Agent", value: stats?.avgFarmersPerAgent ?? 154, icon: Award, color: "text-amber-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-[#111827] border-gray-700/50">
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className={`w-7 h-7 ${color}`} />
              <div>
                <p className="text-xs text-gray-400">{label}</p>
                <p className="text-xl font-bold text-white">{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Leaderboard */}
        <Card className="bg-[#111827] border-gray-700/50">
          <CardHeader>
            <CardTitle className="text-white text-base flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-400" /> Top Xperts — Q2 2025
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {leaderboard.map((agent: { rank: number; agentCode: string; name: string; state: string; farmersOnboarded: number; loansOriginated: number; commissionNgn: number }) => (
              <div key={agent.agentCode} className="flex items-center gap-3 bg-[#0a0e1a] rounded-lg p-3 border border-gray-700/30">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  agent.rank === 1 ? "bg-amber-500/20 text-amber-400" :
                  agent.rank === 2 ? "bg-gray-400/20 text-gray-300" :
                  agent.rank === 3 ? "bg-orange-600/20 text-orange-400" :
                  "bg-gray-700/20 text-gray-400"
                }`}>#{agent.rank}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white text-sm truncate">{agent.name}</p>
                  <p className="text-xs text-gray-400">{agent.agentCode} · {agent.state}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-green-400">₦{(agent.commissionNgn / 1e6).toFixed(2)}M</p>
                  <p className="text-xs text-gray-400">{agent.farmersOnboarded} farmers</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* My Profile / Programme Benefits */}
        <Card className="bg-[#111827] border-gray-700/50">
          <CardHeader>
            <CardTitle className="text-white text-base flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-400" />
              {myProfile ? "My Recent Visits" : "Xpert Programme Benefits"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {myProfile ? (
              <div className="space-y-3">
                <div className="bg-[#0a0e1a] rounded-lg p-3 border border-orange-500/20 mb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-orange-400 border-orange-500/30 text-xs">{myProfile.agentCode}</Badge>
                    <Badge variant="outline" className={`text-xs ${myProfile.status === "ACTIVE" ? "text-green-400 border-green-500/30" : "text-amber-400 border-amber-500/30"}`}>{myProfile.status}</Badge>
                  </div>
                  <p className="text-sm text-gray-300">{myProfile.stateOfOperation}{myProfile.lgaOfOperation ? ` · ${myProfile.lgaOfOperation}` : ""}</p>
                </div>
                {myVisits.slice(0, 4).map((visit: { id: number; visitType: string; status: string; scheduledAt: Date; farmerId: number }) => (
                  <div key={visit.id} className="flex items-center justify-between bg-[#0a0e1a] rounded-lg p-3 border border-gray-700/30">
                    <div>
                      <p className="text-sm font-medium text-white">{visit.visitType.replace(/_/g, " ")}</p>
                      <p className="text-xs text-gray-400">Farmer #{visit.farmerId} · {new Date(visit.scheduledAt).toLocaleDateString()}</p>
                    </div>
                    <Badge variant="outline" className={`text-xs ${visit.status === "COMPLETED" ? "text-green-400 border-green-500/30" : "text-amber-400 border-amber-500/30"}`}>
                      {visit.status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {[
                  { icon: "💰", title: "Commission Income", desc: "Earn ₦2,000–₦8,000 per loan originated" },
                  { icon: "📱", title: "Mobile App Access", desc: "Full NEXCOM Xpert mobile app with GPS tools" },
                  { icon: "🎓", title: "Free Training", desc: "Agronomy, finance, and compliance certification" },
                  { icon: "🏆", title: "Performance Bonuses", desc: "Quarterly bonuses for top-performing agents" },
                  { icon: "📊", title: "Portfolio Dashboard", desc: "Real-time view of all your farmers and loans" },
                  { icon: "🌍", title: "Coverage in 18 States", desc: "Join Nigeria's largest agri-agent network" },
                ].map(b => (
                  <div key={b.title} className="flex items-start gap-3 bg-[#0a0e1a] rounded-lg p-3 border border-gray-700/30">
                    <span className="text-xl">{b.icon}</span>
                    <div>
                      <p className="text-sm font-medium text-white">{b.title}</p>
                      <p className="text-xs text-gray-400">{b.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
