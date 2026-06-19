/**
 * FarmerFarms — Farm management screen
 * Farmers can add, edit, and delete farms with location, size, and soil type.
 */
import { useState, useEffect } from "react";
import OSMMap from "@/components/OSMMap";
import NigeriaChoropleth from "@/components/NigeriaChoropleth";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  MapPin,
  Plus,
  ChevronLeft,
  Sprout,
  Ruler,
  X,
  CheckCircle2,
  Wheat,
  BarChart3,
  User,
  Pencil,
  Trash2,
  Globe,
  Layers,
  TrendingUp,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { PageSkeleton } from "@/components/PageSkeleton";

const SOIL_TYPES = ["LOAMY", "CLAY", "SANDY", "SILT", "PEAT", "CHALK", "OTHER"] as const;
type SoilType = typeof SOIL_TYPES[number];

interface FarmFormState {
  farmName: string;
  state: string;
  lga: string;
  description: string;
  sizeHectares: string;
  soilType: SoilType;
  latitude: string;
  longitude: string;
}

const EMPTY_FORM: FarmFormState = {
  farmName: "",
  state: "",
  lga: "",
  description: "",
  sizeHectares: "",
  soilType: "LOAMY",
  latitude: "",
  longitude: "",
};

export default function FarmerFarms() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  // Add form state
  const [showForm, setShowForm] = useState(false);
  const [addForm, setAddForm] = useState<FarmFormState>(EMPTY_FORM);

  // Edit dialog state
  const [editFarm, setEditFarm] = useState<{ id: number } & FarmFormState | null>(null);

  // Delete confirmation state
  const [deleteFarmId, setDeleteFarmId] = useState<number | null>(null);

  const farmsQ = trpc.farmer.getMyFarms.useQuery();

  const addFarmMut = trpc.farmer.addFarm.useMutation({
    onSuccess: () => {
      toast.success("Farm added successfully!");
      utils.farmer.getMyFarms.invalidate();
      setShowForm(false);
      setAddForm(EMPTY_FORM);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateFarmMut = trpc.farmer.updateFarm.useMutation({
    onSuccess: () => {
      toast.success("Farm updated!");
      utils.farmer.getMyFarms.invalidate();
      setEditFarm(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteFarmMut = trpc.farmer.deleteFarm.useMutation({
    onSuccess: () => {
      toast.success("Farm removed.");
      utils.farmer.getMyFarms.invalidate();
      setDeleteFarmId(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const farms = farmsQ.data ?? [];

  // ── Sedona Spatial Analytics ─────────────────────────────────────────────
  const [spatialTab, setSpatialTab] = useState<"heatmap" | "clusters" | "nearby">("heatmap");
  const [spatialLoading, setSpatialLoading] = useState(false);
  const [heatmapData, setHeatmapData] = useState<Array<{ state: string; farmCount: number; totalHectares: number; avgSize: number }>>([]);
  const [clusterData, setClusterData] = useState<Array<{ clusterId: number; centerLat: number; centerLng: number; farmCount: number; totalHectares: number }>>([]);
  const [nearbyFarms, setNearbyFarms] = useState<Array<{ farmId: number; farmName: string; ownerName: string; distanceKm: number; state: string; sizeHectares: number }>>([]);
  const [spatialError, setSpatialError] = useState<string | null>(null);

  async function fetchSpatialData(tab: typeof spatialTab) {
    setSpatialLoading(true);
    setSpatialError(null);
    try {
      if (tab === "heatmap") {
        const res = await fetch("/api/spatial/state-heatmap");
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json() as { states?: typeof heatmapData; degraded?: boolean };
        if (json.degraded) { setSpatialError("Spatial service offline — showing cached data"); return; }
        setHeatmapData(json.states ?? []);
      } else if (tab === "clusters") {
        const res = await fetch("/api/spatial/farm-clusters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ numClusters: 8 }),
        });
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json() as { clusters?: typeof clusterData; degraded?: boolean };
        if (json.degraded) { setSpatialError("Spatial service offline"); return; }
        setClusterData(json.clusters ?? []);
      } else if (tab === "nearby") {
        // Use the first farm's coordinates as the reference point
        const ref = farms.find(f => f.latitude && f.longitude);
        if (!ref) { setSpatialError("Add a farm with GPS coordinates to find nearby farms"); setSpatialLoading(false); return; }
        const res = await fetch("/api/spatial/nearby-farms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: parseFloat(String(ref.latitude)), lng: parseFloat(String(ref.longitude)), radiusKm: 50, limit: 10 }),
        });
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json() as { farms?: typeof nearbyFarms; degraded?: boolean };
        if (json.degraded) { setSpatialError("Spatial service offline"); return; }
        setNearbyFarms(json.farms ?? []);
      }
    } catch (err) {
      setSpatialError((err as Error).message.includes("503") ? "Spatial analytics service is starting up" : (err as Error).message);
    } finally {
      setSpatialLoading(false);
    }
  }

  useEffect(() => {
    fetchSpatialData(spatialTab);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spatialTab]);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm.farmName || !addForm.state || !addForm.lga || !addForm.sizeHectares) {
      toast.error("Please fill in all required fields");
      return;
    }
    addFarmMut.mutate({
      farmName: addForm.farmName,
      state: addForm.state,
      lga: addForm.lga,
      description: addForm.description || undefined,
      sizeHectares: parseFloat(addForm.sizeHectares),
      soilType: addForm.soilType,
      latitude: addForm.latitude ? parseFloat(addForm.latitude) : undefined,
      longitude: addForm.longitude ? parseFloat(addForm.longitude) : undefined,
    });
  }

  function openEdit(farm: typeof farms[number]) {
    setEditFarm({
      id: farm.id,
      farmName: farm.farmName,
      state: farm.state,
      lga: farm.lga,
      description: farm.description ?? "",
      sizeHectares: String(parseFloat(farm.sizeHectares)),
      soilType: farm.soilType as SoilType,
      latitude: farm.latitude ? String(farm.latitude) : "",
      longitude: farm.longitude ? String(farm.longitude) : "",
    });
  }

  function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editFarm) return;
    updateFarmMut.mutate({
      farmId: editFarm.id,
      farmName: editFarm.farmName,
      state: editFarm.state,
      lga: editFarm.lga,
      description: editFarm.description || undefined,
      sizeHectares: parseFloat(editFarm.sizeHectares),
      soilType: editFarm.soilType,
      latitude: editFarm.latitude ? parseFloat(editFarm.latitude) : undefined,
      longitude: editFarm.longitude ? parseFloat(editFarm.longitude) : undefined,
    });
  }

  if (farmsQ.isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
  return (
    <div className="min-h-screen bg-gradient-to-b from-green-950 to-slate-950 flex flex-col max-w-md mx-auto">
      {/* Header */}
      <div className="p-4 flex items-center gap-3 border-b border-border">
        <button onClick={() => navigate("/farmer-dashboard")} className="text-muted-foreground hover:text-white">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h2 className="text-white font-semibold">My Farms</h2>
          <p className="text-muted-foreground text-xs">{farms.length} farm{farms.length !== 1 ? "s" : ""} registered</p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowForm(!showForm)}
          className="bg-green-600 hover:bg-green-700 text-white h-8 text-xs"
        >
          {showForm ? <X className="w-3.5 h-3.5" /> : <><Plus className="w-3.5 h-3.5 mr-1" />Add Farm</>}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-24">
        {/* Add Farm Form */}
        {showForm && (
          <Card className="bg-secondary border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-white text-sm">New Farm Details</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAdd} className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs">Farm Name *</Label>
                  <Input
                    placeholder="e.g. Musa's Maize Farm"
                    value={addForm.farmName}
                    onChange={(e) => setAddForm((f) => ({ ...f, farmName: e.target.value }))}
                    className="bg-muted border-border text-white h-9 text-sm"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">State *</Label>
                    <Input
                      placeholder="e.g. Kano"
                      value={addForm.state}
                      onChange={(e) => setAddForm((f) => ({ ...f, state: e.target.value }))}
                      className="bg-muted border-border text-white h-9 text-sm"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">LGA *</Label>
                    <Input
                      placeholder="e.g. Kano Municipal"
                      value={addForm.lga}
                      onChange={(e) => setAddForm((f) => ({ ...f, lga: e.target.value }))}
                      className="bg-muted border-border text-white h-9 text-sm"
                      required
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">Size (hectares) *</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min="0.1"
                      placeholder="e.g. 5.5"
                      value={addForm.sizeHectares}
                      onChange={(e) => setAddForm((f) => ({ ...f, sizeHectares: e.target.value }))}
                      className="bg-muted border-border text-white h-9 text-sm"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">Soil Type</Label>
                    <select
                      value={addForm.soilType}
                      onChange={(e) => setAddForm((f) => ({ ...f, soilType: e.target.value as SoilType }))}
                      className="w-full h-9 bg-muted border border-border text-white rounded-md px-2 text-sm"
                    >
                      {SOIL_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs">Description (optional)</Label>
                  <Input
                    placeholder="e.g. Along Hadejia Road, irrigated"
                    value={addForm.description}
                    onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
                    className="bg-muted border-border text-white h-9 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">Latitude (optional)</Label>
                    <Input
                      type="number"
                      step="0.000001"
                      placeholder="e.g. 11.9964"
                      value={addForm.latitude}
                      onChange={(e) => setAddForm((f) => ({ ...f, latitude: e.target.value }))}
                      className="bg-muted border-border text-white h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">Longitude (optional)</Label>
                    <Input
                      type="number"
                      step="0.000001"
                      placeholder="e.g. 8.5167"
                      value={addForm.longitude}
                      onChange={(e) => setAddForm((f) => ({ ...f, longitude: e.target.value }))}
                      className="bg-muted border-border text-white h-9 text-sm"
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  disabled={addFarmMut.isPending}
                  className="w-full h-10 bg-green-600 hover:bg-green-700 text-white text-sm"
                >
                  {addFarmMut.isPending ? "Saving..." : "Save Farm"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Farm List */}
        {farmsQ.isLoading ? (
          <div className="text-center py-8">
            <Sprout className="w-8 h-8 text-green-400 animate-pulse mx-auto" />
          </div>
        ) : farms.length === 0 && !showForm ? (
          <Card className="bg-secondary/50 border-border border-dashed">
            <CardContent className="p-8 text-center">
              <MapPin className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-white font-medium mb-1">No farms added yet</p>
              <p className="text-muted-foreground text-sm mb-4">Add your first farm to start listing crops</p>
              <Button
                onClick={() => setShowForm(true)}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add First Farm
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {farms.map((farm) => (
              <Card key={farm.id} className="bg-secondary border-border">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold truncate">{farm.farmName}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                        <p className="text-muted-foreground text-xs truncate">{farm.lga}, {farm.state}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 ml-2">
                      <Badge className="bg-green-900/60 text-green-300 border-green-700 text-xs">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Active
                      </Badge>
                      <button
                        onClick={() => openEdit(farm)}
                        className="text-muted-foreground hover:text-white transition-colors p-1 rounded"
                        title="Edit farm"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteFarmId(farm.id)}
                        className="text-muted-foreground hover:text-red-400 transition-colors p-1 rounded"
                        title="Delete farm"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-muted/50 rounded-lg p-2 text-center">
                      <Ruler className="w-3.5 h-3.5 text-blue-400 mx-auto mb-0.5" />
                      <p className="text-white text-xs font-semibold">{parseFloat(farm.sizeHectares).toFixed(1)} ha</p>
                      <p className="text-muted-foreground text-xs">Size</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-2 text-center">
                      <Sprout className="w-3.5 h-3.5 text-green-400 mx-auto mb-0.5" />
                      <p className="text-white text-xs font-semibold">{farm.soilType}</p>
                      <p className="text-muted-foreground text-xs">Soil</p>
                    </div>
                  </div>
                  {farm.description && (
                    <p className="text-muted-foreground text-xs mt-2">{farm.description}</p>
                  )}
                  {farm.latitude && farm.longitude && (
                    <div className="mt-3 space-y-1">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="w-3 h-3 text-green-400" />
                        <span className="font-mono text-green-400">
                          {Number(farm.latitude).toFixed(5)}, {Number(farm.longitude).toFixed(5)}
                        </span>
                      </div>
                      <OSMMap
                        initialPin={{ lat: Number(farm.latitude), lng: Number(farm.longitude) }}
                        readonly={true}
                        height="180px"
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {farms.length > 0 && (
          <Button
            onClick={() => navigate("/farmer-crops")}
            className="w-full h-11 bg-green-600 hover:bg-green-700 text-white font-semibold"
          >
            Continue to Crop Listings →
          </Button>
        )}

        {/* ── Sedona Spatial Analytics Panel ───────────────────────────────── */}
        <Card className="bg-secondary border-border">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-green-400 flex items-center gap-2">
                <Globe className="w-4 h-4" />
                Spatial Analytics
              </CardTitle>
              <button
                onClick={() => fetchSpatialData(spatialTab)}
                disabled={spatialLoading}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-white transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${spatialLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
            {/* Tab switcher */}
            <div className="flex gap-1 pt-1">
              {(["heatmap", "clusters", "nearby"] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setSpatialTab(tab)}
                  className={`flex-1 py-1 text-xs rounded transition-colors capitalize ${
                    spatialTab === tab
                      ? "bg-green-700 text-white"
                      : "bg-muted text-muted-foreground hover:text-white"
                  }`}
                >
                  {tab === "heatmap" ? "State Heatmap" : tab === "clusters" ? "Farm Clusters" : "Nearby Farms"}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {spatialError ? (
              <div className="flex items-center gap-2 py-4 text-yellow-400 text-xs">
                <Layers className="w-4 h-4 flex-shrink-0" />
                <span>{spatialError}</span>
              </div>
            ) : spatialLoading ? (
              <div className="flex items-center justify-center py-6">
                <RefreshCw className="w-5 h-5 text-green-400 animate-spin" />
              </div>
            ) : spatialTab === "heatmap" ? (
              <div>
                {heatmapData.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-3 text-center">No farm data available — add farms to see the map</p>
                ) : (
                  <NigeriaChoropleth data={heatmapData} height={240} />
                )}
              </div>
            ) : spatialTab === "clusters" ? (
              <div className="space-y-2">
                {clusterData.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-3 text-center">No cluster data available</p>
                ) : (
                  clusterData.map(cluster => (
                    <div key={cluster.clusterId} className="flex items-center justify-between bg-muted/50 rounded px-2.5 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-green-600 flex items-center justify-center text-xs text-white font-bold">{cluster.clusterId}</span>
                        <div>
                          <p className="text-xs text-white font-mono">{cluster.centerLat.toFixed(2)}°N, {cluster.centerLng.toFixed(2)}°E</p>
                          <p className="text-xs text-muted-foreground">{cluster.farmCount} farms · {cluster.totalHectares.toFixed(0)} ha</p>
                        </div>
                      </div>
                      <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {nearbyFarms.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-3 text-center">No nearby farms found within 50 km</p>
                ) : (
                  nearbyFarms.map(farm => (
                    <div key={farm.farmId} className="flex items-center justify-between bg-muted/50 rounded px-2.5 py-1.5">
                      <div>
                        <p className="text-xs text-white font-semibold">{farm.farmName}</p>
                        <p className="text-xs text-muted-foreground">{farm.ownerName} · {farm.state}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-green-400 font-mono">{farm.distanceKm.toFixed(1)} km</p>
                        <p className="text-xs text-muted-foreground">{farm.sizeHectares} ha</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom Nav */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-card border-t border-border flex">
        {[
          { icon: Sprout, label: "Home", path: "/farmer-dashboard" },
          { icon: MapPin, label: "Farms", path: "/farmer-farms", active: true },
          { icon: Wheat, label: "Crops", path: "/farmer-crops" },
          { icon: BarChart3, label: "Prices", path: "/farmer-market" },
          { icon: User, label: "Profile", path: "/farmer-kyc" },
        ].map(({ icon: Icon, label, path, active }) => (
          <button
            key={label}
            onClick={() => navigate(path)}
            className={`flex-1 py-3 flex flex-col items-center gap-1 text-xs transition-colors ${
              active ? "text-green-400" : "text-muted-foreground hover:text-white"
            }`}
          >
            <Icon className="w-5 h-5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Edit Farm Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={!!editFarm} onOpenChange={(v) => { if (!v) setEditFarm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Farm</DialogTitle>
          </DialogHeader>
          {editFarm && (
            <form onSubmit={handleEdit} className="space-y-3 py-1">
              <div className="space-y-1.5">
                <Label className="text-xs">Farm Name *</Label>
                <Input
                  value={editFarm.farmName}
                  onChange={(e) => setEditFarm((f) => f ? { ...f, farmName: e.target.value } : f)}
                  className="h-9 text-sm"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">State *</Label>
                  <Input
                    value={editFarm.state}
                    onChange={(e) => setEditFarm((f) => f ? { ...f, state: e.target.value } : f)}
                    className="h-9 text-sm"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">LGA *</Label>
                  <Input
                    value={editFarm.lga}
                    onChange={(e) => setEditFarm((f) => f ? { ...f, lga: e.target.value } : f)}
                    className="h-9 text-sm"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Size (ha) *</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={editFarm.sizeHectares}
                    onChange={(e) => setEditFarm((f) => f ? { ...f, sizeHectares: e.target.value } : f)}
                    className="h-9 text-sm"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Soil Type</Label>
                  <select
                    value={editFarm.soilType}
                    onChange={(e) => setEditFarm((f) => f ? { ...f, soilType: e.target.value as SoilType } : f)}
                    className="w-full h-9 border border-input bg-background text-foreground rounded-md px-2 text-sm"
                  >
                    {SOIL_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Description (optional)</Label>
                <Input
                  value={editFarm.description}
                  onChange={(e) => setEditFarm((f) => f ? { ...f, description: e.target.value } : f)}
                  className="h-9 text-sm"
                  placeholder="e.g. Along Hadejia Road, irrigated"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Latitude (optional)</Label>
                  <Input
                    type="number"
                    step="0.000001"
                    placeholder="e.g. 11.9964"
                    value={editFarm?.latitude ?? ""}
                    onChange={(e) => setEditFarm((f) => f ? { ...f, latitude: e.target.value } : f)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Longitude (optional)</Label>
                  <Input
                    type="number"
                    step="0.000001"
                    placeholder="e.g. 8.5167"
                    value={editFarm?.longitude ?? ""}
                    onChange={(e) => setEditFarm((f) => f ? { ...f, longitude: e.target.value } : f)}
                    className="h-9 text-sm"
                  />
                </div>
              </div>
              <DialogFooter className="gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => setEditFarm(null)} className="flex-1">
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateFarmMut.isPending}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                >
                  {updateFarmMut.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ──────────────────────────────────────────────── */}
      <AlertDialog open={deleteFarmId !== null} onOpenChange={(v) => { if (!v) setDeleteFarmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Farm?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the farm record. Farms with active crop listings cannot be deleted — withdraw those listings first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => {
                if (deleteFarmId !== null) deleteFarmMut.mutate({ farmId: deleteFarmId });
              }}
              disabled={deleteFarmMut.isPending}
            >
              {deleteFarmMut.isPending ? "Removing..." : "Remove Farm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
