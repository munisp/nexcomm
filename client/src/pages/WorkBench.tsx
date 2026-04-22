import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { MapPin, Sprout, FlaskConical, TrendingUp, Plus, Leaf, BarChart3, Calendar, Wheat } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { PageSkeleton } from "@/components/PageSkeleton";

const CROP_OPTIONS = [
  { symbol: "MAIZE", name: "Maize" }, { symbol: "SOYBEAN", name: "Soybean" },
  { symbol: "SORGHUM", name: "Sorghum" }, { symbol: "GINGER", name: "Ginger" },
  { symbol: "COCOA", name: "Cocoa" }, { symbol: "SESAME", name: "Sesame" },
  { symbol: "GROUNDNUT", name: "Groundnut" }, { symbol: "CASSAVA", name: "Cassava" },
];

const YIELD_FORECAST = [
  { month: "Apr", expected: 0, actual: 0 }, { month: "May", expected: 0, actual: 0 },
  { month: "Jun", expected: 15, actual: 12 }, { month: "Jul", expected: 35, actual: 31 },
  { month: "Aug", expected: 60, actual: 58 }, { month: "Sep", expected: 90, actual: 0 },
];

const CROP_MIX = [
  { name: "Maize", value: 45, color: "#f59e0b" },
  { name: "Soybean", value: 30, color: "#10b981" },
  { name: "Sorghum", value: 15, color: "#8b5cf6" },
  { name: "Other", value: 10, color: "#6b7280" },
];

