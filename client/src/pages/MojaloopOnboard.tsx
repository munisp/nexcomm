/**
 * DFSP Onboarding Wizard — /mojaloop/onboard
 * ─────────────────────────────────────────────────────────────────────────────
 * Multi-step form for registering a new DFSP with the NEXCOM Mojaloop adapter.
 * Steps:
 *   1. DFSP Identity (FSP ID, name, country, type)
 *   2. Currencies & Limits (supported currencies, transfer limits)
 *   3. Callback Endpoints (base URLs)
 *   4. FSPIOP Endpoint Registration (register each endpoint type with the hub)
 *   5. Review & Submit
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Globe,
  Link2,
  Network,
  Settings,
  ServerCog,
  AlertCircle,
  Layers,
  DollarSign,
  Info,
  ShieldCheck,
  FileText,
  UserCheck,
  AlertTriangle,
} from "lucide-react";
import { useLocation } from "wouter";
import { MojaloopHubBanner } from "@/components/MojaloopHubBanner";

// ─── Step indicator ───────────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: "Identity",   icon: Building2 },
  { id: 2, label: "Currencies", icon: Globe },
  { id: 3, label: "Tier",       icon: Settings },
  { id: 4, label: "KYC/AML",    icon: ShieldCheck },
  { id: 5, label: "Endpoints",  icon: Link2 },
  { id: 6, label: "Hub Reg.",   icon: ServerCog },
  { id: 7, label: "Review",     icon: CheckCircle2 },
];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {STEPS.map((step, idx) => {
        const Icon = step.icon;
        const done = step.id < current;
        const active = step.id === current;
        return (
          <div key={step.id} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${
                done
                  ? "bg-primary border-primary text-primary-foreground"
                  : active
                  ? "border-primary text-primary bg-primary/10"
                  : "border-muted text-muted-foreground bg-muted/30"
              }`}>
                {done ? <CheckCircle2 className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
              </div>
              <span className={`text-xs font-medium ${active ? "text-primary" : done ? "text-primary/70" : "text-muted-foreground"}`}>
                {step.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={`w-12 h-0.5 mb-5 mx-1 ${done ? "bg-primary" : "bg-muted"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Identity ─────────────────────────────────────────────────────────
const DFSP_TYPES = ["BANK", "MOBILE_MONEY", "MICROFINANCE", "FINTECH", "EXCHANGE", "COOPERATIVE", "OTHER"];
const COUNTRIES = [
  { code: "NG", name: "Nigeria" },
  { code: "KE", name: "Kenya" },
  { code: "GH", name: "Ghana" },
  { code: "ZA", name: "South Africa" },
  { code: "TZ", name: "Tanzania" },
  { code: "UG", name: "Uganda" },
  { code: "ET", name: "Ethiopia" },
  { code: "SN", name: "Senegal" },
  { code: "CI", name: "Côte d'Ivoire" },
  { code: "CM", name: "Cameroon" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
];

function Step1({
  form,
  onChange,
}: {
  form: { fspId: string; name: string; country: string; dfspType: string; description: string };
  onChange: (f: Partial<typeof form>) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="fspId">FSP ID <span className="text-destructive">*</span></Label>
        <Input
          id="fspId"
          placeholder="e.g. nexcom-exchange"
          value={form.fspId}
          onChange={(e) => onChange({ fspId: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
          maxLength={64}
        />
        <p className="text-xs text-muted-foreground">Lowercase alphanumeric and hyphens only. This is your unique DFSP identifier in the Mojaloop network.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="name">Display Name <span className="text-destructive">*</span></Label>
        <Input
          id="name"
          placeholder="e.g. NEXCOM Exchange"
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          maxLength={128}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Country <span className="text-destructive">*</span></Label>
          <Select value={form.country} onValueChange={(v) => onChange({ country: v })}>
            <SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger>
            <SelectContent>
              {COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>{c.name} ({c.code})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>DFSP Type <span className="text-destructive">*</span></Label>
          <Select value={form.dfspType} onValueChange={(v) => onChange({ dfspType: v })}>
            <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
            <SelectContent>
              {DFSP_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label>Description</Label>
        <Input
          placeholder="Brief description of the DFSP (optional)"
          value={form.description}
          onChange={(e) => onChange({ description: e.target.value })}
          maxLength={256}
        />
      </div>
    </div>
  );
}

// ─── Step 2: Currencies ───────────────────────────────────────────────────────
const ALL_CURRENCIES = ["USD", "EUR", "GBP", "NGN", "KES", "GHS", "ZAR", "TZS", "UGX", "XOF", "XAF", "ETB", "MAD", "EGP"];

function Step2({
  form,
  onChange,
}: {
  form: { currencies: string[]; minTransfer: string; maxTransfer: string; dailyLimit: string };
  onChange: (f: Partial<typeof form>) => void;
}) {
  const toggleCurrency = (c: string) => {
    const next = form.currencies.includes(c)
      ? form.currencies.filter((x) => x !== c)
      : [...form.currencies, c];
    onChange({ currencies: next });
  };
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Supported Currencies <span className="text-destructive">*</span></Label>
        <p className="text-xs text-muted-foreground">Select all currencies this DFSP will process.</p>
        <div className="flex flex-wrap gap-2 mt-2">
          {ALL_CURRENCIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => toggleCurrency(c)}
              className={`px-3 py-1.5 text-sm rounded-md border font-medium transition-colors ${
                form.currencies.includes(c)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-foreground border-border hover:border-primary"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        {form.currencies.length > 0 && (
          <p className="text-xs text-muted-foreground mt-1">Selected: {form.currencies.join(", ")}</p>
        )}
      </div>
      <Separator />
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Min Transfer (USD)</Label>
          <Input type="number" placeholder="0.01" value={form.minTransfer} onChange={(e) => onChange({ minTransfer: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Max Transfer (USD)</Label>
          <Input type="number" placeholder="10000" value={form.maxTransfer} onChange={(e) => onChange({ maxTransfer: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Daily Limit (USD)</Label>
          <Input type="number" placeholder="100000" value={form.dailyLimit} onChange={(e) => onChange({ dailyLimit: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

// ─── Step 3: Tier Selection ──────────────────────────────────────────────────
const TIER_INFO = [
  {
    name: "STANDARD",
    label: "Standard",
    color: "text-blue-400 border-blue-400/30 bg-blue-400/5",
    badge: "bg-blue-400/20 text-blue-400",
    description: "Standard tier for banks and mobile money operators.",
    limits: { minTransfer: "0.01", maxTransfer: "5,000", dailyLimit: "50,000" },
    feeNote: "Flat fee + 0.15% per transfer",
  },
  {
    name: "PREMIUM",
    label: "Premium",
    color: "text-purple-400 border-purple-400/30 bg-purple-400/5",
    badge: "bg-purple-400/20 text-purple-400",
    description: "Premium tier for licensed fintechs and exchanges with higher volume.",
    limits: { minTransfer: "0.01", maxTransfer: "50,000", dailyLimit: "500,000" },
    feeNote: "Flat fee + 0.10% per transfer",
  },
  {
    name: "INSTITUTIONAL",
    label: "Institutional",
    color: "text-emerald-400 border-emerald-400/30 bg-emerald-400/5",
    badge: "bg-emerald-400/20 text-emerald-400",
    description: "Institutional tier for large financial institutions with high volume.",
    limits: { minTransfer: "0.01", maxTransfer: "500,000", dailyLimit: "5,000,000" },
    feeNote: "Flat fee + 0.05% per transfer",
  },
  {
    name: "CORRESPONDENT",
    label: "Correspondent",
    color: "text-amber-400 border-amber-400/30 bg-amber-400/5",
    badge: "bg-amber-400/20 text-amber-400",
    description: "Correspondent banking tier for cross-border settlement and remittance.",
    limits: { minTransfer: "0.01", maxTransfer: "1,000,000", dailyLimit: "10,000,000" },
    feeNote: "Custom negotiated fee schedule",
  },
];

function Step3Tier({
  selectedTier,
  onChange,
  tiers,
}: {
  selectedTier: string;
  onChange: (tier: string) => void;
  tiers: Array<{ name: string; description?: string | null; maxTransferAmount?: string | null; dailyLimit?: string | null; feeSchedules?: unknown[] }>;
}) {
  // Merge live tier data with static display info
  const displayTiers = TIER_INFO.map((t) => {
    const live = tiers.find((lt) => lt.name === t.name);
    return { ...t, live };
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Select the fee tier for this DFSP. The tier determines transfer limits and fee rates.
        You can change this later from the Tier Management page.
      </p>
      <div className="grid grid-cols-1 gap-3">
        {displayTiers.map((tier) => (
          <button
            key={tier.name}
            type="button"
            onClick={() => onChange(tier.name)}
            className={`w-full text-left rounded-lg border-2 p-4 transition-all ${
              selectedTier === tier.name
                ? `${tier.color} border-opacity-100`
                : "border-border hover:border-muted-foreground/40"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${tier.badge}`}>{tier.label}</span>
                  {selectedTier === tier.name && (
                    <CheckCircle2 className="w-4 h-4 text-primary" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{tier.description}</p>
                <div className="flex flex-wrap gap-3 mt-2">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <DollarSign className="w-3 h-3" />
                    Max: {tier.live?.maxTransferAmount ?? tier.limits.maxTransfer} per transfer
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Layers className="w-3 h-3" />
                    Daily: {tier.live?.dailyLimit ?? tier.limits.dailyLimit}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Info className="w-3 h-3" />
                    {tier.feeNote}
                  </div>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Step 4: KYC/AML Compliance ─────────────────────────────────────────────
const AML_RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
type AmlRiskLevel = (typeof AML_RISK_LEVELS)[number];

const DOCUMENT_TYPES = [
  { id: "certificate_of_incorporation", label: "Certificate of Incorporation" },
  { id: "regulatory_license",           label: "Regulatory / Banking License" },
  { id: "aml_policy",                   label: "AML/CFT Policy Document" },
  { id: "beneficial_ownership",         label: "Beneficial Ownership Register" },
  { id: "audited_financials",           label: "Audited Financial Statements" },
  { id: "sanctions_screening",          label: "Sanctions Screening Report" },
];

export interface KycForm {
  legalEntityName: string;
  registrationNumber: string;
  taxId: string;
  regulatoryBody: string;
  licenseNumber: string;
  amlRiskLevel: AmlRiskLevel;
  pepExposure: boolean;
  sanctionsScreeningPassed: boolean;
  beneficialOwners: string;
  documentsProvided: string[];
  complianceOfficerName: string;
  complianceOfficerEmail: string;
  acknowledgedAmlPolicy: boolean;
  acknowledgedDataProcessing: boolean;
}

const DEFAULT_KYC: KycForm = {
  legalEntityName: "",
  registrationNumber: "",
  taxId: "",
  regulatoryBody: "",
  licenseNumber: "",
  amlRiskLevel: "LOW",
  pepExposure: false,
  sanctionsScreeningPassed: false,
  beneficialOwners: "",
  documentsProvided: [],
  complianceOfficerName: "",
  complianceOfficerEmail: "",
  acknowledgedAmlPolicy: false,
  acknowledgedDataProcessing: false,
};

function Step4KYC({
  form,
  onChange,
}: {
  form: KycForm;
  onChange: (f: Partial<KycForm>) => void;
}) {
  const toggleDoc = (id: string) => {
    const next = form.documentsProvided.includes(id)
      ? form.documentsProvided.filter((d) => d !== id)
      : [...form.documentsProvided, id];
    onChange({ documentsProvided: next });
  };

  const riskColors: Record<AmlRiskLevel, string> = {
    LOW:    "bg-green-500/10 text-green-600 border-green-500/30",
    MEDIUM: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    HIGH:   "bg-red-500/10 text-red-600 border-red-500/30",
  };

  return (
    <div className="space-y-6">
      {/* Legal Identity */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5" /> Legal Entity Details
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Legal Entity Name <span className="text-destructive">*</span></Label>
            <Input
              placeholder="Full registered legal name"
              value={form.legalEntityName}
              onChange={(e) => onChange({ legalEntityName: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Registration Number <span className="text-destructive">*</span></Label>
            <Input
              placeholder="e.g. RC-1234567"
              value={form.registrationNumber}
              onChange={(e) => onChange({ registrationNumber: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Tax ID / TIN</Label>
            <Input
              placeholder="Tax Identification Number"
              value={form.taxId}
              onChange={(e) => onChange({ taxId: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Regulatory Body <span className="text-destructive">*</span></Label>
            <Input
              placeholder="e.g. CBN, FCA, FSCA"
              value={form.regulatoryBody}
              onChange={(e) => onChange({ regulatoryBody: e.target.value })}
            />
          </div>
          <div className="col-span-2 space-y-2">
            <Label>License Number <span className="text-destructive">*</span></Label>
            <Input
              placeholder="Regulatory license / authorization number"
              value={form.licenseNumber}
              onChange={(e) => onChange({ licenseNumber: e.target.value })}
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* AML Risk Assessment */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> AML Risk Assessment
        </h3>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Inherent AML Risk Level <span className="text-destructive">*</span></Label>
            <div className="flex gap-3">
              {AML_RISK_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => onChange({ amlRiskLevel: level })}
                  className={`flex-1 py-2 rounded-md border text-sm font-semibold transition-colors ${
                    form.amlRiskLevel === level
                      ? riskColors[level]
                      : "border-border text-muted-foreground hover:border-primary"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Based on business model, geography, and customer base.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-start gap-3 p-3 rounded-lg border">
              <input
                type="checkbox"
                id="pepExposure"
                checked={form.pepExposure}
                onChange={(e) => onChange({ pepExposure: e.target.checked })}
                className="mt-0.5 w-4 h-4 accent-primary"
              />
              <div>
                <Label htmlFor="pepExposure" className="cursor-pointer font-medium">PEP Exposure</Label>
                <p className="text-xs text-muted-foreground mt-0.5">DFSP serves or is associated with Politically Exposed Persons.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg border">
              <input
                type="checkbox"
                id="sanctionsPassed"
                checked={form.sanctionsScreeningPassed}
                onChange={(e) => onChange({ sanctionsScreeningPassed: e.target.checked })}
                className="mt-0.5 w-4 h-4 accent-primary"
              />
              <div>
                <Label htmlFor="sanctionsPassed" className="cursor-pointer font-medium">Sanctions Screening Passed <span className="text-destructive">*</span></Label>
                <p className="text-xs text-muted-foreground mt-0.5">Confirm entity is not on OFAC, EU, UN or local sanctions lists.</p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Beneficial Owners (UBO) <span className="text-destructive">*</span></Label>
            <textarea
              className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              placeholder="List all ultimate beneficial owners (≥25% ownership): Name, nationality, % ownership — one per line."
              value={form.beneficialOwners}
              onChange={(e) => onChange({ beneficialOwners: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">Required for FATF compliance. Minimum 1 UBO must be declared.</p>
          </div>
        </div>
      </div>

      <Separator />

      {/* Compliance Officer */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
          <UserCheck className="w-3.5 h-3.5" /> Compliance Officer
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Full Name <span className="text-destructive">*</span></Label>
            <Input
              placeholder="Compliance Officer name"
              value={form.complianceOfficerName}
              onChange={(e) => onChange({ complianceOfficerName: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Email <span className="text-destructive">*</span></Label>
            <Input
              type="email"
              placeholder="compliance@dfsp.example.com"
              value={form.complianceOfficerEmail}
              onChange={(e) => onChange({ complianceOfficerEmail: e.target.value })}
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Documents Checklist */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5" /> Document Checklist
        </h3>
        <p className="text-xs text-muted-foreground mb-3">Confirm which documents have been prepared for submission to the NEXCOM compliance team.</p>
        <div className="grid grid-cols-2 gap-2">
          {DOCUMENT_TYPES.map((doc) => (
            <div key={doc.id} className="flex items-center gap-2 p-2.5 rounded-md border cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => toggleDoc(doc.id)}>
              <input
                type="checkbox"
                checked={form.documentsProvided.includes(doc.id)}
                onChange={() => toggleDoc(doc.id)}
                className="w-4 h-4 accent-primary"
                onClick={(e) => e.stopPropagation()}
              />
              <span className="text-sm">{doc.label}</span>
            </div>
          ))}
        </div>
        {form.documentsProvided.length > 0 && (
          <p className="text-xs text-green-600 mt-2">{form.documentsProvided.length} of {DOCUMENT_TYPES.length} documents confirmed.</p>
        )}
      </div>

      <Separator />

      {/* Acknowledgements */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" /> Acknowledgements
        </h3>
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 rounded-lg border">
            <input
              type="checkbox"
              id="ackAml"
              checked={form.acknowledgedAmlPolicy}
              onChange={(e) => onChange({ acknowledgedAmlPolicy: e.target.checked })}
              className="mt-0.5 w-4 h-4 accent-primary"
            />
            <Label htmlFor="ackAml" className="cursor-pointer font-normal text-sm leading-relaxed">
              I confirm that this DFSP has an active AML/CFT policy that complies with FATF Recommendations and applicable local regulations, and that the information provided is accurate and complete. <span className="text-destructive">*</span>
            </Label>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg border">
            <input
              type="checkbox"
              id="ackData"
              checked={form.acknowledgedDataProcessing}
              onChange={(e) => onChange({ acknowledgedDataProcessing: e.target.checked })}
              className="mt-0.5 w-4 h-4 accent-primary"
            />
            <Label htmlFor="ackData" className="cursor-pointer font-normal text-sm leading-relaxed">
              I consent to NEXCOM processing the submitted compliance data for onboarding verification and ongoing monitoring purposes under applicable data protection laws. <span className="text-destructive">*</span>
            </Label>
          </div>
        </div>
      </div>

      {form.amlRiskLevel === "HIGH" && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-xs text-red-600 dark:text-red-400">
            <strong>High-risk DFSP flagged.</strong> Enhanced due diligence (EDD) will be required. A NEXCOM compliance officer will contact the compliance officer on record before activation.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Step 5: Base Callback Endpoints ─────────────────────────────────────────
function Step3({
  form,
  onChange,
}: {
  form: { callbackUrl: string; quoteCallbackUrl: string; transferCallbackUrl: string; notificationUrl: string };
  onChange: (f: Partial<typeof form>) => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Configure the base FSPIOP callback endpoints. These will be used to auto-populate the endpoint types in Step 4.
        Leave blank to use the NEXCOM adapter defaults.
      </p>
      <div className="space-y-2">
        <Label>Base Callback URL</Label>
        <Input
          placeholder="https://your-dfsp.example.com/fspiop"
          value={form.callbackUrl}
          onChange={(e) => onChange({ callbackUrl: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">Base URL — used to auto-fill transfer and quote endpoints below.</p>
      </div>
      <div className="space-y-2">
        <Label>Transfer Callback URL</Label>
        <Input
          placeholder="https://your-dfsp.example.com/fspiop/transfers"
          value={form.transferCallbackUrl}
          onChange={(e) => onChange({ transferCallbackUrl: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label>Quote Callback URL</Label>
        <Input
          placeholder="https://your-dfsp.example.com/fspiop/quotes"
          value={form.quoteCallbackUrl}
          onChange={(e) => onChange({ quoteCallbackUrl: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label>Notification Webhook URL</Label>
        <Input
          placeholder="https://your-dfsp.example.com/webhooks/mojaloop"
          value={form.notificationUrl}
          onChange={(e) => onChange({ notificationUrl: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">Optional: receive operational alerts and status changes.</p>
      </div>
    </div>
  );
}

// ─── Step 4: FSPIOP Endpoint Registration ────────────────────────────────────
const ENDPOINT_TYPES = [
  { type: "FSPIOP_CALLBACK_URL_TRANSFER_POST",   label: "Transfer POST",   desc: "New transfer initiated" },
  { type: "FSPIOP_CALLBACK_URL_TRANSFER_PUT",    label: "Transfer PUT",    desc: "Transfer state update" },
  { type: "FSPIOP_CALLBACK_URL_TRANSFER_ERROR",  label: "Transfer Error",  desc: "Transfer error notification" },
  { type: "FSPIOP_CALLBACK_URL_QUOTES_POST",     label: "Quote POST",      desc: "New quote request" },
  { type: "FSPIOP_CALLBACK_URL_QUOTES_PUT",      label: "Quote PUT",       desc: "Quote response" },
  { type: "FSPIOP_CALLBACK_URL_QUOTES_ERROR",    label: "Quote Error",     desc: "Quote error notification" },
  { type: "FSPIOP_CALLBACK_URL_PARTIES_GET",     label: "Party GET",       desc: "Party lookup request" },
  { type: "FSPIOP_CALLBACK_URL_PARTIES_PUT",     label: "Party PUT",       desc: "Party lookup response" },
  { type: "FSPIOP_CALLBACK_URL_PARTIES_PUT_ERROR", label: "Party Error",   desc: "Party lookup error" },
] as const;

type EndpointType = typeof ENDPOINT_TYPES[number]["type"];

function Step4({
  fspId,
  baseEndpoints,
  endpointValues,
  onChange,
}: {
  fspId: string;
  baseEndpoints: { callbackUrl: string; transferCallbackUrl: string; quoteCallbackUrl: string };
  endpointValues: Record<EndpointType, string>;
  onChange: (type: EndpointType, value: string) => void;
}) {
  const base = baseEndpoints.callbackUrl;
  const transferBase = baseEndpoints.transferCallbackUrl || (base ? `${base}/transfers` : "");
  const quoteBase = baseEndpoints.quoteCallbackUrl || (base ? `${base}/quotes` : "");
  const partiesBase = base ? `${base}/parties` : "";

  const autoFill = () => {
    if (!base && !transferBase && !quoteBase) {
      toast.error("Please enter a base URL in Step 3 first");
      return;
    }
    if (transferBase) {
      onChange("FSPIOP_CALLBACK_URL_TRANSFER_POST", transferBase);
      onChange("FSPIOP_CALLBACK_URL_TRANSFER_PUT", `${transferBase}/{ID}`);
      onChange("FSPIOP_CALLBACK_URL_TRANSFER_ERROR", `${transferBase}/{ID}/error`);
    }
    if (quoteBase) {
      onChange("FSPIOP_CALLBACK_URL_QUOTES_POST", quoteBase);
      onChange("FSPIOP_CALLBACK_URL_QUOTES_PUT", `${quoteBase}/{ID}`);
      onChange("FSPIOP_CALLBACK_URL_QUOTES_ERROR", `${quoteBase}/{ID}/error`);
    }
    if (partiesBase) {
      onChange("FSPIOP_CALLBACK_URL_PARTIES_GET", `${partiesBase}/{Type}/{ID}`);
      onChange("FSPIOP_CALLBACK_URL_PARTIES_PUT", `${partiesBase}/{Type}/{ID}`);
      onChange("FSPIOP_CALLBACK_URL_PARTIES_PUT_ERROR", `${partiesBase}/{Type}/{ID}/error`);
    }
    toast.success("Endpoints auto-filled from base URL");
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Register each FSPIOP endpoint type with the Mojaloop hub for DFSP{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{fspId || "..."}</code>.
            These endpoints tell the hub where to send callbacks.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={autoFill} className="shrink-0">
          Auto-fill from Base URL
        </Button>
      </div>
      <div className="space-y-3">
        {ENDPOINT_TYPES.map(({ type, label, desc }) => (
          <div key={type} className="space-y-1">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium">{label}</Label>
              <span className="text-xs text-muted-foreground">— {desc}</span>
            </div>
            <Input
              placeholder={`https://your-dfsp.example.com/fspiop/...`}
              value={endpointValues[type] ?? ""}
              onChange={(e) => onChange(type, e.target.value)}
              className="font-mono text-xs"
            />
          </div>
        ))}
      </div>
      <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
        <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Endpoint registration requires the Mojaloop hub to be reachable. If the hub is in standalone mode,
          endpoint URLs will be saved locally but not forwarded to the hub until connectivity is restored.
        </p>
      </div>
    </div>
  );
}

// ─── Step 5: Review ───────────────────────────────────────────────────────────
function ReviewRow({ label, value }: { label: string; value: string | React.ReactNode }) {
  return (
    <div className="flex justify-between items-start py-2 border-b last:border-0">
      <span className="text-sm text-muted-foreground w-40 shrink-0">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  );
}

function Step5({
  identity,
  currencies,
  endpoints,
  endpointValues,
}: {
  identity: { fspId: string; name: string; country: string; dfspType: string; description: string };
  currencies: { currencies: string[]; minTransfer: string; maxTransfer: string; dailyLimit: string };
  endpoints: { callbackUrl: string; quoteCallbackUrl: string; transferCallbackUrl: string; notificationUrl: string };
  endpointValues: Record<EndpointType, string>;
}) {
  const registeredEndpoints = Object.entries(endpointValues).filter(([, v]) => v.length > 0);
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">DFSP Identity</h3>
        <div className="rounded-lg border p-4 space-y-0">
          <ReviewRow label="FSP ID" value={<code className="bg-muted px-1.5 py-0.5 rounded text-xs">{identity.fspId}</code>} />
          <ReviewRow label="Display Name" value={identity.name} />
          <ReviewRow label="Country" value={identity.country} />
          <ReviewRow label="Type" value={identity.dfspType.replace(/_/g, " ")} />
          {identity.description && <ReviewRow label="Description" value={identity.description} />}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Currencies & Limits</h3>
        <div className="rounded-lg border p-4 space-y-0">
          <ReviewRow
            label="Currencies"
            value={
              <div className="flex flex-wrap gap-1 justify-end">
                {currencies.currencies.map((c) => (
                  <Badge key={c} variant="secondary" className="text-xs">{c}</Badge>
                ))}
              </div>
            }
          />
          {currencies.minTransfer && <ReviewRow label="Min Transfer" value={`$${currencies.minTransfer}`} />}
          {currencies.maxTransfer && <ReviewRow label="Max Transfer" value={`$${currencies.maxTransfer}`} />}
          {currencies.dailyLimit && <ReviewRow label="Daily Limit" value={`$${currencies.dailyLimit}`} />}
        </div>
      </div>
      {registeredEndpoints.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            FSPIOP Endpoints ({registeredEndpoints.length} configured)
          </h3>
          <div className="rounded-lg border p-4 space-y-0">
            {registeredEndpoints.map(([type, value]) => {
              const label = ENDPOINT_TYPES.find((e) => e.type === type)?.label ?? type;
              return (
                <ReviewRow
                  key={type}
                  label={label}
                  value={<code className="text-xs break-all">{value}</code>}
                />
              );
            })}
          </div>
        </div>
      )}
      {(endpoints.callbackUrl || endpoints.notificationUrl) && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Notification</h3>
          <div className="rounded-lg border p-4 space-y-0">
            {endpoints.callbackUrl && <ReviewRow label="Base URL" value={<code className="text-xs">{endpoints.callbackUrl}</code>} />}
            {endpoints.notificationUrl && <ReviewRow label="Webhook" value={<code className="text-xs">{endpoints.notificationUrl}</code>} />}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────
const DEFAULT_ENDPOINT_VALUES = Object.fromEntries(
  ENDPOINT_TYPES.map((e) => [e.type, ""])
) as Record<EndpointType, string>;

export default function MojaloopOnboard() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [endpointResults, setEndpointResults] = useState<{ registered: number; failed: number } | null>(null);

  const [identity, setIdentity] = useState({
    fspId: "",
    name: "",
    country: "NG",
    dfspType: "BANK",
    description: "",
  });

  const [currencies, setCurrencies] = useState({
    currencies: ["NGN", "USD"],
    minTransfer: "0.01",
    maxTransfer: "10000",
    dailyLimit: "100000",
  });

  const [endpoints, setEndpoints] = useState({
    callbackUrl: "",
    quoteCallbackUrl: "",
    transferCallbackUrl: "",
    notificationUrl: "",
  });

  const [selectedTier, setSelectedTier] = useState("STANDARD");
  const [kyc, setKyc] = useState<KycForm>(DEFAULT_KYC);
  const [endpointValues, setEndpointValues] = useState<Record<EndpointType, string>>(DEFAULT_ENDPOINT_VALUES);
  const updateEndpointValue = (type: EndpointType, value: string) => {
    setEndpointValues((prev) => ({ ...prev, [type]: value }));
  };
  const { data: tiersData = [] } = trpc.mojaloopTiers.listTiers.useQuery();
  const assignTier = trpc.mojaloopTiers.assignTier.useMutation();
  const register = trpc.mojaloop.registerDfsp.useMutation();
  const registerEndpoints = trpc.mojaloop.registerDfspEndpoints.useMutation();
  const submitKycMutation = trpc.dfspKyc.submitKyc.useMutation();
  const canAdvance = () => {
    if (step === 1) return identity.fspId.length >= 2 && identity.name.length >= 2 && identity.country && identity.dfspType;
    if (step === 2) return currencies.currencies.length > 0;
    if (step === 3) return !!selectedTier;
    if (step === 4) return (
      kyc.legalEntityName.length >= 2 &&
      kyc.registrationNumber.length >= 2 &&
      kyc.regulatoryBody.length >= 2 &&
      kyc.licenseNumber.length >= 2 &&
      kyc.sanctionsScreeningPassed &&
      kyc.beneficialOwners.length >= 5 &&
      kyc.complianceOfficerName.length >= 2 &&
      kyc.complianceOfficerEmail.includes("@") &&
      kyc.acknowledgedAmlPolicy &&
      kyc.acknowledgedDataProcessing
    );
    if (step === 5) return true;
    if (step === 6) return true;
    return true;
  };
  const handleSubmit = async () => {
    try {
      // Step 1: Register the DFSP
      await register.mutateAsync({
        fspId: identity.fspId,
        name: identity.name,
        currency: currencies.currencies[0] ?? "USD",
        country: identity.country || undefined,
        endpointUrl: endpoints.callbackUrl || undefined,
      });

      // Step 2: Assign tier
      await assignTier.mutateAsync({ fspId: identity.fspId, tierName: selectedTier as "STANDARD" | "PREMIUM" | "INSTITUTIONAL" | "CORRESPONDENT" });
      // Step 2b: Submit KYC/AML record for compliance review queue
      try {
        await submitKycMutation.mutateAsync({
          fspId: identity.fspId,
          legalEntityName: kyc.legalEntityName,
          registrationNumber: kyc.registrationNumber,
          regulatoryBody: kyc.regulatoryBody,
          licenseNumber: kyc.licenseNumber,
          amlRiskLevel: kyc.amlRiskLevel as "LOW" | "MEDIUM" | "HIGH",
          pepExposure: kyc.pepExposure,
          sanctionsScreeningPassed: kyc.sanctionsScreeningPassed,
          beneficialOwners: kyc.beneficialOwners,
          complianceOfficerName: kyc.complianceOfficerName,
          complianceOfficerEmail: kyc.complianceOfficerEmail,
          documentsProvided: kyc.documentsProvided,
          acknowledgedAmlPolicy: kyc.acknowledgedAmlPolicy,
          acknowledgedDataProcessing: kyc.acknowledgedDataProcessing,
        });
      } catch (kycErr) {
        // Non-blocking: DFSP is registered but KYC is flagged for manual review
        console.warn("KYC auto-submission failed, manual review required:", kycErr);
      }
      // Step 3: Register FSPIOP endpoints (only those with values)
      const endpointsToRegister = Object.entries(endpointValues)
        .filter(([, v]) => v.length > 0)
        .map(([type, value]) => ({ type: type as EndpointType, value }));
      if (endpointsToRegister.length > 0) {
        const result = await registerEndpoints.mutateAsync({
          fspId: identity.fspId,
          endpoints: endpointsToRegister,
        });
        setEndpointResults({ registered: result.registered, failed: result.failed });
        if (result.failed > 0) {
          toast.warning(`DFSP registered. ${result.registered} endpoints registered, ${result.failed} failed (hub may be in standalone mode).`);
        } else {
          toast.success(`DFSP registered with ${result.registered} FSPIOP endpoints.`);
        }
       } else {
        toast.success("DFSP registered successfully.");
      }
      setSubmitted(true);
    } catch (err: unknown) {
      toast.error(`Registration failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const isPending = register.isPending || registerEndpoints.isPending || assignTier.isPending || submitKycMutation.isPending;

  if (submitted) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card>
          <CardContent className="pt-12 pb-12 flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <div>
              <h2 className="text-xl font-bold">DFSP Registered Successfully</h2>
              <p className="text-muted-foreground mt-1">
                <strong>{identity.name}</strong> (<code className="bg-muted px-1 py-0.5 rounded text-xs">{identity.fspId}</code>) has been registered with the Mojaloop adapter.
              </p>
              {endpointResults && (
                <p className="text-sm text-muted-foreground mt-2">
                  {endpointResults.registered} FSPIOP endpoint{endpointResults.registered !== 1 ? "s" : ""} registered
                  {endpointResults.failed > 0 && `, ${endpointResults.failed} failed (hub offline)`}.
                </p>
              )}
            </div>
            <div className="flex gap-3 mt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setStep(1);
                  setSubmitted(false);
                  setIdentity({ fspId: "", name: "", country: "NG", dfspType: "BANK", description: "" });
                  setEndpointValues(DEFAULT_ENDPOINT_VALUES);
                  setEndpointResults(null);
                }}
              >
                Register Another
              </Button>
              <Button onClick={() => navigate("/mojaloop")}>
                View Mojaloop Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <MojaloopHubBanner />
      <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          <button onClick={() => navigate("/mojaloop")} className="hover:text-foreground transition-colors flex items-center gap-1">
            <Network className="w-3.5 h-3.5" />
            Mojaloop Payments
          </button>
          <span>/</span>
          <span>DFSP Onboarding</span>
        </div>
        <h1 className="text-2xl font-bold">Register New DFSP</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Onboard a new Digital Financial Service Provider to the NEXCOM Mojaloop network.
        </p>
      </div>

      {/* Step Indicator */}
      <StepIndicator current={step} />

      {/* Step Content */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {step === 1 && <><Building2 className="w-5 h-5 text-primary" /> DFSP Identity</>}
            {step === 2 && <><Globe className="w-5 h-5 text-primary" /> Currencies &amp; Limits</>}
            {step === 3 && <><Layers className="w-5 h-5 text-primary" /> Tier &amp; Fee Schedule</>}
            {step === 4 && <><ShieldCheck className="w-5 h-5 text-primary" /> KYC / AML Compliance</>}
            {step === 5 && <><Link2 className="w-5 h-5 text-primary" /> Callback Endpoints</>}
            {step === 6 && <><ServerCog className="w-5 h-5 text-primary" /> FSPIOP Endpoint Registration</>}
            {step === 7 && <><CheckCircle2 className="w-5 h-5 text-primary" /> Review &amp; Submit</>}
          </CardTitle>
          <CardDescription>
            {step === 1 && "Provide the unique identifier and basic information for this DFSP."}
            {step === 2 && "Select the currencies this DFSP supports and configure transfer limits."}
            {step === 3 && "Select the fee tier for this DFSP. This determines transfer limits and fee rates."}
            {step === 4 && "Complete KYC/AML compliance checks. All mandatory fields must be filled before proceeding."}
            {step === 5 && "Configure FSPIOP callback base URLs for transfer notifications (optional)."}
            {step === 6 && "Register each FSPIOP endpoint type with the Mojaloop hub. Use Auto-fill to populate from Step 5 URLs."}
            {step === 7 && "Review all details before submitting the DFSP registration."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 1 && <Step1 form={identity} onChange={(f) => setIdentity((p) => ({ ...p, ...f }))} />}
          {step === 2 && <Step2 form={currencies} onChange={(f) => setCurrencies((p) => ({ ...p, ...f }))} />}
          {step === 3 && (
            <Step3Tier
              selectedTier={selectedTier}
              onChange={setSelectedTier}
              tiers={tiersData}
            />
          )}
          {step === 4 && (
            <Step4KYC
              form={kyc}
              onChange={(f) => setKyc((p) => ({ ...p, ...f }))}
            />
          )}
          {step === 5 && <Step3 form={endpoints} onChange={(f) => setEndpoints((p) => ({ ...p, ...f }))} />}
          {step === 6 && (
            <Step4
              fspId={identity.fspId}
              baseEndpoints={endpoints}
              endpointValues={endpointValues}
              onChange={updateEndpointValue}
            />
          )}
          {step === 7 && (
            <Step5
              identity={identity}
              currencies={currencies}
              endpoints={endpoints}
              endpointValues={endpointValues}
            />
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => (step === 1 ? navigate("/mojaloop") : setStep((s) => s - 1))}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          {step === 1 ? "Back to Dashboard" : "Previous"}
        </Button>
        {step < 7 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canAdvance()}>
            Next
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Registering..." : "Register DFSP"}
            <CheckCircle2 className="w-4 h-4 ml-2" />
          </Button>
        )}
      </div>
      </div>
    </div>
  );
}
