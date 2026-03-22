/**
 * NEXCOM Exchange — Broker Client Onboarding Wizard
 *
 * A multi-step wizard for brokers to onboard new institutional or retail clients.
 * Steps:
 *   1. Client Type  — Individual / Corporate / Institutional
 *   2. Basic Info   — Name, email, phone
 *   3. Account Setup — Account type, risk profile, trading limits
 *   4. Notes & Docs — Internal notes, document checklist
 *   5. Confirmation — Review and submit
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  User,
  Building2,
  Landmark,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  ArrowLeft,
  Briefcase,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

type ClientType = "INDIVIDUAL" | "CORPORATE" | "INSTITUTIONAL";

interface WizardState {
  clientType: ClientType | "";
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  accountType: string;
  riskProfile: string;
  notes: string;
}

const INITIAL_STATE: WizardState = {
  clientType: "",
  clientName: "",
  clientEmail: "",
  clientPhone: "",
  accountType: "INDIVIDUAL",
  riskProfile: "MODERATE",
  notes: "",
};

// ── Step components ───────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              i + 1 < current
                ? "bg-purple-500 text-white"
                : i + 1 === current
                ? "bg-purple-600 text-white ring-2 ring-purple-400"
                : "bg-purple-900/40 text-purple-500"
            }`}
          >
            {i + 1 < current ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
          </div>
          {i < total - 1 && (
            <div className={`h-0.5 w-8 ${i + 1 < current ? "bg-purple-500" : "bg-purple-900/40"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// Step 1: Client Type
function Step1ClientType({
  value,
  onChange,
}: {
  value: ClientType | "";
  onChange: (v: ClientType) => void;
}) {
  const options: { type: ClientType; label: string; desc: string; Icon: React.ElementType }[] = [
    {
      type: "INDIVIDUAL",
      label: "Individual",
      desc: "Retail investor or sole trader",
      Icon: User,
    },
    {
      type: "CORPORATE",
      label: "Corporate",
      desc: "Limited company or partnership",
      Icon: Building2,
    },
    {
      type: "INSTITUTIONAL",
      label: "Institutional",
      desc: "Bank, fund, or exchange member",
      Icon: Landmark,
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-purple-300">Select the type of client you are onboarding.</p>
      <div className="grid gap-3">
        {options.map(({ type, label, desc, Icon }) => (
          <button
            key={type}
            onClick={() => onChange(type)}
            className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-left ${
              value === type
                ? "border-purple-500 bg-purple-800/40 ring-1 ring-purple-500"
                : "border-purple-800/50 bg-purple-900/20 hover:bg-purple-800/20"
            }`}
          >
            <div className="w-10 h-10 rounded-lg bg-purple-800/60 flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5 text-purple-300" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{label}</p>
              <p className="text-xs text-purple-400">{desc}</p>
            </div>
            {value === type && <CheckCircle2 className="w-5 h-5 text-purple-400 ml-auto" />}
          </button>
        ))}
      </div>
    </div>
  );
}

// Step 2: Basic Info
function Step2BasicInfo({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (k: keyof WizardState, v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-purple-300">Enter the client's contact details.</p>
      <div className="space-y-3">
        <div>
          <Label className="text-purple-300 text-xs">Full Name / Company Name *</Label>
          <Input
            value={state.clientName}
            onChange={e => onChange("clientName", e.target.value)}
            placeholder="e.g. Adebayo Okafor or Lagos Grain Trading Ltd"
            className="bg-purple-900/40 border-purple-700 text-white mt-1"
          />
        </div>
        <div>
          <Label className="text-purple-300 text-xs">Email Address</Label>
          <Input
            type="email"
            value={state.clientEmail}
            onChange={e => onChange("clientEmail", e.target.value)}
            placeholder="client@example.com"
            className="bg-purple-900/40 border-purple-700 text-white mt-1"
          />
        </div>
        <div>
          <Label className="text-purple-300 text-xs">Phone Number</Label>
          <Input
            type="tel"
            value={state.clientPhone}
            onChange={e => onChange("clientPhone", e.target.value)}
            placeholder="+234 801 234 5678"
            className="bg-purple-900/40 border-purple-700 text-white mt-1"
          />
        </div>
      </div>
    </div>
  );
}

// Step 3: Account Setup
function Step3AccountSetup({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (k: keyof WizardState, v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-purple-300">Configure the client's trading account parameters.</p>
      <div className="space-y-3">
        <div>
          <Label className="text-purple-300 text-xs">Account Type</Label>
          <Select value={state.accountType} onValueChange={v => onChange("accountType", v)}>
            <SelectTrigger className="bg-purple-900/40 border-purple-700 text-white mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-purple-950 border-purple-700">
              <SelectItem value="INDIVIDUAL">Individual</SelectItem>
              <SelectItem value="CORPORATE">Corporate</SelectItem>
              <SelectItem value="INSTITUTIONAL">Institutional</SelectItem>
              <SelectItem value="PROPRIETARY">Proprietary Trading</SelectItem>
              <SelectItem value="MARKET_MAKER">Market Maker</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-purple-300 text-xs">Risk Profile</Label>
          <Select value={state.riskProfile} onValueChange={v => onChange("riskProfile", v)}>
            <SelectTrigger className="bg-purple-900/40 border-purple-700 text-white mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-purple-950 border-purple-700">
              <SelectItem value="CONSERVATIVE">Conservative</SelectItem>
              <SelectItem value="MODERATE">Moderate</SelectItem>
              <SelectItem value="AGGRESSIVE">Aggressive</SelectItem>
              <SelectItem value="SPECULATIVE">Speculative</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

// Step 4: Notes & Document Checklist
function Step4Notes({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (k: keyof WizardState, v: string) => void;
}) {
  const docs =
    state.clientType === "INSTITUTIONAL"
      ? ["Certificate of Incorporation", "Board Resolution", "Authorised Signatory List", "AML Policy", "Proof of Address"]
      : state.clientType === "CORPORATE"
      ? ["Certificate of Incorporation", "CAC Form CO2/CO7", "Director ID", "Proof of Address"]
      : ["Government-issued ID", "BVN Verification", "Proof of Address", "Signed Client Agreement"];

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-purple-300 mb-2">Required Documents Checklist</p>
        <div className="space-y-1.5">
          {docs.map(doc => (
            <div key={doc} className="flex items-center gap-2 text-sm text-purple-200">
              <div className="w-4 h-4 rounded border border-purple-600 bg-purple-900/30 flex items-center justify-center">
                <CheckCircle2 className="w-3 h-3 text-purple-400" />
              </div>
              {doc}
            </div>
          ))}
        </div>
      </div>
      <div>
        <Label className="text-purple-300 text-xs">Internal Notes (optional)</Label>
        <Textarea
          value={state.notes}
          onChange={e => onChange("notes", e.target.value)}
          placeholder="Referral source, special instructions, compliance notes..."
          className="bg-purple-900/40 border-purple-700 text-white mt-1 h-24 resize-none"
        />
      </div>
    </div>
  );
}

// Step 5: Confirmation
function Step5Confirm({ state }: { state: WizardState }) {
  const rows = [
    { label: "Client Type", value: state.clientType },
    { label: "Name", value: state.clientName },
    { label: "Email", value: state.clientEmail || "—" },
    { label: "Phone", value: state.clientPhone || "—" },
    { label: "Account Type", value: state.accountType },
    { label: "Risk Profile", value: state.riskProfile },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-purple-300">Review the details before submitting.</p>
      <div className="rounded-xl border border-purple-800/50 overflow-hidden">
        {rows.map(({ label, value }, i) => (
          <div
            key={label}
            className={`flex items-center justify-between px-4 py-2.5 text-sm ${
              i % 2 === 0 ? "bg-purple-900/20" : "bg-purple-900/10"
            }`}
          >
            <span className="text-purple-400">{label}</span>
            <span className="text-white font-medium">{value}</span>
          </div>
        ))}
      </div>
      {state.notes && (
        <div className="rounded-xl border border-purple-800/50 p-3">
          <p className="text-xs text-purple-400 mb-1">Notes</p>
          <p className="text-sm text-white">{state.notes}</p>
        </div>
      )}
    </div>
  );
}

// ── Main Wizard ───────────────────────────────────────────────────────────────

const STEPS = ["Client Type", "Basic Info", "Account Setup", "Documents", "Confirm"];

export default function BrokerClientOnboarding() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [submitted, setSubmitted] = useState(false);

  const addClient = trpc.broker.addClient.useMutation({
    onSuccess: () => {
      setSubmitted(true);
    },
    onError: err => {
      toast.error("Failed to add client: " + err.message);
    },
  });

  function handleChange(key: keyof WizardState, value: string) {
    setState(prev => ({ ...prev, [key]: value }));
  }

  function canProceed(): boolean {
    if (step === 1) return state.clientType !== "";
    if (step === 2) return state.clientName.trim().length > 0;
    return true;
  }

  function handleNext() {
    if (step < STEPS.length) setStep(s => s + 1);
  }

  function handleBack() {
    if (step > 1) setStep(s => s - 1);
  }

  function handleSubmit() {
    addClient.mutate({
      clientName: state.clientName,
      clientEmail: state.clientEmail || undefined,
      clientPhone: state.clientPhone || undefined,
      accountType: state.accountType,
      notes: state.notes || undefined,
    });
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-950 via-slate-900 to-slate-950 flex items-center justify-center p-4">
        <Card className="bg-purple-900/30 border-purple-700 max-w-md w-full text-center">
          <CardContent className="pt-10 pb-8 space-y-4">
            <div className="w-16 h-16 rounded-full bg-purple-500/20 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-purple-400" />
            </div>
            <h2 className="text-xl font-bold text-white">Client Onboarded</h2>
            <p className="text-purple-300 text-sm">
              <strong className="text-white">{state.clientName}</strong> has been added to your client list. You can now route trades on their behalf.
            </p>
            <div className="flex gap-3 justify-center pt-2">
              <Button onClick={() => navigate("/broker/commissions")} className="bg-purple-600 hover:bg-purple-500">
                View Clients
              </Button>
              <Button variant="outline" onClick={() => { setState(INITIAL_STATE); setStep(1); setSubmitted(false); }} className="border-purple-700 text-purple-300">
                Add Another
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-950 via-slate-900 to-slate-950 p-4 md:p-8">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/broker/commissions")}
            className="text-purple-400 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-purple-400" />
            <h1 className="text-lg font-bold text-white">Onboard New Client</h1>
          </div>
        </div>

        <Card className="bg-purple-900/20 border-purple-700">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-purple-300">
                Step {step} of {STEPS.length}: {STEPS[step - 1]}
              </CardTitle>
              <Badge className="bg-purple-800/40 text-purple-300 border-purple-700 text-xs">
                {Math.round((step / STEPS.length) * 100)}% complete
              </Badge>
            </div>
            <StepIndicator current={step} total={STEPS.length} />
          </CardHeader>
          <CardContent className="space-y-6">
            {step === 1 && (
              <Step1ClientType
                value={state.clientType}
                onChange={v => handleChange("clientType", v)}
              />
            )}
            {step === 2 && <Step2BasicInfo state={state} onChange={handleChange} />}
            {step === 3 && <Step3AccountSetup state={state} onChange={handleChange} />}
            {step === 4 && <Step4Notes state={state} onChange={handleChange} />}
            {step === 5 && <Step5Confirm state={state} />}

            {/* Navigation */}
            <div className="flex justify-between pt-2">
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={step === 1}
                className="border-purple-700 text-purple-300 hover:text-white"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
              {step < STEPS.length ? (
                <Button
                  onClick={handleNext}
                  disabled={!canProceed()}
                  className="bg-purple-600 hover:bg-purple-500 text-white"
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={addClient.isPending}
                  className="bg-purple-600 hover:bg-purple-500 text-white"
                >
                  {addClient.isPending ? "Submitting..." : "Submit"}
                  <CheckCircle2 className="w-4 h-4 ml-1" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
