import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Building2,
  BarChart3,
  Shield,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { KycAnalysisPanel } from "@/components/KycAnalysisPanel";

const INSTRUMENTS = [
  "Maize Futures", "Sorghum Futures", "Soybeans Futures", "Wheat Futures",
  "Cocoa Futures", "Sesame Futures", "Maize Options", "Soybeans Options",
  "USD/NGN Futures", "Commodity Index",
];

export default function MarketMakerOnboarding() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);

  const [form, setForm] = useState({
    firmName: "",
    tradingDesk: "",
    contactPhone: "",
    contactEmail: "",
    yearsOfOperation: "",
    regulatoryRegistrations: "",
    instrumentObligations: [] as string[],
    minQuoteSizeLots: "",
    maxSpreadBps: "",
    capitalCommitmentNgn: "",
    performanceBondNgn: "",
    firmRegistrationUrl: "",
    tradingLicenseUrl: "",
    capitalAdequacyUrl: "",
  });

  const registerMutation = trpc.marketMakerOnboarding.registerMarketMaker.useMutation();
  const kycMutation = trpc.marketMakerOnboarding.submitMarketMakerKYC.useMutation();

  const toggleInstrument = (inst: string) => {
    setForm((f) => ({
      ...f,
      instrumentObligations: f.instrumentObligations.includes(inst)
        ? f.instrumentObligations.filter((x) => x !== inst)
        : [...f.instrumentObligations, inst],
    }));
  };

  const handleRegister = async () => {
    try {
      await registerMutation.mutateAsync({
        firmName: form.firmName,
        tradingDesk: form.tradingDesk || undefined,
        contactPhone: form.contactPhone || undefined,
        contactEmail: form.contactEmail || undefined,
        yearsOfOperation: form.yearsOfOperation ? parseInt(form.yearsOfOperation) : undefined,
        regulatoryRegistrations: form.regulatoryRegistrations || undefined,
        instrumentObligations: form.instrumentObligations,
        minQuoteSizeLots: form.minQuoteSizeLots ? parseFloat(form.minQuoteSizeLots) : undefined,
        maxSpreadBps: form.maxSpreadBps ? parseFloat(form.maxSpreadBps) : undefined,
        capitalCommitmentNgn: form.capitalCommitmentNgn ? parseFloat(form.capitalCommitmentNgn) : undefined,
        performanceBondNgn: form.performanceBondNgn ? parseFloat(form.performanceBondNgn) : undefined,
      });
      setStep(4);
    } catch (e: any) {
      if (e?.message?.includes("already exists")) {
        toast.info("Market maker profile already exists — proceeding to KYC");
        setStep(4);
      } else {
        toast.error(e?.message ?? "Registration failed");
      }
    }
  };

  const handleKYC = async () => {
    if (!form.firmRegistrationUrl || !form.tradingLicenseUrl) {
      toast.error("Firm registration and trading license documents are required");
      return;
    }
    try {
      await kycMutation.mutateAsync({
        firmRegistrationUrl: form.firmRegistrationUrl,
        tradingLicenseUrl: form.tradingLicenseUrl,
        capitalAdequacyUrl: form.capitalAdequacyUrl || undefined,
      });
      setStep(6);
    } catch (e: any) {
      toast.error(e?.message ?? "KYC submission failed");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-cyan-950 to-cyan-900 text-white">
      {/* Step 1: Welcome */}
      {step === 1 && (
        <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
          <div className="w-20 h-20 rounded-2xl bg-cyan-500/20 border border-cyan-400/30 flex items-center justify-center mb-6">
            <Activity className="w-10 h-10 text-cyan-400" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Market Maker</h1>
          <p className="text-cyan-300 text-lg mb-2">NEXCOM Exchange</p>
          <p className="text-cyan-400 text-sm mb-8 max-w-xs">
            Become a designated market maker on NEXCOM Exchange. Provide liquidity, earn rebates, and access preferential fee structures across commodity and derivatives markets.
          </p>
          <div className="w-full max-w-xs space-y-3 mb-8">
            {["Maker Rebates on Executed Quotes", "Priority Order Routing", "Reduced Margin Requirements", "Dedicated Risk Management Tools"].map((f) => (
              <div key={f} className="flex items-center gap-3 text-left">
                <CheckCircle2 className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                <span className="text-sm text-cyan-200">{f}</span>
              </div>
            ))}
          </div>
          <Button onClick={() => setStep(2)} className="w-full max-w-xs bg-cyan-500 hover:bg-cyan-400 text-white font-semibold py-3 rounded-xl">
            Apply Now <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
          <button onClick={() => navigate("/market-maker-dashboard")} className="mt-4 text-cyan-400 text-sm underline">
            Already registered? View dashboard
          </button>
        </div>
      )}

      {/* Step 2: Firm Profile */}
      {step === 2 && (
        <div className="px-4 py-6">
          <button onClick={() => setStep(1)} className="mb-4 flex items-center gap-1 text-cyan-400 text-sm">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="mb-6">
            <Badge className="bg-cyan-800 text-cyan-200 mb-2">Step 1 of 4</Badge>
            <h2 className="text-2xl font-bold">Firm Profile</h2>
            <p className="text-cyan-300 text-sm">Tell us about your trading firm</p>
          </div>
          <div className="space-y-4">
            <div>
              <Label className="text-cyan-200 text-sm">Firm Name *</Label>
              <Input
                value={form.firmName}
                onChange={(e) => setForm((f) => ({ ...f, firmName: e.target.value }))}
                placeholder="Apex Trading Ltd"
                className="bg-cyan-800/40 border-cyan-700 text-white placeholder:text-cyan-500 mt-1"
              />
            </div>
            <div>
              <Label className="text-cyan-200 text-sm">Trading Desk Name</Label>
              <Input
                value={form.tradingDesk}
                onChange={(e) => setForm((f) => ({ ...f, tradingDesk: e.target.value }))}
                placeholder="Commodities Desk"
                className="bg-cyan-800/40 border-cyan-700 text-white placeholder:text-cyan-500 mt-1"
              />
            </div>
            <div>
              <Label className="text-cyan-200 text-sm">Contact Phone</Label>
              <Input
                value={form.contactPhone}
                onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
                placeholder="+234 801 234 5678"
                className="bg-cyan-800/40 border-cyan-700 text-white placeholder:text-cyan-500 mt-1"
              />
            </div>
            <div>
              <Label className="text-cyan-200 text-sm">Contact Email</Label>
              <Input
                value={form.contactEmail}
                onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
                placeholder="trading@apextrading.com"
                type="email"
                className="bg-cyan-800/40 border-cyan-700 text-white placeholder:text-cyan-500 mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-cyan-200 text-sm">Years Operating</Label>
                <Input
                  value={form.yearsOfOperation}
                  onChange={(e) => setForm((f) => ({ ...f, yearsOfOperation: e.target.value }))}
                  placeholder="3"
                  type="number"
                  className="bg-cyan-800/40 border-cyan-700 text-white placeholder:text-cyan-500 mt-1"
                />
              </div>
              <div>
                <Label className="text-cyan-200 text-sm">Regulatory Registrations</Label>
                <Input
                  value={form.regulatoryRegistrations}
                  onChange={(e) => setForm((f) => ({ ...f, regulatoryRegistrations: e.target.value }))}
                  placeholder="SEC, CBN"
                  className="bg-cyan-800/40 border-cyan-700 text-white placeholder:text-cyan-500 mt-1"
                />
              </div>
            </div>
          </div>
          <Button
            onClick={() => setStep(3)}
            disabled={!form.firmName}
            className="w-full mt-6 bg-cyan-500 hover:bg-cyan-400 text-white font-semibold py-3 rounded-xl"
          >
            Continue <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Step 3: Obligations & Capital */}
      {step === 3 && (
        <div className="px-4 py-6">
          <button onClick={() => setStep(2)} className="mb-4 flex items-center gap-1 text-cyan-400 text-sm">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="mb-6">
            <Badge className="bg-cyan-800 text-cyan-200 mb-2">Step 2 of 4</Badge>
            <h2 className="text-2xl font-bold">Obligations & Capital</h2>
            <p className="text-cyan-300 text-sm">Define your market-making commitments</p>
          </div>
          <div className="space-y-5">
            <div>
              <Label className="text-cyan-200 text-sm mb-2 block">Instrument Obligations</Label>
              <div className="flex flex-wrap gap-2">
                {INSTRUMENTS.map((inst) => (
                  <button
                    key={inst}
                    onClick={() => toggleInstrument(inst)}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                      form.instrumentObligations.includes(inst)
                        ? "bg-cyan-500 border-cyan-400 text-white"
                        : "border-cyan-700 text-cyan-300 hover:border-cyan-500"
                    }`}
                  >
                    {inst}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-cyan-200 text-sm">Min Quote Size (lots)</Label>
                <Input
                  value={form.minQuoteSizeLots}
                  onChange={(e) => setForm((f) => ({ ...f, minQuoteSizeLots: e.target.value }))}
                  placeholder="10"
                  type="number"
                  className="bg-cyan-800/40 border-cyan-700 text-white placeholder:text-cyan-500 mt-1"
                />
              </div>
              <div>
                <Label className="text-cyan-200 text-sm">Max Spread (bps)</Label>
                <Input
                  value={form.maxSpreadBps}
                  onChange={(e) => setForm((f) => ({ ...f, maxSpreadBps: e.target.value }))}
                  placeholder="50"
                  type="number"
                  className="bg-cyan-800/40 border-cyan-700 text-white placeholder:text-cyan-500 mt-1"
                />
              </div>
            </div>
            <div>
              <Label className="text-cyan-200 text-sm">Capital Commitment (NGN)</Label>
              <Input
                value={form.capitalCommitmentNgn}
                onChange={(e) => setForm((f) => ({ ...f, capitalCommitmentNgn: e.target.value }))}
                placeholder="100000000"
                type="number"
                className="bg-cyan-800/40 border-cyan-700 text-white placeholder:text-cyan-500 mt-1"
              />
            </div>
            <div>
              <Label className="text-cyan-200 text-sm">Performance Bond (NGN)</Label>
              <Input
                value={form.performanceBondNgn}
                onChange={(e) => setForm((f) => ({ ...f, performanceBondNgn: e.target.value }))}
                placeholder="10000000"
                type="number"
                className="bg-cyan-800/40 border-cyan-700 text-white placeholder:text-cyan-500 mt-1"
              />
            </div>
          </div>
          <Button
            onClick={handleRegister}
            disabled={registerMutation.isPending}
            className="w-full mt-6 bg-cyan-500 hover:bg-cyan-400 text-white font-semibold py-3 rounded-xl"
          >
            {registerMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
            ) : (
              <>Continue to Documentation <ChevronRight className="w-4 h-4 ml-1" /></>
            )}
          </Button>
        </div>
      )}

      {/* Step 4: KYC Documents */}
      {step === 4 && (
        <div className="px-4 py-6">
          <button onClick={() => setStep(3)} className="mb-4 flex items-center gap-1 text-cyan-400 text-sm">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="mb-6">
            <Badge className="bg-cyan-800 text-cyan-200 mb-2">Step 3 of 4</Badge>
            <h2 className="text-2xl font-bold">Documentation</h2>
            <p className="text-cyan-300 text-sm">Upload firm registration and trading license documents</p>
          </div>
          <div className="space-y-4">
            <div>
              <Label className="text-cyan-200 text-sm">Firm Registration Document URL *</Label>
              <Input
                value={form.firmRegistrationUrl}
                onChange={(e) => setForm((f) => ({ ...f, firmRegistrationUrl: e.target.value }))}
                placeholder="https://storage.example.com/firm-reg.pdf"
                className="bg-cyan-800/40 border-cyan-700 text-white placeholder:text-cyan-500 mt-1"
              />
            </div>
            <div>
              <Label className="text-cyan-200 text-sm">Trading License URL *</Label>
              <Input
                value={form.tradingLicenseUrl}
                onChange={(e) => setForm((f) => ({ ...f, tradingLicenseUrl: e.target.value }))}
                placeholder="https://storage.example.com/trading-license.pdf"
                className="bg-cyan-800/40 border-cyan-700 text-white placeholder:text-cyan-500 mt-1"
              />
            </div>
            <div>
              <Label className="text-cyan-200 text-sm">Capital Adequacy Report URL (optional)</Label>
              <Input
                value={form.capitalAdequacyUrl}
                onChange={(e) => setForm((f) => ({ ...f, capitalAdequacyUrl: e.target.value }))}
                placeholder="https://storage.example.com/capital-adequacy.pdf"
                className="bg-cyan-800/40 border-cyan-700 text-white placeholder:text-cyan-500 mt-1"
              />
            </div>
            <Card className="bg-cyan-800/20 border-cyan-700 border-dashed">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-cyan-400">
                  Upload all documents to secure cloud storage first, then paste the URL.
                  Accepted: PDF, JPG, PNG (max 5MB each).
                </p>
              </CardContent>
            </Card>
            {form.firmRegistrationUrl && (
              <KycAnalysisPanel
                documentUrl={form.firmRegistrationUrl}
                stakeholderType="MARKET_MAKER"
              />
            )}
          </div>
          <Button
            onClick={handleKYC}
            disabled={!form.firmRegistrationUrl || !form.tradingLicenseUrl || kycMutation.isPending}
            className="w-full mt-6 bg-cyan-500 hover:bg-cyan-400 text-white font-semibold py-3 rounded-xl"
          >
            {kycMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting...</>
            ) : (
              <>Submit Application <ChevronRight className="w-4 h-4 ml-1" /></>
            )}
          </Button>
        </div>
      )}

      {/* Step 6: Complete */}
      {step === 6 && (
        <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
          <div className="w-20 h-20 rounded-full bg-cyan-500/20 border border-cyan-400/30 flex items-center justify-center mb-6">
            <CheckCircle2 className="w-10 h-10 text-cyan-400" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Application Submitted!</h2>
          <p className="text-cyan-300 text-sm mb-6 max-w-xs">
            Your market maker application is under review by the NEXCOM Exchange Committee. The review process typically takes 5–10 business days.
          </p>
          <div className="w-full max-w-xs space-y-3">
            <Button
              onClick={() => navigate("/market-maker-dashboard")}
              className="w-full bg-cyan-500 hover:bg-cyan-400 text-white font-semibold py-3 rounded-xl"
            >
              Go to Dashboard
            </Button>
            <Button
              onClick={() => navigate("/")}
              variant="outline"
              className="w-full border-cyan-600 text-cyan-300 hover:bg-cyan-800 bg-transparent py-3 rounded-xl"
            >
              Back to Exchange
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
