import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Briefcase,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Building2,
  FileText,
  Shield,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { KycAnalysisPanel } from "@/components/KycAnalysisPanel";

export default function BrokerOnboarding() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);

  const [form, setForm] = useState({
    firmName: "",
    rcNumber: "",
    contactPhone: "",
    contactEmail: "",
    firmAddress: "",
    state: "",
    yearsInOperation: "",
    clientBookSize: "",
    commissionRate: "",
    secLicenseNumber: "",
    cbnLicenseNumber: "",
    regulatoryBody: "SEC Nigeria",
    secCertificateUrl: "",
    cbnApprovalUrl: "",
    cacDocUrl: "",
  });

  const registerMutation = trpc.broker.registerBroker.useMutation();
  const kycMutation = trpc.broker.submitBrokerKYC.useMutation();

  const handleRegister = async () => {
    try {
      await registerMutation.mutateAsync({
        firmName: form.firmName,
        rcNumber: form.rcNumber || undefined,
        contactPhone: form.contactPhone,
        contactEmail: form.contactEmail || undefined,
        firmAddress: form.firmAddress || undefined,
        state: form.state || undefined,
        yearsInOperation: form.yearsInOperation ? parseInt(form.yearsInOperation) : undefined,
        clientBookSize: form.clientBookSize || undefined,
        commissionRate: form.commissionRate ? parseFloat(form.commissionRate) : undefined,
      });
      setStep(3);
    } catch (e: any) {
      if (e?.message?.includes("already exists")) {
        toast.info("Broker profile already exists — proceeding to KYC");
        setStep(3);
      } else {
        toast.error(e?.message ?? "Registration failed");
      }
    }
  };

  const handleKYC = async () => {
    if (!form.secLicenseNumber || !form.secCertificateUrl) {
      toast.error("SEC license number and certificate are required");
      return;
    }
    try {
      await kycMutation.mutateAsync({
        secLicenseNumber: form.secLicenseNumber,
        cbnLicenseNumber: form.cbnLicenseNumber || undefined,
        regulatoryBody: form.regulatoryBody,
        secCertificateUrl: form.secCertificateUrl,
        cbnApprovalUrl: form.cbnApprovalUrl || undefined,
        cacDocUrl: form.cacDocUrl || undefined,
      });
      setStep(5);
    } catch (e: any) {
      toast.error(e?.message ?? "KYC submission failed");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-950 to-purple-900 text-white">
      {/* Step 1: Welcome */}
      {step === 1 && (
        <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
          <div className="w-20 h-20 rounded-2xl bg-purple-500/20 border border-purple-400/30 flex items-center justify-center mb-6">
            <Briefcase className="w-10 h-10 text-purple-400" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Broker Onboarding</h1>
          <p className="text-purple-300 text-lg mb-2">NEXCOM Exchange</p>
          <p className="text-purple-400 text-sm mb-8 max-w-xs">
            Register your brokerage firm to access institutional trading infrastructure, manage client accounts, and earn commissions on executed trades.
          </p>
          <div className="w-full max-w-xs space-y-3 mb-8">
            {["Client Account Management", "Commission-based Revenue", "Regulatory Compliance Tools", "Institutional Order Flow"].map((f) => (
              <div key={f} className="flex items-center gap-3 text-left">
                <CheckCircle2 className="w-4 h-4 text-purple-400 flex-shrink-0" />
                <span className="text-sm text-purple-200">{f}</span>
              </div>
            ))}
          </div>
          <Button onClick={() => setStep(2)} className="w-full max-w-xs bg-purple-500 hover:bg-purple-400 text-white font-semibold py-3 rounded-xl">
            Register Firm <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
          <button onClick={() => navigate("/broker-dashboard")} className="mt-4 text-purple-400 text-sm underline">
            Already registered? View dashboard
          </button>
        </div>
      )}

      {/* Step 2: Firm Details */}
      {step === 2 && (
        <div className="px-4 py-6">
          <button onClick={() => setStep(1)} className="mb-4 flex items-center gap-1 text-purple-400 text-sm">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="mb-6">
            <Badge className="bg-purple-800 text-purple-200 mb-2">Step 1 of 3</Badge>
            <h2 className="text-2xl font-bold">Firm Details</h2>
            <p className="text-purple-300 text-sm">Register your brokerage firm information</p>
          </div>
          <div className="space-y-4">
            <div>
              <Label className="text-purple-200 text-sm">Firm Name *</Label>
              <Input
                value={form.firmName}
                onChange={(e) => setForm((f) => ({ ...f, firmName: e.target.value }))}
                placeholder="Adeyemi Securities Ltd"
                className="bg-purple-800/40 border-purple-700 text-white placeholder:text-purple-500 mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-purple-200 text-sm">RC Number</Label>
                <Input
                  value={form.rcNumber}
                  onChange={(e) => setForm((f) => ({ ...f, rcNumber: e.target.value }))}
                  placeholder="RC123456"
                  className="bg-purple-800/40 border-purple-700 text-white placeholder:text-purple-500 mt-1"
                />
              </div>
              <div>
                <Label className="text-purple-200 text-sm">State</Label>
                <Input
                  value={form.state}
                  onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                  placeholder="Lagos"
                  className="bg-purple-800/40 border-purple-700 text-white placeholder:text-purple-500 mt-1"
                />
              </div>
            </div>
            <div>
              <Label className="text-purple-200 text-sm">Contact Phone *</Label>
              <Input
                value={form.contactPhone}
                onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
                placeholder="+234 801 234 5678"
                className="bg-purple-800/40 border-purple-700 text-white placeholder:text-purple-500 mt-1"
              />
            </div>
            <div>
              <Label className="text-purple-200 text-sm">Contact Email</Label>
              <Input
                value={form.contactEmail}
                onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
                placeholder="info@adeyemisec.com"
                type="email"
                className="bg-purple-800/40 border-purple-700 text-white placeholder:text-purple-500 mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-purple-200 text-sm">Years Operating</Label>
                <Input
                  value={form.yearsInOperation}
                  onChange={(e) => setForm((f) => ({ ...f, yearsInOperation: e.target.value }))}
                  placeholder="5"
                  type="number"
                  className="bg-purple-800/40 border-purple-700 text-white placeholder:text-purple-500 mt-1"
                />
              </div>
              <div>
                <Label className="text-purple-200 text-sm">Commission Rate (%)</Label>
                <Input
                  value={form.commissionRate}
                  onChange={(e) => setForm((f) => ({ ...f, commissionRate: e.target.value }))}
                  placeholder="0.5"
                  type="number"
                  step="0.01"
                  className="bg-purple-800/40 border-purple-700 text-white placeholder:text-purple-500 mt-1"
                />
              </div>
            </div>
            <div>
              <Label className="text-purple-200 text-sm">Client Book Size</Label>
              <Input
                value={form.clientBookSize}
                onChange={(e) => setForm((f) => ({ ...f, clientBookSize: e.target.value }))}
                placeholder="e.g. 50–200 clients"
                className="bg-purple-800/40 border-purple-700 text-white placeholder:text-purple-500 mt-1"
              />
            </div>
          </div>
          <Button
            onClick={handleRegister}
            disabled={!form.firmName || !form.contactPhone || registerMutation.isPending}
            className="w-full mt-6 bg-purple-500 hover:bg-purple-400 text-white font-semibold py-3 rounded-xl"
          >
            {registerMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
            ) : (
              <>Continue <ChevronRight className="w-4 h-4 ml-1" /></>
            )}
          </Button>
        </div>
      )}

      {/* Step 3: Regulatory Licensing */}
      {step === 3 && (
        <div className="px-4 py-6">
          <button onClick={() => setStep(2)} className="mb-4 flex items-center gap-1 text-purple-400 text-sm">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="mb-6">
            <Badge className="bg-purple-800 text-purple-200 mb-2">Step 2 of 3</Badge>
            <h2 className="text-2xl font-bold">Regulatory Licensing</h2>
            <p className="text-purple-300 text-sm">Upload your SEC and CBN approvals</p>
          </div>
          <div className="space-y-4">
            <div>
              <Label className="text-purple-200 text-sm">SEC License Number *</Label>
              <Input
                value={form.secLicenseNumber}
                onChange={(e) => setForm((f) => ({ ...f, secLicenseNumber: e.target.value }))}
                placeholder="SEC/BD/2024/001"
                className="bg-purple-800/40 border-purple-700 text-white placeholder:text-purple-500 mt-1"
              />
            </div>
            <div>
              <Label className="text-purple-200 text-sm">CBN License Number (if applicable)</Label>
              <Input
                value={form.cbnLicenseNumber}
                onChange={(e) => setForm((f) => ({ ...f, cbnLicenseNumber: e.target.value }))}
                placeholder="CBN/2024/FX/001"
                className="bg-purple-800/40 border-purple-700 text-white placeholder:text-purple-500 mt-1"
              />
            </div>
            <div>
              <Label className="text-purple-200 text-sm">Regulatory Body *</Label>
              <Input
                value={form.regulatoryBody}
                onChange={(e) => setForm((f) => ({ ...f, regulatoryBody: e.target.value }))}
                placeholder="SEC Nigeria"
                className="bg-purple-800/40 border-purple-700 text-white placeholder:text-purple-500 mt-1"
              />
            </div>
            <div>
              <Label className="text-purple-200 text-sm">SEC Certificate URL *</Label>
              <Input
                value={form.secCertificateUrl}
                onChange={(e) => setForm((f) => ({ ...f, secCertificateUrl: e.target.value }))}
                placeholder="https://storage.example.com/sec-cert.pdf"
                className="bg-purple-800/40 border-purple-700 text-white placeholder:text-purple-500 mt-1"
              />
            </div>
            <div>
              <Label className="text-purple-200 text-sm">CBN Approval URL (optional)</Label>
              <Input
                value={form.cbnApprovalUrl}
                onChange={(e) => setForm((f) => ({ ...f, cbnApprovalUrl: e.target.value }))}
                placeholder="https://storage.example.com/cbn-approval.pdf"
                className="bg-purple-800/40 border-purple-700 text-white placeholder:text-purple-500 mt-1"
              />
            </div>
            <div>
              <Label className="text-purple-200 text-sm">CAC Document URL (optional)</Label>
              <Input
                value={form.cacDocUrl}
                onChange={(e) => setForm((f) => ({ ...f, cacDocUrl: e.target.value }))}
                placeholder="https://storage.example.com/cac.pdf"
                className="bg-purple-800/40 border-purple-700 text-white placeholder:text-purple-500 mt-1"
              />
            </div>
            <Card className="bg-purple-800/20 border-purple-700 border-dashed">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-purple-400">
                  Upload documents to secure cloud storage first, then paste the URL above.
                  Accepted: PDF, JPG, PNG (max 5MB each).
                </p>
              </CardContent>
            </Card>
            {form.secCertificateUrl && (
              <KycAnalysisPanel
                documentUrl={form.secCertificateUrl}
                stakeholderType="BROKER"
              />
            )}
          </div>
          <Button
            onClick={handleKYC}
            disabled={!form.secLicenseNumber || !form.secCertificateUrl || kycMutation.isPending}
            className="w-full mt-6 bg-purple-500 hover:bg-purple-400 text-white font-semibold py-3 rounded-xl"
          >
            {kycMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting...</>
            ) : (
              <>Submit for Review <ChevronRight className="w-4 h-4 ml-1" /></>
            )}
          </Button>
        </div>
      )}

      {/* Step 5: Complete */}
      {step === 5 && (
        <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
          <div className="w-20 h-20 rounded-full bg-purple-500/20 border border-purple-400/30 flex items-center justify-center mb-6">
            <CheckCircle2 className="w-10 h-10 text-purple-400" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Application Submitted!</h2>
          <p className="text-purple-300 text-sm mb-6 max-w-xs">
            Your broker KYC is under review by the NEXCOM compliance team. Approval typically takes 2–5 business days.
          </p>
          <div className="w-full max-w-xs space-y-3">
            <Button
              onClick={() => navigate("/broker-dashboard")}
              className="w-full bg-purple-500 hover:bg-purple-400 text-white font-semibold py-3 rounded-xl"
            >
              Go to Dashboard
            </Button>
            <Button
              onClick={() => navigate("/")}
              variant="outline"
              className="w-full border-purple-600 text-purple-300 hover:bg-purple-800 bg-transparent py-3 rounded-xl"
            >
              Back to Exchange
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