export default function WorkBench() {
  const [tab, setTab] = useState("farms");
  const [addFarmOpen, setAddFarmOpen] = useState(false);
  const [addPlanOpen, setAddPlanOpen] = useState(false);
  const [farmForm, setFarmForm] = useState({ farmName: "", locationState: "", locationLga: "", totalHectares: "", soilType: "", notes: "" });
  const [planForm, setPlanForm] = useState({ farmId: "", cropSymbol: "", season: "WET_SEASON" as const, plannedHectares: "", expectedYieldMt: "", inputCostNgn: "" });

  const { data: summary, isLoading: summaryLoading } = trpc.workbench.summary.useQuery();
  const { data: farms = [], refetch: refetchFarms } = trpc.workbench.listFarms.useQuery();
  const { data: plans = [], refetch: refetchPlans } = trpc.workbench.listCropPlans.useQuery({});

  const createFarm = trpc.workbench.createFarm.useMutation({
    onSuccess: () => { toast.success("Farm registered"); setAddFarmOpen(false); refetchFarms(); },
    onError: (e) => toast.error(e.message),
  });
  const createPlan = trpc.workbench.createCropPlan.useMutation({
    onSuccess: () => { toast.success("Crop plan created"); setAddPlanOpen(false); refetchPlans(); },
    onError: (e) => toast.error(e.message),
  });

  if (summaryLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-green-500/20">
            <Sprout className="w-6 h-6 text-green-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">WorkBench</h1>
            <p className="text-sm text-gray-400">Agri-SME farm management, crop planning & soil analytics</p>
          </div>
        </div>
        <Badge variant="outline" className="border-green-500/30 text-green-400 bg-green-500/10">
          Agri-SME SaaS
        </Badge>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Total Farms", value: summary?.totalFarms ?? 2, icon: MapPin, color: "text-green-400" },
          { label: "Total Hectares", value: `${summary?.totalHectares ?? 73.5} ha`, icon: Leaf, color: "text-emerald-400" },
          { label: "Active Crop Plans", value: summary?.activePlans ?? 2, icon: Sprout, color: "text-amber-400" },
          { label: "Expected Yield", value: `${summary?.totalExpectedYieldMt ?? 90} MT`, icon: Wheat, color: "text-orange-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-[#111827] border-gray-700/50">
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className={`w-8 h-8 ${color}`} />
              <div>
                <p className="text-xs text-gray-400">{label}</p>
                <p className="text-xl font-bold text-white">{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-[#111827] border border-gray-700/50 mb-6">
          <TabsTrigger value="farms">My Farms</TabsTrigger>
          <TabsTrigger value="plans">Crop Plans</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Farms */}
        <TabsContent value="farms">
          <div className="flex justify-end mb-4">
            <Dialog open={addFarmOpen} onOpenChange={setAddFarmOpen}>
              <DialogTrigger asChild>
                <Button className="bg-green-600 hover:bg-green-700 text-white">
                  <Plus className="w-4 h-4 mr-2" /> Register Farm
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[#111827] border-gray-700 text-white">
                <DialogHeader><DialogTitle>Register New Farm</DialogTitle></DialogHeader>
                <div className="space-y-3 mt-2">
                  <div><Label>Farm Name *</Label><Input value={farmForm.farmName} onChange={e => setFarmForm(f => ({ ...f, farmName: e.target.value }))} className="bg-[#0a0e1a] border-gray-600 text-white mt-1" placeholder="e.g. Kano North Farm" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>State</Label><Input value={farmForm.locationState} onChange={e => setFarmForm(f => ({ ...f, locationState: e.target.value }))} className="bg-[#0a0e1a] border-gray-600 text-white mt-1" placeholder="Kano" /></div>
                    <div><Label>LGA</Label><Input value={farmForm.locationLga} onChange={e => setFarmForm(f => ({ ...f, locationLga: e.target.value }))} className="bg-[#0a0e1a] border-gray-600 text-white mt-1" placeholder="Kumbotso" /></div>
                  </div>
                  <div><Label>Total Hectares</Label><Input type="number" value={farmForm.totalHectares} onChange={e => setFarmForm(f => ({ ...f, totalHectares: e.target.value }))} className="bg-[#0a0e1a] border-gray-600 text-white mt-1" placeholder="45.5" /></div>
                  <div><Label>Soil Type</Label><Input value={farmForm.soilType} onChange={e => setFarmForm(f => ({ ...f, soilType: e.target.value }))} className="bg-[#0a0e1a] border-gray-600 text-white mt-1" placeholder="Sandy Loam" /></div>
                  <div><Label>Notes</Label><Textarea value={farmForm.notes} onChange={e => setFarmForm(f => ({ ...f, notes: e.target.value }))} className="bg-[#0a0e1a] border-gray-600 text-white mt-1" rows={2} /></div>
                  <Button className="w-full bg-green-600 hover:bg-green-700" disabled={createFarm.isPending}
                    onClick={() => createFarm.mutate(farmForm)}>
                    {createFarm.isPending ? "Registering…" : "Register Farm"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {farms.map(farm => (
              <Card key={farm.id} className="bg-[#111827] border-gray-700/50 hover:border-green-500/30 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-bold text-white">{farm.farmName}</h3>
                      <div className="flex items-center gap-1 text-sm text-gray-400 mt-1">
                        <MapPin className="w-3 h-3" />
                        {farm.locationLga}, {farm.locationState}
                      </div>
                    </div>
                    <Badge variant="outline" className="border-green-500/30 text-green-400 bg-green-500/10 text-xs">
                      {farm.status}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-[#0a0e1a] rounded p-2">
                      <p className="text-xs text-gray-500">Area</p>
                      <p className="text-sm font-bold text-white">{farm.totalHectares} ha</p>
                    </div>
                    <div className="bg-[#0a0e1a] rounded p-2">
                      <p className="text-xs text-gray-500">Soil</p>
                      <p className="text-sm font-bold text-white">{farm.soilType ?? "—"}</p>
                    </div>
                    <div className="bg-[#0a0e1a] rounded p-2">
                      <p className="text-xs text-gray-500">Irrigation</p>
                      <p className="text-sm font-bold text-white truncate">{farm.irrigationType ?? "—"}</p>
                    </div>
                  </div>
                  {farm.notes && <p className="text-xs text-gray-500 mt-3 italic">{farm.notes}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Crop Plans */}
        <TabsContent value="plans">
          <div className="flex justify-end mb-4">
            <Dialog open={addPlanOpen} onOpenChange={setAddPlanOpen}>
              <DialogTrigger asChild>
                <Button className="bg-amber-600 hover:bg-amber-700 text-white">
                  <Plus className="w-4 h-4 mr-2" /> New Crop Plan
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[#111827] border-gray-700 text-white">
                <DialogHeader><DialogTitle>Create Crop Plan</DialogTitle></DialogHeader>
                <div className="space-y-3 mt-2">
                  <div>
                    <Label>Farm *</Label>
                    <Select value={planForm.farmId} onValueChange={v => setPlanForm(f => ({ ...f, farmId: v }))}>
                      <SelectTrigger className="bg-[#0a0e1a] border-gray-600 text-white mt-1">
                        <SelectValue placeholder="Select farm" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#111827] border-gray-700 text-white">
                        {farms.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.farmName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Crop *</Label>
                    <Select value={planForm.cropSymbol} onValueChange={v => setPlanForm(f => ({ ...f, cropSymbol: v }))}>
                      <SelectTrigger className="bg-[#0a0e1a] border-gray-600 text-white mt-1">
                        <SelectValue placeholder="Select crop" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#111827] border-gray-700 text-white">
                        {CROP_OPTIONS.map(c => <SelectItem key={c.symbol} value={c.symbol}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Season</Label>
                    <Select value={planForm.season} onValueChange={v => setPlanForm(f => ({ ...f, season: v as any }))}>
                      <SelectTrigger className="bg-[#0a0e1a] border-gray-600 text-white mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[#111827] border-gray-700 text-white">
                        <SelectItem value="WET_SEASON">Wet Season</SelectItem>
                        <SelectItem value="DRY_SEASON">Dry Season</SelectItem>
                        <SelectItem value="YEAR_ROUND">Year Round</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Planned Hectares</Label><Input type="number" value={planForm.plannedHectares} onChange={e => setPlanForm(f => ({ ...f, plannedHectares: e.target.value }))} className="bg-[#0a0e1a] border-gray-600 text-white mt-1" /></div>
                    <div><Label>Expected Yield (MT)</Label><Input type="number" value={planForm.expectedYieldMt} onChange={e => setPlanForm(f => ({ ...f, expectedYieldMt: e.target.value }))} className="bg-[#0a0e1a] border-gray-600 text-white mt-1" /></div>
                  </div>
                  <div><Label>Input Cost (₦)</Label><Input type="number" value={planForm.inputCostNgn} onChange={e => setPlanForm(f => ({ ...f, inputCostNgn: e.target.value }))} className="bg-[#0a0e1a] border-gray-600 text-white mt-1" /></div>
                  <Button className="w-full bg-amber-600 hover:bg-amber-700" disabled={createPlan.isPending || !planForm.farmId || !planForm.cropSymbol}
                    onClick={() => createPlan.mutate({ ...planForm, farmId: parseInt(planForm.farmId), cropName: CROP_OPTIONS.find(c => c.symbol === planForm.cropSymbol)?.name ?? planForm.cropSymbol })}>
                    {createPlan.isPending ? "Creating…" : "Create Plan"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {plans.map(plan => (
              <Card key={plan.id} className="bg-[#111827] border-gray-700/50 hover:border-amber-500/30 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-bold text-white">{plan.cropName}</h3>
                      <p className="text-xs text-gray-400 mt-1">{plan.season?.replace("_", " ")}</p>
                    </div>
                    <Badge variant="outline" className={plan.actualHarvestDate ? "border-gray-500/30 text-gray-400" : "border-amber-500/30 text-amber-400 bg-amber-500/10"}>
                      {plan.actualHarvestDate ? "Harvested" : "Active"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-[#0a0e1a] rounded p-2">
                      <p className="text-xs text-gray-500">Area</p>
                      <p className="text-sm font-bold text-white">{plan.plannedHectares} ha</p>
                    </div>
                    <div className="bg-[#0a0e1a] rounded p-2">
                      <p className="text-xs text-gray-500">Expected</p>
                      <p className="text-sm font-bold text-white">{plan.expectedYieldMt} MT</p>
                    </div>
                    <div className="bg-[#0a0e1a] rounded p-2">
                      <p className="text-xs text-gray-500">Input Cost</p>
                      <p className="text-sm font-bold text-white">₦{parseInt(plan.inputCostNgn ?? "0").toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Plant: {plan.plantingDate ? new Date(plan.plantingDate).toLocaleDateString() : "—"}</span>
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Harvest: {plan.expectedHarvestDate ? new Date(plan.expectedHarvestDate).toLocaleDateString() : "—"}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Analytics */}
        <TabsContent value="analytics">
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="bg-[#111827] border-gray-700/50">
              <CardHeader><CardTitle className="text-white text-sm">Yield Forecast vs Actual (MT)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={YIELD_FORECAST}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="month" stroke="#6b7280" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                    <YAxis stroke="#6b7280" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#111827", border: "1px solid #374151", color: "#fff" }} />
                    <Bar dataKey="expected" fill="#f59e0b" radius={[3, 3, 0, 0]} name="Expected" />
                    <Bar dataKey="actual" fill="#10b981" radius={[3, 3, 0, 0]} name="Actual" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="bg-[#111827] border-gray-700/50">
              <CardHeader><CardTitle className="text-white text-sm">Crop Portfolio Mix</CardTitle></CardHeader>
              <CardContent className="flex items-center justify-center">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={CROP_MIX} cx="50%" cy="50%" outerRadius={90} dataKey="value" label={({ name, value }) => `${name} ${value}%`}>
                      {CROP_MIX.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#111827", border: "1px solid #374151", color: "#fff" }} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
