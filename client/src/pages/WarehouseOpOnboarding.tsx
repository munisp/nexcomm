import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Warehouse,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  MapPin,
  Package,
  FileText,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { KycAnalysisPanel } from "@/components/KycAnalysisPanel";

const COMMODITIES = ["Maize", "Sorghum", "Soybeans", "Wheat", "Rice", "Cocoa", "Sesame", "Ginger", "Cashew", "Palm Oil"];
const GRADES = ["Grade A", "Grade B", "Grade C", "Premium", "Standard", "Below Standard"];
const SOIL_TYPES = ["Sandy", "Clay", "Loam", "Silt", "Peat"];

export default function WarehouseOpOnboarding() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);

  const [form, setForm] = useState({
    facilityName: "",
    facilityAddress: "",
    state: "",
    lga: "",
    gpsLat: "",
    gpsLng: "",
    storageCapacityMt: "",
    commoditiesHandled: [] as string[],
    gradingStaffCount: "",
    operatingHours: "08:00–18:00",
    acceptedGrades: [] as string[],
    nwrCertNumber: "",
    nwrCertDocUrl: "",
    facilityInspectionUrl: "",
    insuranceDocUrl: "",
  });

  const registerMutation = trpc.warehouseOp.registerWarehouseOp.useMutation();
  const kycMutation = trpc.warehouseOp.submitWarehouseOpKYC.useMutation();

  const toggleItem = (key: "commoditiesHandled" | "acceptedGrades", item: string) => {
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(item) ? f[key].filter((x) => x !== item) : [...f[key], item],
    }));
  };

  const handleRegister = async () => {
    try {
      await registerMutation.mutateAsync({
        facilityName: form.facilityName,
        facilityAddress: form.facilityAddress,
        state: form.state,
        lga: form.lga || undefined,
        gpsLat: form.gpsLat ? parseFloat(form.gpsLat) : undefined,
        gpsLng: form.gpsLng ? parseFloat(form.gpsLng) : undefined,
        storageCapacityMt: form.storageCapacityMt ? parseFloat(form.storageCapacityMt) : undefined,
        commoditiesHandled: form.commoditiesHandled,
        gradingStaffCount: form.gradingStaffCount ? parseInt(form.gradingStaffCount) : undefined,
        operatingHours: form.operatingHours || undefined,
        acceptedGrades: form.acceptedGrades,
      });
      setStep(4);
    } catch (e: any) {
      if (e?.message?.includes("already exists")) {
        toast.info("Warehouse profile already exists — proceeding to KYC");
        setStep(4);
      } else {
        toast.error(e?.message ?? "Registration failed");
      }
    }
  };

  const handleKYC = async () => {
    if (!form.nwrCertNumber || !form.nwrCertDocUrl) {
      toast.error("NWR certificate number and document URL are required");
      return;
    }
    try {
      await kycMutation.mutateAsync({
        nwrCertNumber: form.nwrCertNumber,
        nwrCertDocUrl: form.nwrCertDocUrl,
        facilityInspectionUrl: form.facilityInspectionUrl || undefined,
        insuranceDocUrl: form.insuranceDocUrl || undefined,
      });
      setStep(6);
    } catch (e: any) {
      toast.error(e?.message ?? "KYC submission failed");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-950 to-amber-900 text-white">
      {/* Step 1: Welcome */}
      {step === 1 && (
        <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
          <div className="w-20 h-20 rounded-2xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center mb-6">
            <Warehouse className="w-10 h-10 text-amber-400" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Warehouse Operator</h1>
          <p className="text-amber-300 text-lg mb-2">NEXCOM Exchange</p>
          <p className="text-amber-400 text-sm mb-8 max-w-xs">
            Register your storage facility to issue Negotiable Warehouse Receipts (NWRs) and provide custody services for exchange-traded commodities.
          </p>
          <div className="w-full max-w-xs space-y-3 mb-8">
            {["Issue NWR Receipts", "Commodity Custody Services", "Grading & Quality Certification", "Exchange-linked Inventory"].map((f) => (
              <div key={f} className="flex items-center gap-3 text-left">
                <CheckCircle2 className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <span className="text-sm text-amber-200">{f}</span>
              </div>
            ))}
          </div>
          <Button onClick={() => setStep(2)} className="w-full max-w-xs bg-amber-500 hover:bg-amber-400 text-white font-semibold py-3 rounded-xl">
            Register Facility <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
          <button onClick={() => navigate("/warehouse-dashboard")} className="mt-4 text-amber-400 text-sm underline">
            Already registered? View dashboard
          </button>
        </div>
      )}

      {/* Step 2: Facility Details */}
      {step === 2 && (
        <div className="px-4 py-6">
          <button onClick={() => setStep(1)} className="mb-4 flex items-center gap-1 text-amber-400 text-sm">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="mb-6">
            <Badge className="bg-amber-800 text-amber-200 mb-2">Step 1 of 4</Badge>
            <h2 className="text-2xl font-bold">Facility Details</h2>
            <p className="text-amber-300 text-sm">Register your storage facility location and capacity</p>
          </div>
          <div className="space-y-4">
            <div>
              <Label className="text-amber-200 text-sm">Facility Name *</Label>
              <Input
                value={form.facilityName}
                onChange={(e) => setForm((f) => ({ ...f, facilityName: e.target.value }))}
                placeholder="Kano Central Grain Store"
                className="bg-amber-800/40 border-amber-700 text-white placeholder:text-amber-500 mt-1"
              />
            </div>
            <div>
              <Label className="text-amber-200 text-sm">Facility Address *</Label>
              <Input
                value={form.facilityAddress}
                onChange={(e) => setForm((f) => ({ ...f, facilityAddress: e.target.value }))}
                placeholder="Plot 12, Industrial Layout, Kano"
                className="bg-amber-800/40 border-amber-700 text-white placeholder:text-amber-500 mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-amber-200 text-sm">State *</Label>
                <Input
                  value={form.state}
                  onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                  placeholder="Kano"
                  className="bg-amber-800/40 border-amber-700 text-white placeholder:text-amber-500 mt-1"
                />
              </div>
              <div>
                <Label className="text-amber-200 text-sm">LGA</Label>
                <Input
                  value={form.lga}
                  onChange={(e) => setForm((f) => ({ ...f, lga: e.target.value }))}
                  placeholder="Kano Municipal"
                  className="bg-amber-800/40 border-amber-700 text-white placeholder:text-amber-500 mt-1"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-amber-200 text-sm">GPS Latitude</Label>
                <Input
                  value={form.gpsLat}
                  onChange={(e) => setForm((f) => ({ ...f, gpsLat: e.target.value }))}
                  placeholder="12.0022"
                  type="number"
                  step="0.0001"
                  className="bg-amber-800/40 border-amber-700 text-white placeholder:text-amber-500 mt-1"
                />
              </div>
              <div>
                <Label className="text-amber-200 text-sm">GPS Longitude</Label>
                <Input
                  value={form.gpsLng}
                  onChange={(e) => setForm((f) => ({ ...f, gpsLng: e.target.value }))}
                  placeholder="8.5920"
                  type="number"
                  step="0.0001"
                  className="bg-amber-800/40 border-amber-700 text-white placeholder:text-amber-500 mt-1"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-amber-200 text-sm">Storage Capacity (MT)</Label>
                <Input
                  value={form.storageCapacityMt}
                  onChange={(e) => setForm((f) => ({ ...f, storageCapacityMt: e.target.value }))}
                  placeholder="5000"
                  type="number"
                  className="bg-amber-800/40 border-amber-700 text-white placeholder:text-amber-500 mt-1"
                />
              </div>
              <div>
                <Label className="text-amber-200 text-sm">Grading Staff</Label>
                <Input
                  value={form.gradingStaffCount}
                  onChange={(e) => setForm((f) => ({ ...f, gradingStaffCount: e.target.value }))}
                  placeholder="10"
                  type="number"
                  className="bg-amber-800/40 border-amber-700 text-white placeholder:text-amber-500 mt-1"
                />
              </div>
            </div>
          </div>
          <Button
            onClick={() => setStep(3)}
            disabled={!form.facilityName || !form.facilityAddress || !form.state}
            className="w-full mt-6 bg-amber-500 hover:bg-amber-400 text-white font-semibold py-3 rounded-xl"
          >
            Continue <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Step 3: Commodities & Grades */}
      {step === 3 && (
        <div className="px-4 py-6">
          <button onClick={() => setStep(2)} className="mb-4 flex items-center gap-1 text-amber-400 text-sm">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="mb-6">
            <Badge className="bg-amber-800 text-amber-200 mb-2">Step 2 of 4</Badge>
            <h2 className="text-2xl font-bold">Commodities & Grades</h2>
            <p className="text-amber-300 text-sm">Select commodities you store and grades you certify</p>
          </div>
          <div className="space-y-5">
            <div>
              <Label className="text-amber-200 text-sm mb-2 block">Commodities Handled</Label>
              <div className="flex flex-wrap gap-2">
                {COMMODITIES.map((c) => (
                  <button
                    key={c}
                    onClick={() => toggleItem("commoditiesHandled", c)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      form.commoditiesHandled.includes(c)
                        ? "bg-amber-500 border-amber-400 text-white"
                        : "border-amber-700 text-amber-300 hover:border-amber-500"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-amber-200 text-sm mb-2 block">Accepted Grades</Label>
              <div className="flex flex-wrap gap-2">
                {GRADES.map((g) => (
                  <button
                    key={g}
                    onClick={() => toggleItem("acceptedGrades", g)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      form.acceptedGrades.includes(g)
                        ? "bg-amber-500 border-amber-400 text-white"
                        : "border-amber-700 text-amber-300 hover:border-amber-500"
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-amber-200 text-sm">Operating Hours</Label>
              <Input
                value={form.operatingHours}
                onChange={(e) => setForm((f) => ({ ...f, operatingHours: e.target.value }))}
                placeholder="08:00–18:00"
                className="bg-amber-800/40 border-amber-700 text-white placeholder:text-amber-500 mt-1"
              />
            </div>
          </div>
          <Button
            onClick={handleRegister}
            disabled={registerMutation.isPending}
            className="w-full mt-6 bg-amber-500 hover:bg-amber-400 text-white font-semibold py-3 rounded-xl"
          >
            {registerMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
            ) : (
              <>Continue to NWR Certification <ChevronRight className="w-4 h-4 ml-1" /></>
            )}
          </Button>
        </div>
      )}

      {/* Step 4: NWR Certification */}
      {step === 4 && (
        <div className="px-4 py-6">
          <button onClick={() => setStep(3)} className="mb-4 flex items-center gap-1 text-amber-400 text-sm">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="mb-6">
            <Badge className="bg-amber-800 text-amber-200 mb-2">Step 3 of 4</Badge>
            <h2 className="text-2xl font-bold">NWR Certification</h2>
            <p className="text-amber-300 text-sm">Upload your Negotiable Warehouse Receipt certification</p>
          </div>
          <div className="space-y-4">
            <div>
              <Label className="text-amber-200 text-sm">NWR Certificate Number *</Label>
              <Input
                value={form.nwrCertNumber}
                onChange={(e) => setForm((f) => ({ ...f, nwrCertNumber: e.target.value }))}
                placeholder="NWR/2024/KN/001"
                className="bg-amber-800/40 border-amber-700 text-white placeholder:text-amber-500 mt-1"
              />
            </div>
            <div>
              <Label className="text-amber-200 text-sm">NWR Certificate Document URL *</Label>
              <Input
                value={form.nwrCertDocUrl}
                onChange={(e) => setForm((f) => ({ ...f, nwrCertDocUrl: e.target.value }))}
                placeholder="https://storage.example.com/nwr-cert.pdf"
                className="bg-amber-800/40 border-amber-700 text-white placeholder:text-amber-500 mt-1"
              />
            </div>
            <div>
              <Label className="text-amber-200 text-sm">Facility Inspection Report URL (optional)</Label>
              <Input
                value={form.facilityInspectionUrl}
                onChange={(e) => setForm((f) => ({ ...f, facilityInspectionUrl: e.target.value }))}
                placeholder="https://storage.example.com/inspection.pdf"
                className="bg-amber-800/40 border-amber-700 text-white placeholder:text-amber-500 mt-1"
              />
            </div>
            <div>
              <Label className="text-amber-200 text-sm">Insurance Document URL (optional)</Label>
              <Input
                value={form.insuranceDocUrl}
                onChange={(e) => setForm((f) => ({ ...f, insuranceDocUrl: e.target.value }))}
                placeholder="https://storage.example.com/insurance.pdf"
                className="bg-amber-800/40 border-amber-700 text-white placeholder:text-amber-500 mt-1"
              />
            </div>
            <Card className="bg-amber-800/20 border-amber-700 border-dashed">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-amber-400">
                  Upload all documents to secure cloud storage first, then paste the URL.
                  Accepted: PDF, JPG, PNG (max 5MB each).
                </p>
              </CardContent>
            </Card>
            {form.nwrCertDocUrl && (
              <KycAnalysisPanel
                documentUrl={form.nwrCertDocUrl}
                stakeholderType="WAREHOUSE_OPERATOR"
              />
            )}
          </div>
          <Button
            onClick={handleKYC}
            disabled={!form.nwrCertNumber || !form.nwrCertDocUrl || kycMutation.isPending}
            className="w-full mt-6 bg-amber-500 hover:bg-amber-400 text-white font-semibold py-3 rounded-xl"
          >
            {kycMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting...</>
            ) : (
              <>Submit for Review <ChevronRight className="w-4 h-4 ml-1" /></>
            )}
          </Button>
        </div>
      )}

      {/* Step 6: Complete */}
      {step === 6 && (
        <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
          <div className="w-20 h-20 rounded-full bg-amber-500/20 border border-amber-400/30 flex items-center justify-center mb-6">
            <CheckCircle2 className="w-10 h-10 text-amber-400" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Application Submitted!</h2>
          <p className="text-amber-300 text-sm mb-6 max-w-xs">
            Your warehouse operator KYC is under review. A NEXCOM inspector will contact you to schedule a facility visit. This process typically takes 5–10 business days.
          </p>
          <div className="w-full max-w-xs space-y-3">
            <Button
              onClick={() => navigate("/warehouse-dashboard")}
              className="w-full bg-amber-500 hover:bg-amber-400 text-white font-semibold py-3 rounded-xl"
            >
              Go to Dashboard
            </Button>
            <Button
              onClick={() => navigate("/")}
              variant="outline"
              className="w-full border-amber-600 text-amber-300 hover:bg-amber-800 bg-transparent py-3 rounded-xl"
            >
              Back to Exchange
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
