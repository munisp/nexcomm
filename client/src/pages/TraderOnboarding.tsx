import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  User,
  BarChart3,
  Shield,
  Wallet,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { KycAnalysisPanel } from "@/components/KycAnalysisPanel";

const STEPS = [
  { id: 1, title: "Welcome", icon: TrendingUp },
  { id: 2, title: "Registration", icon: User },
  { id: 3, title: "Trading Profile", icon: BarChart3 },
  { id: 4, title: "KYC Documents", icon: Shield },
  { id: 5, title: "Bank Setup", icon: Wallet },
  { id: 6, title: "Complete", icon: CheckCircle2 },
];

const MARKETS = ["Commodities", "Forex", "Equities", "Derivatives", "Options", "Futures"];
const EXPERIENCE_LEVELS = [
  { value: "BEGINNER", label: "Beginner", desc: "< 1 year" },
  { value: "INTERMEDIATE", label: "Intermediate", desc: "1–3 years" },
  { value: "EXPERIENCED", label: "Experienced", desc: "3–7 years" },
  { value: "PROFESSIONAL", label: "Professional", desc: "7+ years" },
];
const CAPITAL_RANGES = ["< ₦500K", "₦500K–₦2M", "₦2M–₦10M", "₦10M–₦50M", "> ₦50M"];
const RISK_PROFILES = [
  { value: "CONSERVATIVE", label: "Conservative", desc: "Capital preservation focus" },
  { value: "MODERATE", label: "Moderate", desc: "Balanced risk/reward" },
  { value: "AGGRESSIVE", label: "Aggressive", desc: "High-growth oriented" },
];

