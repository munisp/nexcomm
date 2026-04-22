import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Warehouse,
  MapPin,
  Package,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  ChevronRight,
  Home,
  BarChart3,
  Settings,
  FileText,
  Pencil,
  Upload,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useState, useRef } from "react";
import PushNotificationSettings from "@/pages/PushNotificationSettings";
import { PageSkeleton } from "@/components/PageSkeleton";

const KYC_BADGE: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  PENDING: { label: "Pending", color: "bg-gray-700 text-gray-200", icon: Clock },
  UNDER_REVIEW: { label: "Under Review", color: "bg-yellow-700 text-yellow-200", icon: Clock },
  APPROVED: { label: "Approved", color: "bg-green-700 text-green-200", icon: CheckCircle2 },
  REJECTED: { label: "Rejected", color: "bg-red-700 text-red-200", icon: XCircle },
};

export default function WarehouseDashboard() {
  const [, navigate] = useLocation();
  const { data: profile, isLoading, refetch } = trpc.warehouseOp.getMyWarehouseOpProfile.useQuery();
  const { data: dashStats } = trpc.warehouseOp.getWarehouseOpDashboard.useQuery(undefined, { enabled: !!profile });
  const [editOpen, setEditOpen] = useState(false);
  const [kycReset, setKycReset] = useState(false);
  const [editForm, setEditForm] = useState({ facilityAddress: "", storageCapacityMt: "", contactPhone: "" });
  const [docForm, setDocForm] = useState({ nwrCertNumber: "" });
  const [uploadedUrls, setUploadedUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const nwrCertRef = useRef<HTMLInputElement>(null);
  const facilityRef = useRef<HTMLInputElement>(null);
  const insuranceRef = useRef<HTMLInputElement>(null);
  const uploadKycDoc = trpc.warehouseOp.uploadKycDocument.useMutation({
    onSuccess: (data, vars) => {
      setUploadedUrls(prev => ({ ...prev, [vars.docId]: data.url }));
      toast.success("Document uploaded successfully");
      setUploading(prev => ({ ...prev, [vars.docId]: false }));
    },
    onError: (e, vars) => {
      toast.error(e.message);
      setUploading(prev => ({ ...prev, [vars.docId]: false }));
    },
  });
  const handleFileUpload = async (docId: string, file: File) => {
    setUploading(prev => ({ ...prev, [docId]: true }));
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadKycDoc.mutate({ docId: docId as "nwrCertDocUrl" | "facilityInspectionUrl" | "insuranceDocUrl", fileName: file.name, mimeType: file.type, base64Data: base64 });
    };
    reader.readAsDataURL(file);
  };
  const updateProfile = trpc.warehouseOp.updateMyWarehouseOpProfile.useMutation({
    onSuccess: (data) => {
      if ((data as { kycResetDueToChange?: boolean }).kycResetDueToChange) {
        setKycReset(true);
        toast.warning("Profile updated — KYC reset to PENDING. Please re-upload your NWR certificate.");
      } else {
        toast.success("Profile updated successfully");
        setEditOpen(false);
        refetch();
      }
    },
    onError: (e) => toast.error(e.message),
  });
  const submitKyc = trpc.warehouseOp.submitWarehouseOpKYC.useMutation({
    onSuccess: () => {
      toast.success("NWR certificate submitted for review");
      setEditOpen(false);
      setKycReset(false);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-950 to-amber-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-950 to-amber-900 flex flex-col items-center justify-center px-6 text-center">
        <Warehouse className="w-12 h-12 text-amber-400 mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">No Warehouse Profile Found</h2>
        <p className="text-amber-300 text-sm mb-6">Complete the warehouse operator onboarding to access your dashboard.</p>
        <Button onClick={() => navigate("/warehouse-onboarding")} className="bg-amber-500 hover:bg-amber-400 text-white">
          Start Onboarding
        </Button>
      </div>
    );
  }

  const kycInfo = KYC_BADGE[profile.kycStatus] ?? KYC_BADGE.PENDING;
  const KycIcon = kycInfo.icon;

  if (isLoading) return <PageSkeleton cards={4} tableRows={6} tableCols={4} showChart />;
  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-950 to-amber-900 text-white pb-24">
      {/* Header */}
      <div className="px-4 pt-10 pb-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold">Warehouse Dashboard</h1>
          <Badge className={kycInfo.color + " flex items-center gap-1"}>
            <KycIcon className="w-3 h-3" />
            {kycInfo.label}
          </Badge>
        </div>
        <p className="text-amber-300 text-sm">{profile.facilityName}</p>
      </div>

      <div className="px-4 space-y-4">
        {/* KYC Alert */}
        {profile.kycStatus !== "APPROVED" && (
          <Card className="bg-yellow-900/30 border-yellow-700">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-yellow-200 text-sm font-medium">
                  {profile.kycStatus === "PENDING" ? "NWR Certification Not Submitted" : profile.kycStatus === "UNDER_REVIEW" ? "Certification Under Review" : "Certification Rejected"}
                </p>
                <p className="text-yellow-400 text-xs mt-0.5">
                  {profile.kycStatus === "PENDING"
                    ? "Submit your NWR certification to start issuing warehouse receipts."
                    : profile.kycStatus === "UNDER_REVIEW"
                    ? "A NEXCOM inspector will contact you to schedule a facility visit."
                    : `Reason: ${profile.kycNotes ?? "Please resubmit with correct documents."}`}
                </p>
                {profile.kycStatus === "PENDING" && (
                  <button onClick={() => navigate("/warehouse-onboarding")} className="text-yellow-300 text-xs underline mt-1">
                    Complete Certification →
                  </button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Live Stats Cards */}
        {dashStats && (
          <div className="grid grid-cols-2 gap-3">
            <Card className="bg-amber-800/30 border-amber-700">
              <CardContent className="p-4">
                <p className="text-xs text-amber-400 mb-1">Active Receipts</p>
                <p className="text-2xl font-bold text-white">{dashStats.receiptStats.active}</p>
                <p className="text-xs text-amber-300 mt-1">of {dashStats.receiptStats.total} total</p>
              </CardContent>
            </Card>
            <Card className="bg-amber-800/30 border-amber-700">
              <CardContent className="p-4">
                <p className="text-xs text-amber-400 mb-1">Inventory</p>
                <p className="text-2xl font-bold text-white">{dashStats.inventoryStats.totalQuantityMt.toLocaleString(undefined, { maximumFractionDigits: 1 })} MT</p>
                <p className="text-xs text-amber-300 mt-1">{dashStats.inventoryStats.totalItems} items</p>
              </CardContent>
            </Card>
            <Card className="bg-amber-800/30 border-amber-700">
              <CardContent className="p-4">
                <p className="text-xs text-amber-400 mb-1">Utilization</p>
                <p className="text-2xl font-bold text-white">{dashStats.utilizationPct}%</p>
                <div className="w-full bg-amber-900 rounded-full h-1.5 mt-2">
                  <div className="bg-amber-400 h-1.5 rounded-full" style={{ width: `${dashStats.utilizationPct}%` }} />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-amber-800/30 border-amber-700">
              <CardContent className="p-4">
                <p className="text-xs text-amber-400 mb-1">Pledged</p>
                <p className="text-2xl font-bold text-white">{dashStats.receiptStats.pledged}</p>
                <p className="text-xs text-amber-300 mt-1">{dashStats.receiptStats.redeemed} redeemed</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Facility Details */}
        <Card className="bg-amber-800/30 border-amber-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-amber-300 font-medium">Facility Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-amber-400">Address</p>
                <p className="text-sm text-white">{profile.facilityAddress}</p>
                <p className="text-xs text-amber-300">{profile.state}{profile.lga ? `, ${profile.lga}` : ""}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-amber-400">Storage Capacity</p>
                <p className="text-sm font-medium text-white">
                  {profile.storageCapacityMt ? `${parseFloat(profile.storageCapacityMt).toLocaleString()} MT` : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-amber-400">Grading Staff</p>
                <p className="text-sm font-medium text-white">{profile.gradingStaffCount ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-amber-400">Operating Hours</p>
                <p className="text-sm font-medium text-white">{profile.operatingHours ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-amber-400">Account Status</p>
                <p className={`text-sm font-medium ${profile.accountStatus === "ACTIVE" ? "text-green-400" : "text-gray-400"}`}>
                  {profile.accountStatus}
                </p>
              </div>
            </div>
            {profile.nwrCertNumber && (
              <div>
                <p className="text-xs text-amber-400">NWR Certificate</p>
                <p className="text-sm font-medium text-white">{profile.nwrCertNumber}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Commodities */}
        {profile.commoditiesHandled && profile.commoditiesHandled.length > 0 && (
          <Card className="bg-amber-800/30 border-amber-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-amber-300 font-medium">Commodities Handled</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {profile.commoditiesHandled.map((c: string) => (
                  <Badge key={c} className="bg-amber-700 text-amber-200 text-xs">{c}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Accepted Grades */}
        {profile.acceptedGrades && profile.acceptedGrades.length > 0 && (
          <Card className="bg-amber-800/30 border-amber-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-amber-300 font-medium">Accepted Grades</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {profile.acceptedGrades.map((g: string) => (
                  <Badge key={g} className="bg-amber-600 text-amber-100 text-xs">{g}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Edit Profile Button */}
        <button
          onClick={() => {
            setEditForm({
              facilityAddress: profile.facilityAddress ?? "",
              storageCapacityMt: profile.storageCapacityMt ? String(profile.storageCapacityMt) : "",
              contactPhone: (profile as { contactPhone?: string }).contactPhone ?? "",
            });
            setEditOpen(true);
          }}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-amber-700/40 hover:bg-amber-600/40 border border-amber-600 text-sm text-amber-200 transition-colors"
        >
          <Pencil className="w-4 h-4" />
          Edit Profile
        </button>

        {/* Quick Actions */}
        <Card className="bg-amber-800/30 border-amber-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-amber-300 font-medium">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: "Issue Warehouse Receipt", icon: FileText, path: "/warehouse-receipts" },
              { label: "View Inventory", icon: Package, path: "/warehouse-inventory" },
              { label: "Market Prices", icon: BarChart3, path: "/market" },
            ].map(({ label, icon: Icon, path }) => (
              <button
                key={label}
                onClick={() => navigate(path)}
                className="w-full flex items-center justify-between p-3 rounded-lg bg-amber-800/40 hover:bg-amber-700/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-amber-400" />
                  <span className="text-sm text-white">{label}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-amber-500" />
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Edit Profile Dialog */}
      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setKycReset(false); }}>
        <DialogContent className="bg-amber-950 border-amber-700 text-white max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">Edit Warehouse Profile</DialogTitle>
          </DialogHeader>
          {!kycReset ? (
            <>
              <div className="space-y-4 py-2">
                <div>
                  <Label className="text-amber-300 text-xs">Facility Address</Label>
                  <Input value={editForm.facilityAddress} onChange={e => setEditForm(f => ({ ...f, facilityAddress: e.target.value }))} placeholder="123 Warehouse Road, Kano" className="bg-amber-900 border-amber-700 text-white mt-1" />
                </div>
                <div>
                  <Label className="text-amber-300 text-xs">Storage Capacity (MT)</Label>
                  <Input value={editForm.storageCapacityMt} onChange={e => setEditForm(f => ({ ...f, storageCapacityMt: e.target.value }))} placeholder="5000" className="bg-amber-900 border-amber-700 text-white mt-1" />
                </div>
                <div>
                  <Label className="text-amber-300 text-xs">Contact Phone</Label>
                  <Input value={editForm.contactPhone} onChange={e => setEditForm(f => ({ ...f, contactPhone: e.target.value }))} placeholder="+234 800 000 0000" className="bg-amber-900 border-amber-700 text-white mt-1" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditOpen(false)} className="border-amber-700 text-amber-300">Cancel</Button>
                <Button
                  onClick={() => updateProfile.mutate({
                    facilityAddress: editForm.facilityAddress || undefined,
                    storageCapacityMt: editForm.storageCapacityMt ? parseInt(editForm.storageCapacityMt) : undefined,
                  })}
                  disabled={updateProfile.isPending}
                  className="bg-amber-500 hover:bg-amber-400 text-white"
                >
                  {updateProfile.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-3 mb-4">
                <div className="flex items-start gap-2">
                  <Upload className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-yellow-200 text-sm font-medium">KYC Reset — Re-upload Required</p>
                    <p className="text-yellow-400 text-xs mt-0.5">Your profile changes require a fresh KYC review. Please re-submit your NWR certificate.</p>
                  </div>
                </div>
              </div>
              <div className="space-y-4 py-2">
                <div>
                  <Label className="text-amber-300 text-xs">NWR Certificate Number <span className="text-red-400">*</span></Label>
                  <Input value={docForm.nwrCertNumber} onChange={e => setDocForm(f => ({ ...f, nwrCertNumber: e.target.value }))} placeholder="NWR/2024/001" className="bg-amber-900 border-amber-700 text-white mt-1" />
                </div>
                <div>
                  <Label className="text-amber-300 text-xs">NWR Certificate <span className="text-red-400">*</span></Label>
                  <input ref={nwrCertRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={e => e.target.files?.[0] && handleFileUpload("nwrCertDocUrl", e.target.files[0])} />
                  <div className="flex items-center gap-2 mt-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => nwrCertRef.current?.click()} disabled={uploading["nwrCertDocUrl"]} className="border-amber-700 text-amber-300 bg-transparent">
                      {uploading["nwrCertDocUrl"] ? "Uploading..." : "Choose File"}
                    </Button>
                    {uploadedUrls["nwrCertDocUrl"] && <span className="text-green-400 text-xs flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Uploaded</span>}
                  </div>
                </div>
                <div>
                  <Label className="text-amber-300 text-xs">Facility Inspection Report (optional)</Label>
                  <input ref={facilityRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={e => e.target.files?.[0] && handleFileUpload("facilityInspectionUrl", e.target.files[0])} />
                  <div className="flex items-center gap-2 mt-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => facilityRef.current?.click()} disabled={uploading["facilityInspectionUrl"]} className="border-amber-700 text-amber-300 bg-transparent">
                      {uploading["facilityInspectionUrl"] ? "Uploading..." : "Choose File"}
                    </Button>
                    {uploadedUrls["facilityInspectionUrl"] && <span className="text-green-400 text-xs flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Uploaded</span>}
                  </div>
                </div>
                <div>
                  <Label className="text-amber-300 text-xs">Insurance Document (optional)</Label>
                  <input ref={insuranceRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={e => e.target.files?.[0] && handleFileUpload("insuranceDocUrl", e.target.files[0])} />
                  <div className="flex items-center gap-2 mt-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => insuranceRef.current?.click()} disabled={uploading["insuranceDocUrl"]} className="border-amber-700 text-amber-300 bg-transparent">
                      {uploading["insuranceDocUrl"] ? "Uploading..." : "Choose File"}
                    </Button>
                    {uploadedUrls["insuranceDocUrl"] && <span className="text-green-400 text-xs flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Uploaded</span>}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setEditOpen(false); setKycReset(false); }} className="border-amber-700 text-amber-300">Cancel</Button>
                <Button
                  onClick={() => submitKyc.mutate({
                    nwrCertNumber: docForm.nwrCertNumber,
                    nwrCertDocUrl: uploadedUrls["nwrCertDocUrl"] ?? "",
                    facilityInspectionUrl: uploadedUrls["facilityInspectionUrl"] || undefined,
                    insuranceDocUrl: uploadedUrls["insuranceDocUrl"] || undefined,
                  })}
                  disabled={submitKyc.isPending || !docForm.nwrCertNumber || !uploadedUrls["nwrCertDocUrl"]}
                  className="bg-yellow-600 hover:bg-yellow-500 text-white"
                >
                  {submitKyc.isPending ? "Submitting..." : "Re-submit for Review"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Push Notification Settings */}
      <div className="px-4 pb-4">
        <PushNotificationSettings compact />
      </div>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-amber-950 border-t border-amber-800 flex">
        {[
          { icon: Home, label: "Home", path: "/" },
          { icon: Package, label: "Inventory", path: "/warehouse-inventory" },
          { icon: Warehouse, label: "Facility", path: "/warehouse-dashboard", active: true },
          { icon: Settings, label: "Settings", path: "/settings" },
        ].map(({ icon: Icon, label, path, active }) => (
          <button
            key={label}
            onClick={() => navigate(path)}
            className={`flex-1 flex flex-col items-center py-3 gap-0.5 text-xs transition-colors ${
              active ? "text-amber-400" : "text-amber-600 hover:text-amber-400"
            }`}
          >
            <Icon className="w-5 h-5" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
