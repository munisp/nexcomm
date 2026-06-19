/**
 * FarmerAdmin — Admin management of farmer profiles, KYC, and listings
 * Includes bulk KYC approval/rejection with multi-select checkboxes
 */
import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import OSMMap from "@/components/OSMMap";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  ShieldCheck,
  Clock,
  Wheat,
  Search,
  CheckCircle2,
  XCircle,
  MapPin,
  RefreshCw,
  CheckSquare,
  Square,
  Minus,
} from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { PageSkeleton } from "@/components/PageSkeleton";

const KYC_COLORS: Record<string, string> = {
  PENDING: "bg-muted text-muted-foreground",
  SUBMITTED: "bg-amber-900/60 text-amber-300 border-amber-700",
  UNDER_REVIEW: "bg-amber-900/60 text-amber-300 border-amber-700",
  APPROVED: "bg-green-900/60 text-green-300 border-green-700",
  REJECTED: "bg-red-900/60 text-red-300 border-red-700",
};

export default function FarmerAdmin() {
  const [activeTab, setActiveTab] = useState<"farmers" | "listings">("farmers");
  const [kycFilter, setKycFilter] = useState<"PENDING" | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | undefined>("UNDER_REVIEW");
  const [listingFilter, setListingFilter] = useState<"ACTIVE" | "SOLD" | "EXPIRED" | "WITHDRAWN" | undefined>("ACTIVE");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [expandedFarmerId, setExpandedFarmerId] = useState<number | null>(null);
  const [nearbyCountMap, setNearbyCountMap] = useState<Record<number, number | null>>({});

  // Lazy-load farm detail for the expanded farmer
  const farmerDetailQ = trpc.farmer.adminGetFarmerProfile.useQuery(
    { farmerProfileId: expandedFarmerId! },
    { enabled: expandedFarmerId !== null }
  );

  const statsQ = trpc.farmer.adminGetFarmerStats.useQuery();
  const kycStatsQ = trpc.farmer.adminGetKYCStats.useQuery();
  const farmersQ = trpc.farmer.adminListFarmerProfiles.useQuery({
    page: 1,
    limit: 50,
    kycStatus: kycFilter,
    search: search || undefined,
  });
  const listingsQ = trpc.farmer.adminListCropListings.useQuery({
    page: 1,
    limit: 50,
    status: listingFilter,
  });

  // Fetch nearbyFarms count for each farm when the expandable row loads
  useEffect(() => {
    if (!farmerDetailQ.data?.farms) return;
    farmerDetailQ.data.farms.forEach(async (farm) => {
      if (!farm.latitude || !farm.longitude) return;
      if (nearbyCountMap[farm.id] !== undefined) return; // already fetched
      try {
        const res = await fetch("/api/spatial/nearby", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: Number(farm.latitude), lng: Number(farm.longitude), radius_km: 5, exclude_farm_id: farm.id }),
        });
        if (res.ok) {
          const data = await res.json();
          setNearbyCountMap(prev => ({ ...prev, [farm.id]: data.count ?? 0 }));
        }
      } catch {
        // Sedona unavailable — silently skip
      }
    });
  }, [farmerDetailQ.data?.farms]);

  const reviewKYCMut = trpc.farmer.adminReviewKYC.useMutation({
    onSuccess: (_: unknown, vars: { farmerProfileId: number; decision: "APPROVED" | "REJECTED"; notes?: string }) => {
      toast.success(`KYC ${vars.decision === "APPROVED" ? "approved" : "rejected"}`);
      farmersQ.refetch();
      kycStatsQ.refetch();
      statsQ.refetch();
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const bulkReviewMut = trpc.farmer.adminBulkReviewKYC.useMutation({
    onSuccess: (data) => {
      const { approved, rejected, failed } = data;
      if (approved > 0) toast.success(`${approved} farmer${approved > 1 ? "s" : ""} approved`);
      if (rejected > 0) toast.success(`${rejected} farmer${rejected > 1 ? "s" : ""} rejected`);
      if (failed > 0) toast.warning(`${failed} could not be processed`);
      setSelectedIds(new Set());
      farmersQ.refetch();
      kycStatsQ.refetch();
      statsQ.refetch();
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const stats = statsQ.data;
  const kycStats = kycStatsQ.data;
  const farmers = farmersQ.data?.profiles ?? [];
  const listings = listingsQ.data?.listings ?? [];

  // Reviewable farmers (UNDER_REVIEW or SUBMITTED) for bulk selection
  const reviewableFarmers = useMemo(
    () => farmers.filter(f => f.kycStatus === "UNDER_REVIEW" || f.kycStatus === "SUBMITTED"),
    [farmers],
  );

  const allSelected = reviewableFarmers.length > 0 && reviewableFarmers.every(f => selectedIds.has(f.id));
  const someSelected = reviewableFarmers.some(f => selectedIds.has(f.id));

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(reviewableFarmers.map(f => f.id)));
    }
  }

  function toggleOne(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleBulkAction(decision: "APPROVED" | "REJECTED") {
    if (selectedIds.size === 0) return;
    bulkReviewMut.mutate({
      farmerProfileIds: Array.from(selectedIds),
      decision,
      notes: decision === "REJECTED" ? "Does not meet requirements" : undefined,
    });
  }

  if (farmerDetailQ.isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={5} />;
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Farmer Administration</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage farmer onboarding, KYC approvals, and crop listings</p>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Farmers", value: stats?.totalFarmers, icon: Users, color: "text-blue-400" },
            { label: "Pending KYC Review", value: kycStats?.underReview ?? kycStats?.submitted, icon: Clock, color: "text-amber-400" },
            { label: "Total Farms", value: stats?.totalFarms, icon: MapPin, color: "text-green-400" },
            { label: "Active Listings", value: stats?.activeListings, icon: Wheat, color: "text-purple-400" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="bg-secondary border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`w-4 h-4 ${color}`} />
                  <p className="text-muted-foreground text-xs">{label}</p>
                </div>
                <p className="text-2xl font-bold text-white">{value ?? "—"}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* KYC Stats badges */}
        {kycStats && (
          <div className="flex gap-2 flex-wrap">
            {[
              { key: "pending", label: "PENDING", value: kycStats.pending },
              { key: "underReview", label: "UNDER REVIEW", value: kycStats.underReview },
              { key: "approved", label: "APPROVED", value: kycStats.approved },
              { key: "rejected", label: "REJECTED", value: kycStats.rejected },
            ].map(({ key, label, value }) => (
              <Badge key={key} className={`${KYC_COLORS[label.replace(" ", "_")] ?? KYC_COLORS.PENDING} text-xs`}>
                {label}: {value}
              </Badge>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-secondary rounded-lg p-1 w-fit">
          {(["farmers", "listings"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
                activeTab === tab ? "bg-muted text-white" : "text-muted-foreground hover:text-white"
              }`}
            >
              {tab === "farmers" ? "Farmer KYC" : "Crop Listings"}
            </button>
          ))}
        </div>

        {/* Farmers Tab */}
        {activeTab === "farmers" && (
          <div className="space-y-4">
            <div className="flex gap-3 flex-wrap items-center">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by name or phone..." value={search} onChange={(e) => setSearch(e.target.value)}
                  className="bg-secondary border-border text-white pl-9 h-9 text-sm w-64"
                />
              </div>
              <div className="flex gap-1 flex-wrap">
                {([undefined, "PENDING", "UNDER_REVIEW", "SUBMITTED", "APPROVED", "REJECTED"] as const).map((s) => (
                  <button
                    key={s ?? "ALL"}
                    onClick={() => { setKycFilter(s); setSelectedIds(new Set()); }}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      kycFilter === s ? "bg-green-600 text-white" : "bg-secondary text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {s ?? "All"}
                  </button>
                ))}
              </div>
            </div>

            {/* Bulk action bar */}
            {reviewableFarmers.length > 0 && (
              <div className="flex items-center gap-3 p-3 bg-secondary/60 border border-border rounded-lg">
                {/* Select all toggle */}
                <button onClick={toggleAll} className="text-muted-foreground hover:text-white transition-colors">
                  {allSelected ? (
                    <CheckSquare className="w-4 h-4 text-green-400" />
                  ) : someSelected ? (
                    <Minus className="w-4 h-4 text-amber-400" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                </button>
                <span className="text-muted-foreground text-xs flex-1">
                  {selectedIds.size > 0
                    ? `${selectedIds.size} selected`
                    : `${reviewableFarmers.length} reviewable`}
                </span>
                {selectedIds.size > 0 && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => handleBulkAction("APPROVED")}
                      disabled={bulkReviewMut.isPending}
                      className="h-7 text-xs bg-green-700 hover:bg-green-600 text-white"
                    >
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Bulk Approve ({selectedIds.size})
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleBulkAction("REJECTED")}
                      disabled={bulkReviewMut.isPending}
                      className="h-7 text-xs border-red-800/40 text-red-400 hover:bg-red-950/40"
                    >
                      <XCircle className="w-3 h-3 mr-1" />
                      Bulk Reject ({selectedIds.size})
                    </Button>
                  </>
                )}
              </div>
            )}

            <Card className="bg-secondary border-border">
              <CardContent className="p-0">
                {farmersQ.isLoading ? (
                  <div className="p-8 text-center">
                    <RefreshCw className="w-6 h-6 text-muted-foreground animate-spin mx-auto" />
                  </div>
                ) : farmers.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">No farmers found</div>
                ) : (
                  <div className="divide-y divide-slate-700">
                    {farmers.map((farmer) => {
                      const isReviewable = farmer.kycStatus === "UNDER_REVIEW" || farmer.kycStatus === "SUBMITTED";
                      const isSelected = selectedIds.has(farmer.id);
                      return (
                        <div
                          key={farmer.id}
                          className={`p-4 flex items-center gap-4 transition-colors ${
                            isSelected ? "bg-green-950/20" : ""
                          }`}
                        >
                          {/* Checkbox */}
                          <button
                            onClick={() => isReviewable && toggleOne(farmer.id)}
                            className={`shrink-0 transition-colors ${isReviewable ? "cursor-pointer" : "cursor-default opacity-30"}`}
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-green-400" />
                            ) : (
                              <Square className="w-4 h-4 text-muted-foreground" />
                            )}
                          </button>

                          <div
                            className="flex-1 min-w-0 cursor-pointer"
                            onClick={() => setExpandedFarmerId(prev => prev === farmer.id ? null : farmer.id)}
                          >
                            <p className="text-white font-medium truncate">{farmer.fullName}</p>
                            <p className="text-muted-foreground text-xs">{farmer.phone} · {farmer.lga}, {farmer.state}</p>
                            {farmer.nin && <p className="text-muted-foreground text-xs">NIN: {farmer.nin}</p>}
                          </div>
                          <Badge className={`${KYC_COLORS[farmer.kycStatus] ?? KYC_COLORS.PENDING} text-xs shrink-0`}>
                            {farmer.kycStatus}
                          </Badge>
                          {isReviewable && (
                            <div className="flex gap-2 shrink-0">
                              <Button
                                size="sm"
                                onClick={() => reviewKYCMut.mutate({ farmerProfileId: farmer.id, decision: "APPROVED" })}
                                disabled={reviewKYCMut.isPending || bulkReviewMut.isPending}
                                className="h-7 text-xs bg-green-700 hover:bg-green-600 text-white"
                              >
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => reviewKYCMut.mutate({
                                  farmerProfileId: farmer.id,
                                  decision: "REJECTED",
                                  notes: "Does not meet requirements",
                                })}
                                disabled={reviewKYCMut.isPending || bulkReviewMut.isPending}
                                className="h-7 text-xs border-red-800/40 text-red-400 hover:bg-red-950/40"
                              >
                                <XCircle className="w-3 h-3 mr-1" />
                                Reject
                              </Button>
                            </div>
                          )}
                          {/* Expandable Farm Locations Panel */}
                          {expandedFarmerId === farmer.id && (
                            <div className="col-span-full mt-3 pt-3 border-t border-border">
                              {farmerDetailQ.isLoading ? (
                                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                  Loading farm data...
                                </div>
                              ) : farmerDetailQ.data?.farms.length === 0 ? (
                                <p className="text-muted-foreground text-xs italic">No farms registered yet</p>
                              ) : (
                                <div className="space-y-3">
                                  <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                                    Registered Farms ({farmerDetailQ.data?.farms.length})
                                  </p>
                                  {farmerDetailQ.data?.farms.map(farm => {
                                    const nearbyCount = nearbyCountMap[farm.id];
                                    return (
                                    <div key={farm.id} className="bg-card/60 rounded-lg p-3 space-y-2">
                                      <div className="flex items-center justify-between">
                                        <p className="text-white text-sm font-medium">{farm.farmName}</p>
                                        <div className="flex items-center gap-2">
                                          {nearbyCount !== undefined && nearbyCount !== null && (
                                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                              nearbyCount > 3 ? 'bg-red-900/60 text-red-300 border border-red-700' :
                                              nearbyCount > 0 ? 'bg-amber-900/60 text-amber-300 border border-amber-700' :
                                              'bg-muted text-muted-foreground'
                                            }`}>
                                              {nearbyCount} nearby farm{nearbyCount !== 1 ? 's' : ''} (5 km)
                                            </span>
                                          )}
                                          <span className="text-muted-foreground text-xs">{parseFloat(farm.sizeHectares).toFixed(1)} ha · {farm.soilType}</span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                        <MapPin className="w-3 h-3 text-green-400" />
                                        <span>{farm.lga}, {farm.state}</span>
                                        {farm.latitude && farm.longitude && (
                                          <span className="font-mono text-green-400 ml-1">
                                            ({Number(farm.latitude).toFixed(4)}, {Number(farm.longitude).toFixed(4)})
                                          </span>
                                        )}
                                      </div>
                                      {farm.latitude && farm.longitude && (
                                        <OSMMap
                                          initialPin={{ lat: Number(farm.latitude), lng: Number(farm.longitude) }}
                                          readonly={true}
                                          height="160px"
                                        />
                                      )}
                                    </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Listings Tab */}
        {activeTab === "listings" && (
          <div className="space-y-4">
            <div className="flex gap-1 flex-wrap">
              {([undefined, "ACTIVE", "SOLD", "EXPIRED", "WITHDRAWN"] as const).map((s) => (
                <button
                  key={s ?? "ALL"}
                  onClick={() => setListingFilter(s)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    listingFilter === s ? "bg-green-600 text-white" : "bg-secondary text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {s ?? "All"}
                </button>
              ))}
            </div>

            <Card className="bg-secondary border-border">
              <CardContent className="p-0">
                {listingsQ.isLoading ? (
                  <div className="p-8 text-center">
                    <RefreshCw className="w-6 h-6 text-muted-foreground animate-spin mx-auto" />
                  </div>
                ) : listings.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">No listings found</div>
                ) : (
                  <div className="divide-y divide-slate-700">
                    {listings.map((listing) => (
                      <div key={listing.id} className="p-4 flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-medium">{listing.cropType.replace(/_/g, " ")}</p>
                          <p className="text-muted-foreground text-xs">
                            {parseFloat(listing.quantityKg).toLocaleString()} kg · ₦{parseFloat(listing.askingPricePerKg).toLocaleString()}/kg
                          </p>
                        </div>
                        <Badge className={
                          listing.status === "ACTIVE"
                            ? "bg-green-900/60 text-green-300 border-green-700 text-xs"
                            : "bg-muted text-muted-foreground text-xs"
                        }>
                          {listing.status}
                        </Badge>
                        <p className="text-amber-400 text-sm font-bold shrink-0">
                          ₦{(parseFloat(listing.quantityKg) * parseFloat(listing.askingPricePerKg)).toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {stats && (
              <div className="grid grid-cols-2 gap-4">
                <Card className="bg-secondary border-border">
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-amber-400">
                      {(stats.totalQuantityKg / 1000).toFixed(1)}t
                    </p>
                    <p className="text-muted-foreground text-xs mt-1">Total Volume</p>
                  </CardContent>
                </Card>
                <Card className="bg-secondary border-border">
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-green-400">
                      ₦{(stats.totalValueNGN / 1_000_000).toFixed(1)}M
                    </p>
                    <p className="text-muted-foreground text-xs mt-1">Total Value</p>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