export default function TraderOnboarding() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);
  const [traderId, setTraderId] = useState<number | null>(null);

  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    nin: "",
    bvn: "",
    email: "",
    address: "",
    state: "",
    lga: "",
    tradingExperience: "BEGINNER" as "BEGINNER" | "INTERMEDIATE" | "EXPERIENCED" | "PROFESSIONAL",
    preferredMarkets: [] as string[],
    capitalRange: "",
    riskProfile: "MODERATE" as "CONSERVATIVE" | "MODERATE" | "AGGRESSIVE",
    idDocumentUrl: "",
    proofOfAddressUrl: "",
    bankStatementUrl: "",
    bankName: "",
    accountNumber: "",
  });

  const registerMutation = trpc.trader.registerTrader.useMutation();
  const kycMutation = trpc.trader.submitTraderKYC.useMutation();

  const toggleMarket = (m: string) => {
    setForm((f) => ({
      ...f,
      preferredMarkets: f.preferredMarkets.includes(m)
        ? f.preferredMarkets.filter((x) => x !== m)
        : [...f.preferredMarkets, m],
    }));
  };

  const handleRegister = async () => {
    try {
      const result = await registerMutation.mutateAsync({
        fullName: form.fullName,
        phone: form.phone,
        nin: form.nin || undefined,
        bvn: form.bvn || undefined,
        email: form.email || undefined,
        address: form.address || undefined,
        state: form.state || undefined,
        lga: form.lga || undefined,
        tradingExperience: form.tradingExperience,
        preferredMarkets: form.preferredMarkets,
        capitalRange: form.capitalRange || undefined,
        riskProfile: form.riskProfile,
      });
      setTraderId((result as any).id);
      setStep(4);
    } catch (e: any) {
      if (e?.message?.includes("already exists")) {
        toast.info("Already registered — proceeding to KYC step");
        setStep(4);
      } else {
        toast.error(e?.message ?? "Registration failed");
      }
    }
  };

  const handleKYC = async () => {
    if (!form.idDocumentUrl || !form.proofOfAddressUrl) {
      toast.error("Please provide document URLs");
      return;
    }
    try {
      await kycMutation.mutateAsync({
        idDocumentUrl: form.idDocumentUrl,
        proofOfAddressUrl: form.proofOfAddressUrl,
        bankStatementUrl: form.bankStatementUrl || undefined,
        bankName: form.bankName || undefined,
        accountNumber: form.accountNumber || undefined,
      });
      setStep(6);
    } catch (e: any) {
      toast.error(e?.message ?? "KYC submission failed");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-950 to-blue-900 text-white">
      {/* Step 1: Welcome */}
      {step === 1 && (
        <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
          <div className="w-20 h-20 rounded-2xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center mb-6">
            <TrendingUp className="w-10 h-10 text-blue-400" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Trader Onboarding</h1>
          <p className="text-blue-300 text-lg mb-2">NEXCOM Exchange</p>
          <p className="text-blue-400 text-sm mb-8 max-w-xs">
            Access Nigeria's premier commodity and derivatives exchange. Trade spot, futures, and options markets.
          </p>
          <div className="w-full max-w-xs space-y-3 mb-8">
            {["Commodity & Forex Markets", "Futures & Options Trading", "Real-time Price Feeds", "Institutional-grade Risk Tools"].map((f) => (
              <div key={f} className="flex items-center gap-3 text-left">
                <CheckCircle2 className="w-4 h-4 text-blue-400 flex-shrink-0" />
                <span className="text-sm text-blue-200">{f}</span>
              </div>
            ))}
          </div>
          <Button onClick={() => setStep(2)} className="w-full max-w-xs bg-blue-500 hover:bg-blue-400 text-white font-semibold py-3 rounded-xl">
            Get Started <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
          <button onClick={() => navigate("/trader-dashboard")} className="mt-4 text-blue-400 text-sm underline">
            Already registered? View dashboard
          </button>
        </div>
      )}

      {/* Step 2: Personal Registration */}
      {step === 2 && (
        <div className="px-4 py-6">
          <button onClick={() => setStep(1)} className="mb-4 flex items-center gap-1 text-blue-400 text-sm">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="mb-6">
            <Badge className="bg-blue-800 text-blue-200 mb-2">Step 1 of 4</Badge>
            <h2 className="text-2xl font-bold">Personal Details</h2>
            <p className="text-blue-300 text-sm">Your identity information for account setup</p>
          </div>
          <div className="space-y-4">
            <div>
              <Label className="text-blue-200 text-sm">Full Name *</Label>
              <Input
                value={form.fullName}
                onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                placeholder="John Adeyemi"
                className="bg-blue-800/40 border-blue-700 text-white placeholder:text-blue-500 mt-1"
              />
            </div>
            <div>
              <Label className="text-blue-200 text-sm">Phone Number *</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="+234 801 234 5678"
                className="bg-blue-800/40 border-blue-700 text-white placeholder:text-blue-500 mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-blue-200 text-sm">NIN</Label>
                <Input
                  value={form.nin}
                  onChange={(e) => setForm((f) => ({ ...f, nin: e.target.value }))}
                  placeholder="12345678901"
                  className="bg-blue-800/40 border-blue-700 text-white placeholder:text-blue-500 mt-1"
                />
              </div>
              <div>
                <Label className="text-blue-200 text-sm">BVN</Label>
                <Input
                  value={form.bvn}
                  onChange={(e) => setForm((f) => ({ ...f, bvn: e.target.value }))}
                  placeholder="22345678901"
                  className="bg-blue-800/40 border-blue-700 text-white placeholder:text-blue-500 mt-1"
                />
              </div>
            </div>
            <div>
              <Label className="text-blue-200 text-sm">Email Address</Label>
              <Input
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="john@example.com"
                type="email"
                className="bg-blue-800/40 border-blue-700 text-white placeholder:text-blue-500 mt-1"
              />
            </div>
            <div>
              <Label className="text-blue-200 text-sm">State</Label>
              <Input
                value={form.state}
                onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                placeholder="Lagos"
                className="bg-blue-800/40 border-blue-700 text-white placeholder:text-blue-500 mt-1"
              />
            </div>
          </div>
          <Button
            onClick={() => setStep(3)}
            disabled={!form.fullName || !form.phone}
            className="w-full mt-6 bg-blue-500 hover:bg-blue-400 text-white font-semibold py-3 rounded-xl"
          >
            Continue <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Step 3: Trading Profile */}
      {step === 3 && (
        <div className="px-4 py-6">
          <button onClick={() => setStep(2)} className="mb-4 flex items-center gap-1 text-blue-400 text-sm">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="mb-6">
            <Badge className="bg-blue-800 text-blue-200 mb-2">Step 2 of 4</Badge>
            <h2 className="text-2xl font-bold">Trading Profile</h2>
            <p className="text-blue-300 text-sm">Tell us about your trading background</p>
          </div>
          <div className="space-y-5">
            <div>
              <Label className="text-blue-200 text-sm mb-2 block">Trading Experience</Label>
              <div className="grid grid-cols-2 gap-2">
                {EXPERIENCE_LEVELS.map((lvl) => (
                  <button
                    key={lvl.value}
                    onClick={() => setForm((f) => ({ ...f, tradingExperience: lvl.value as any }))}
                    className={`p-3 rounded-xl border text-left transition-colors ${
                      form.tradingExperience === lvl.value
                        ? "border-blue-400 bg-blue-500/20"
                        : "border-blue-700 bg-blue-800/30 hover:border-blue-500"
                    }`}
                  >
                    <p className="text-sm font-medium text-white">{lvl.label}</p>
                    <p className="text-xs text-blue-400">{lvl.desc}</p>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-blue-200 text-sm mb-2 block">Preferred Markets</Label>
              <div className="flex flex-wrap gap-2">
                {MARKETS.map((m) => (
                  <button
                    key={m}
                    onClick={() => toggleMarket(m)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      form.preferredMarkets.includes(m)
                        ? "bg-blue-500 border-blue-400 text-white"
                        : "border-blue-700 text-blue-300 hover:border-blue-500"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-blue-200 text-sm mb-2 block">Capital Range</Label>
              <div className="grid grid-cols-2 gap-2">
                {CAPITAL_RANGES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setForm((f) => ({ ...f, capitalRange: r }))}
                    className={`p-2.5 rounded-xl border text-sm transition-colors ${
                      form.capitalRange === r
                        ? "border-blue-400 bg-blue-500/20 text-white"
                        : "border-blue-700 text-blue-300 hover:border-blue-500"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-blue-200 text-sm mb-2 block">Risk Profile</Label>
              <div className="space-y-2">
                {RISK_PROFILES.map((rp) => (
                  <button
                    key={rp.value}
                    onClick={() => setForm((f) => ({ ...f, riskProfile: rp.value as any }))}
                    className={`w-full p-3 rounded-xl border text-left transition-colors ${
                      form.riskProfile === rp.value
                        ? "border-blue-400 bg-blue-500/20"
                        : "border-blue-700 bg-blue-800/30 hover:border-blue-500"
                    }`}
                  >
                    <p className="text-sm font-medium text-white">{rp.label}</p>
                    <p className="text-xs text-blue-400">{rp.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <Button
            onClick={handleRegister}
            disabled={registerMutation.isPending}
            className="w-full mt-6 bg-blue-500 hover:bg-blue-400 text-white font-semibold py-3 rounded-xl"
          >
            {registerMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
            ) : (
              <>Continue <ChevronRight className="w-4 h-4 ml-1" /></>
            )}
          </Button>
        </div>
      )}

      {/* Step 4: KYC Documents */}
      {step === 4 && (
        <div className="px-4 py-6">
          <button onClick={() => setStep(3)} className="mb-4 flex items-center gap-1 text-blue-400 text-sm">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="mb-6">
            <Badge className="bg-blue-800 text-blue-200 mb-2">Step 3 of 4</Badge>
            <h2 className="text-2xl font-bold">KYC Documents</h2>
            <p className="text-blue-300 text-sm">Upload identity and address verification documents</p>
          </div>
          <div className="space-y-4">
            {[
              { key: "idDocumentUrl", label: "Government-issued ID URL *", placeholder: "https://storage.example.com/id.jpg" },
              { key: "proofOfAddressUrl", label: "Proof of Address URL *", placeholder: "https://storage.example.com/address.pdf" },
              { key: "bankStatementUrl", label: "Bank Statement URL (optional)", placeholder: "https://storage.example.com/statement.pdf" },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <Label className="text-blue-200 text-sm">{label}</Label>
                <Input
                  value={(form as any)[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="bg-blue-800/40 border-blue-700 text-white placeholder:text-blue-500 mt-1"
                />
              </div>
            ))}
            <Card className="bg-blue-800/20 border-blue-700 border-dashed">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-blue-400">
                  Upload documents to secure cloud storage first, then paste the URL above.
                  Accepted: JPG, PNG, PDF (max 5MB each).
                </p>
              </CardContent>
            </Card>
            {form.idDocumentUrl && (
              <KycAnalysisPanel
                documentUrl={form.idDocumentUrl}
                stakeholderType="TRADER"
              />
            )}
          </div>
          <Button
            onClick={() => setStep(5)}
            disabled={!form.idDocumentUrl || !form.proofOfAddressUrl}
            className="w-full mt-6 bg-blue-500 hover:bg-blue-400 text-white font-semibold py-3 rounded-xl"
          >
            Continue <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Step 5: Bank Setup */}
      {step === 5 && (
        <div className="px-4 py-6">
          <button onClick={() => setStep(4)} className="mb-4 flex items-center gap-1 text-blue-400 text-sm">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="mb-6">
            <Badge className="bg-blue-800 text-blue-200 mb-2">Step 4 of 4</Badge>
            <h2 className="text-2xl font-bold">Bank Account Setup</h2>
            <p className="text-blue-300 text-sm">Link your bank account for deposits and withdrawals</p>
          </div>
          <div className="space-y-4">
            <div>
              <Label className="text-blue-200 text-sm">Bank Name</Label>
              <Input
                value={form.bankName}
                onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                placeholder="First Bank of Nigeria"
                className="bg-blue-800/40 border-blue-700 text-white placeholder:text-blue-500 mt-1"
              />
            </div>
            <div>
              <Label className="text-blue-200 text-sm">Account Number</Label>
              <Input
                value={form.accountNumber}
                onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))}
                placeholder="0123456789"
                className="bg-blue-800/40 border-blue-700 text-white placeholder:text-blue-500 mt-1"
              />
            </div>
          </div>
          <Button
            onClick={handleKYC}
            disabled={kycMutation.isPending}
            className="w-full mt-6 bg-blue-500 hover:bg-blue-400 text-white font-semibold py-3 rounded-xl"
          >
            {kycMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting...</>
            ) : (
              <>Submit KYC <ChevronRight className="w-4 h-4 ml-1" /></>
            )}
          </Button>
        </div>
      )}

      {/* Step 6: Complete */}
      {step === 6 && (
        <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
          <div className="w-20 h-20 rounded-full bg-blue-500/20 border border-blue-400/30 flex items-center justify-center mb-6">
            <CheckCircle2 className="w-10 h-10 text-blue-400" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Application Submitted!</h2>
          <p className="text-blue-300 text-sm mb-6 max-w-xs">
            Your trader KYC is under review. You will be notified once approved. This typically takes 1–3 business days.
          </p>
          <div className="w-full max-w-xs space-y-3">
            <Button
              onClick={() => navigate("/trader-dashboard")}
              className="w-full bg-blue-500 hover:bg-blue-400 text-white font-semibold py-3 rounded-xl"
            >
              Go to Dashboard
            </Button>
            <Button
              onClick={() => navigate("/")}
              variant="outline"
              className="w-full border-blue-600 text-blue-300 hover:bg-blue-800 bg-transparent py-3 rounded-xl"
            >
              Back to Exchange
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
