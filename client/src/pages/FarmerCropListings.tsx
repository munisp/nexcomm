/**
 * FarmerCropListings — Crop listing management screen
 * Farmers create and manage crop listings with quantity, price, and harvest date
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Wheat,
  Plus,
  ChevronLeft,
  MapPin,
  Sprout,
  X,
  CheckCircle2,
  Clock,
  XCircle,
  BarChart3,
  User,
} from "lucide-react";
import { toast } from "sonner";

const CROP_TYPES = [
  "MAIZE", "SORGHUM", "MILLET", "RICE", "WHEAT", "COWPEA", "SOYBEAN",
  "GROUNDNUT", "SESAME", "GINGER", "PEPPER", "TOMATO", "CASSAVA", "YAM",
  "COCOA", "COTTON", "PALM_OIL", "CASHEW", "SHEA_BUTTER",
];

const STATUS_CONFIG: Record<string, { color: string; icon: typeof CheckCircle2; label: string }> = {
  ACTIVE: { color: "bg-green-900/60 text-green-300 border-green-700", icon: CheckCircle2, label: "Active" },
  SOLD: { color: "bg-blue-900/60 text-blue-300 border-blue-700", icon: CheckCircle2, label: "Sold" },
  EXPIRED: { color: "bg-slate-700 text-slate-400", icon: XCircle, label: "Expired" },
  WITHDRAWN: { color: "bg-red-900/60 text-red-300 border-red-700", icon: XCircle, label: "Withdrawn" },
};

export default function FarmerCropListings() {
  const [, navigate] = useLocation();
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<"ACTIVE" | "SOLD" | "EXPIRED" | "WITHDRAWN" | undefined>("ACTIVE");
  const [form, setForm] = useState({
    farmId: "",
    cropType: "MAIZE",
    variety: "",
    quantityKg: "",
    askingPricePerKg: "",
    expectedHarvestDate: "",
    description: "",
  });

  const farmsQ = trpc.farmer.getMyFarms.useQuery();
  const listingsQ = trpc.farmer.getMyCropListings.useQuery({ status: filterStatus });
  const createListingMut = trpc.farmer.createCropListing.useMutation({
    onSuccess: () => {
      toast.success("Crop listing created!");
      listingsQ.refetch();
      setShowForm(false);
      setForm({ farmId: "", cropType: "MAIZE", variety: "", quantityKg: "", askingPricePerKg: "", expectedHarvestDate: "", description: "" });
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });
  const withdrawListingMut = trpc.farmer.updateCropListing.useMutation({
    onSuccess: () => { toast.success("Listing withdrawn"); listingsQ.refetch(); },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const farms = farmsQ.data ?? [];
  const listings = listingsQ.data ?? [];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.farmId || !form.quantityKg || !form.askingPricePerKg || !form.expectedHarvestDate) {
      toast.error("Please fill in all required fields");
      return;
    }
    createListingMut.mutate({
      farmId: parseInt(form.farmId),
      cropType: form.cropType,
      variety: form.variety || undefined,
      quantityKg: parseFloat(form.quantityKg),
      askingPricePerKg: parseFloat(form.askingPricePerKg),
      expectedHarvestDate: form.expectedHarvestDate,
      description: form.description || undefined,
    });
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-950 to-slate-950 flex flex-col max-w-md mx-auto">
      {/* Header */}
      <div className="p-4 flex items-center gap-3 border-b border-slate-800">
        <button onClick={() => navigate("/farmer-dashboard")} className="text-slate-400 hover:text-white">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h2 className="text-white font-semibold">Crop Listings</h2>
          <p className="text-slate-400 text-xs">Step 4 of 4</p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowForm(!showForm)}
          className="bg-green-600 hover:bg-green-700 text-white h-8 text-xs"
          disabled={farms.length === 0}
        >
          {showForm ? <X className="w-3.5 h-3.5" /> : <><Plus className="w-3.5 h-3.5 mr-1" />List Crop</>}
        </Button>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1 bg-slate-800">
        <div className="h-full bg-green-500 w-full transition-all" />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-24">
        {/* Add Listing Form */}
        {showForm && (
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-white text-sm">New Crop Listing</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-slate-300 text-xs">Farm *</Label>
                  <select
                    value={form.farmId}
                    onChange={(e) => setForm((f) => ({ ...f, farmId: e.target.value }))}
                    className="w-full h-9 bg-slate-700 border border-slate-600 text-white rounded-md px-2 text-sm"
                    required
                  >
                    <option value="">Select farm...</option>
                    {farms.map((farm) => (
                      <option key={farm.id} value={String(farm.id)}>{farm.farmName}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-slate-300 text-xs">Crop Type *</Label>
                    <select
                      value={form.cropType}
                      onChange={(e) => setForm((f) => ({ ...f, cropType: e.target.value }))}
                      className="w-full h-9 bg-slate-700 border border-slate-600 text-white rounded-md px-2 text-sm"
                    >
                      {CROP_TYPES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-slate-300 text-xs">Variety</Label>
                    <Input
                      placeholder="e.g. SAMMAZ 15"
                      value={form.variety}
                      onChange={(e) => setForm((f) => ({ ...f, variety: e.target.value }))}
                      className="bg-slate-700 border-slate-600 text-white h-9 text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-slate-300 text-xs">Quantity (kg) *</Label>
                    <Input
                      type="number"
                      min="1"
                      placeholder="e.g. 5000"
                      value={form.quantityKg}
                      onChange={(e) => setForm((f) => ({ ...f, quantityKg: e.target.value }))}
                      className="bg-slate-700 border-slate-600 text-white h-9 text-sm"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-slate-300 text-xs">Price/kg (₦) *</Label>
                    <Input
                      type="number"
                      min="1"
                      step="0.01"
                      placeholder="e.g. 450"
                      value={form.askingPricePerKg}
                      onChange={(e) => setForm((f) => ({ ...f, askingPricePerKg: e.target.value }))}
                      className="bg-slate-700 border-slate-600 text-white h-9 text-sm"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-slate-300 text-xs">Expected Harvest Date *</Label>
                  <Input
                    type="date"
                    value={form.expectedHarvestDate}
                    onChange={(e) => setForm((f) => ({ ...f, expectedHarvestDate: e.target.value }))}
                    className="bg-slate-700 border-slate-600 text-white h-9 text-sm"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-slate-300 text-xs">Description</Label>
                  <Input
                    placeholder="e.g. Organically grown, sun-dried"
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    className="bg-slate-700 border-slate-600 text-white h-9 text-sm"
                  />
                </div>
                {/* Price estimate */}
                {form.quantityKg && form.askingPricePerKg && (
                  <div className="bg-green-950/40 border border-green-800/40 rounded-lg p-3 flex items-center justify-between">
                    <p className="text-slate-300 text-xs">Estimated total value</p>
                    <p className="text-green-400 font-bold">
                      ₦{(parseFloat(form.quantityKg) * parseFloat(form.askingPricePerKg)).toLocaleString()}
                    </p>
                  </div>
                )}
                <Button
                  type="submit"
                  disabled={createListingMut.isPending}
                  className="w-full h-10 bg-green-600 hover:bg-green-700 text-white text-sm"
                >
                  {createListingMut.isPending ? "Creating..." : "Create Listing"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Status Filter */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(["ACTIVE", "SOLD", "EXPIRED", "WITHDRAWN", undefined] as const).map((s) => (
            <button
              key={s ?? "ALL"}
              onClick={() => setFilterStatus(s)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filterStatus === s
                  ? "bg-green-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700"
              }`}
            >
              {s ?? "All"}
            </button>
          ))}
        </div>

        {/* Listings */}
        {listingsQ.isLoading ? (
          <div className="text-center py-8">
            <Wheat className="w-8 h-8 text-amber-400 animate-pulse mx-auto" />
          </div>
        ) : listings.length === 0 ? (
          <Card className="bg-slate-800/50 border-slate-700 border-dashed">
            <CardContent className="p-8 text-center">
              <Wheat className="w-10 h-10 text-slate-500 mx-auto mb-3" />
              <p className="text-white font-medium mb-1">No listings found</p>
              <p className="text-slate-400 text-sm mb-4">
                {farms.length === 0
                  ? "Add a farm first before listing crops"
                  : "Create your first crop listing to start selling"}
              </p>
              {farms.length === 0 ? (
                <Button onClick={() => navigate("/farmer-farms")} className="bg-green-600 hover:bg-green-700 text-white">
                  Add Farm First
                </Button>
              ) : (
                <Button onClick={() => setShowForm(true)} className="bg-green-600 hover:bg-green-700 text-white">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Listing
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {listings.map((listing) => {
              const statusCfg = STATUS_CONFIG[listing.status] ?? STATUS_CONFIG.ACTIVE;
              const StatusIcon = statusCfg.icon;
              return (
                <Card key={listing.id} className="bg-slate-800 border-slate-700">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-white font-semibold">{listing.cropType.replace(/_/g, " ")}</p>
                        {listing.variety && <p className="text-slate-400 text-xs">{listing.variety}</p>}
                      </div>
                      <Badge className={`${statusCfg.color} text-xs`}>
                        <StatusIcon className="w-3 h-3 mr-1" />
                        {statusCfg.label}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <div className="text-center">
                        <p className="text-white text-sm font-bold">
                          {parseFloat(listing.quantityKg).toLocaleString()}
                        </p>
                        <p className="text-slate-500 text-xs">kg</p>
                      </div>
                      <div className="text-center">
                        <p className="text-green-400 text-sm font-bold">
                          ₦{parseFloat(listing.askingPricePerKg).toLocaleString()}
                        </p>
                        <p className="text-slate-500 text-xs">per kg</p>
                      </div>
                      <div className="text-center">
                        <p className="text-amber-400 text-sm font-bold">
                          ₦{(parseFloat(listing.quantityKg) * parseFloat(listing.askingPricePerKg)).toLocaleString()}
                        </p>
                        <p className="text-slate-500 text-xs">total</p>
                      </div>
                    </div>
                    {listing.status === "ACTIVE" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => withdrawListingMut.mutate({ listingId: listing.id, status: "WITHDRAWN" })}
                        disabled={withdrawListingMut.isPending}
                        className="w-full h-7 text-xs border-red-800/40 text-red-400 hover:bg-red-950/40"
                      >
                        Withdraw Listing
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom Nav */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-slate-900 border-t border-slate-800 flex">
        {[
          { icon: Sprout, label: "Home", path: "/farmer-dashboard" },
          { icon: MapPin, label: "Farms", path: "/farmer-farms" },
          { icon: Wheat, label: "Crops", path: "/farmer-crops", active: true },
          { icon: BarChart3, label: "Prices", path: "/farmer-market" },
          { icon: User, label: "Profile", path: "/farmer-kyc" },
        ].map(({ icon: Icon, label, path, active }) => (
          <button
            key={label}
            onClick={() => navigate(path)}
            className={`flex-1 py-3 flex flex-col items-center gap-1 text-xs transition-colors ${
              active ? "text-green-400" : "text-slate-400 hover:text-white"
            }`}
          >
            <Icon className="w-5 h-5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
