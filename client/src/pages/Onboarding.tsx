/**
 * NEXCOM Exchange — Multi-Stakeholder Onboarding Wizard
 *
 * Stakeholder paths:
 *  1. Farmer — farm details, crop types, cooperative membership
 *  2. Trader — trading experience, capital range, preferred markets
 *  3. Broker — license number, regulatory body, client base
 *  4. Warehouse Operator — facility details, certifications, capacity
 *  5. Market Maker — trading desk, liquidity obligations, min spread
 *  6. Admin — internal department, admin code
 *
 * Steps per path:
 *  Step 1: Choose stakeholder type
 *  Step 2: Personal information
 *  Step 3: Business / entity information
 *  Step 4: Stakeholder-specific details
 *  Step 5: Document upload (real S3 via trpc.onboarding.uploadKycDocument)
 *  Step 6: Review & submit → trpc.onboarding.submit
 */
import { useState, useCallback, useRef } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  Wheat, BarChart2, Briefcase, Warehouse, Activity, Shield,
  CheckCircle2, ChevronRight, ChevronLeft, User, Building2,
  FileText, Upload, Eye, RefreshCw, AlertCircle, Clock,
  Users, Download, XCircle
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface UploadedDoc {
  docId: string;
  url: string;
  name: string;
  type: string;
  fileName: string;
}
type StakeholderType = "FARMER" | "TRADER" | "BROKER" | "WAREHOUSE_OPERATOR" | "MARKET_MAKER" | "ADMIN";

interface PersonalInfo {
  firstName: string; lastName: string; email: string; phone: string;
  country: string; state: string; address: string; bvn: string; nin: string;
}
interface BusinessInfo {
  companyName: string; rcNumber: string; taxId: string;
  businessType: string; yearsInOperation: string; annualTurnover: string;
}
interface StakeholderSpecific {
  // Farmer
  farmSize: string; primaryCrops: string; farmLocation: string; farmingType: string;
  // Trader
  tradingExperience: string; preferredMarkets: string; capitalRange: string;
  // Broker
  licenseNumber: string; regulatoryBody: string; clientBase: string;
  // Warehouse
  warehouseName: string; warehouseLocation: string; storageCapacity: string;
  commoditiesHandled: string; certifications: string;
  // Market Maker
  tradingDesk: string; liquidityProvided: string; minSpread: string;
  // Admin
  adminCode: string; department: string;
}

const INITIAL_PERSONAL: PersonalInfo = {
  firstName: "", lastName: "", email: "", phone: "",
  country: "Nigeria", state: "", address: "", bvn: "", nin: "",
};
const INITIAL_BUSINESS: BusinessInfo = {
  companyName: "", rcNumber: "", taxId: "",
  businessType: "", yearsInOperation: "", annualTurnover: "",
};
const INITIAL_SPECIFIC: StakeholderSpecific = {
  farmSize: "", primaryCrops: "", farmLocation: "", farmingType: "COMMERCIAL",
  tradingExperience: "", preferredMarkets: "", capitalRange: "",
  licenseNumber: "", regulatoryBody: "", clientBase: "",
  warehouseName: "", warehouseLocation: "", storageCapacity: "",
  commoditiesHandled: "", certifications: "",
  tradingDesk: "", liquidityProvided: "", minSpread: "",
  adminCode: "", department: "",
};

// ─── Stakeholder config ───────────────────────────────────────────────────────
const STAKEHOLDERS: { type: StakeholderType; label: string; icon: React.FC<{ className?: string }>; description: string; color: string; }[] = [
  {
    type: "FARMER", label: "Farmer / Cooperative", icon: Wheat,
    description: "Register as a commodity producer to deposit, trade, and access financing against your crops.",
    color: "emerald",
  },
  {
    type: "TRADER", label: "Commodity Trader", icon: BarChart2,
    description: "Access spot and futures markets for agricultural commodities, metals, and energy.",
    color: "blue",
  },
  {
    type: "BROKER", label: "Licensed Broker", icon: Briefcase,
    description: "Onboard as a regulated broker to execute trades on behalf of clients.",
    color: "purple",
  },
  {
    type: "WAREHOUSE_OPERATOR", label: "Warehouse Operator", icon: Warehouse,
    description: "Register your certified storage facility to issue Electronic Warehouse Receipts.",
    color: "amber",
  },
  {
    type: "MARKET_MAKER", label: "Market Maker", icon: Activity,
    description: "Provide liquidity across commodity, forex, and equity markets with tight spreads.",
    color: "cyan",
  },
  {
    type: "ADMIN", label: "Exchange Staff", icon: Shield,
    description: "Internal NEXCOM staff onboarding — requires an admin authorization code.",
    color: "red",
  },
];

const COLOR_MAP: Record<string, string> = {
  emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  blue: "border-blue-500/40 bg-blue-500/10 text-blue-400",
  purple: "border-purple-500/40 bg-purple-500/10 text-purple-400",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  cyan: "border-cyan-500/40 bg-cyan-500/10 text-cyan-400",
  red: "border-red-500/40 bg-red-500/10 text-red-400",
};

const STEPS = ["Stakeholder Type", "Personal Info", "Business Info", "Specific Details", "Documents", "Review & Submit"];

// ─── Field helpers ────────────────────────────────────────────────────────────
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}{required && <span className="text-red-400 ml-0.5">*</span>}</Label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = "text" }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <Input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="bg-white/5 border-white/10 text-white placeholder:text-gray-600 h-9 text-sm"
    />
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Onboarding() {
  const { isAuthenticated, user, loading } = useAuth();
  const [step, setStep] = useState(0);
  const [stakeholderType, setStakeholderType] = useState<StakeholderType | null>(null);
  const [personal, setPersonal] = useState<PersonalInfo>(INITIAL_PERSONAL);
  const [business, setBusiness] = useState<BusinessInfo>(INITIAL_BUSINESS);
  const [specific, setSpecific] = useState<StakeholderSpecific>(INITIAL_SPECIFIC);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [agreedToKyc, setAgreedToKyc] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Check existing status
  const { data: statusData, isLoading: statusLoading } = trpc.onboarding.getStatus.useQuery(undefined as void, {
    enabled: isAuthenticated,
  });

  const submitMutation = trpc.onboarding.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      toast.success("Application submitted!", { description: "Our team will review your application within 2-3 business days." });
    },
    onError: (err) => {
      toast.error("Submission failed", { description: err.message });
    },
  });

  const updatePersonal = useCallback((field: keyof PersonalInfo) => (v: string) =>
    setPersonal(p => ({ ...p, [field]: v })), []);
  const updateBusiness = useCallback((field: keyof BusinessInfo) => (v: string) =>
    setBusiness(b => ({ ...b, [field]: v })), []);
  const updateSpecific = useCallback((field: keyof StakeholderSpecific) => (v: string) =>
    setSpecific(s => ({ ...s, [field]: v })), []);

  const canProceed = useCallback(() => {
    if (step === 0) return !!stakeholderType;
    if (step === 1) return !!(personal.firstName && personal.lastName && personal.email && personal.phone && personal.state && personal.address);
    if (step === 5) return agreedToTerms && agreedToKyc;
    return true;
  }, [step, stakeholderType, personal, agreedToTerms, agreedToKyc]);

  // ── Cooperative Bulk KYC Upload state (moved up to satisfy Rules of Hooks) ──
  const [bulkCsvText, setBulkCsvText] = useState("");
  const [bulkCoopName, setBulkCoopName] = useState("");
  const [bulkFileName, setBulkFileName] = useState("");
  const [bulkPreview, setBulkPreview] = useState<Array<Record<string,string>>>([]);
  const [bulkParseError, setBulkParseError] = useState("");
  const [showBulkPanel, setShowBulkPanel] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Document upload state ──
  const [uploadedDocs, setUploadedDocs] = useState<Record<string, UploadedDoc>>({});
  const [uploadingDocId, setUploadingDocId] = useState<string | null>(null);
  const docInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const uploadKycDocMutation = trpc.onboarding.uploadKycDocument.useMutation({
    onError: (err) => {
      toast.error("Upload failed", { description: err.message });
      setUploadingDocId(null);
    },
  });
  const handleDocFileChange = async (docId: string, docLabel: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File too large", { description: "Maximum file size is 5 MB." });
      return;
    }
    setUploadingDocId(docId);
    const reader = new FileReader();
    reader.onload = async () => {
      const base64Data = (reader.result as string).split(",")[1];
      try {
        const result = await uploadKycDocMutation.mutateAsync({ docId, fileName: file.name, mimeType: file.type, base64Data });
        setUploadedDocs(prev => ({ ...prev, [docId]: { docId, url: result.url, name: docLabel, type: docId, fileName: file.name } }));
        toast.success("Document uploaded successfully");
      } catch { /* handled by onError */ } finally { setUploadingDocId(null); }
    };
    reader.readAsDataURL(file);
  };

  const bulkUploadMutation = trpc.onboarding.bulkKycUpload.useMutation({
    onSuccess: (data) => {
      toast.success(`Bulk upload complete: ${data.success} applications created`, {
        description: data.failed > 0 ? `${data.failed} rows failed. Check the error list below.` : "All members processed successfully.",
      });
    },
    onError: (err) => toast.error("Bulk upload failed", { description: err.message }),
  });

  const handleSubmit = useCallback(() => {
    if (!stakeholderType) return;
    submitMutation.mutate({
      stakeholderType,
      personalInfo: {
        firstName: personal.firstName,
        lastName: personal.lastName,
        email: personal.email,
        phone: personal.phone,
        country: personal.country,
        state: personal.state,
        address: personal.address,
        bvn: personal.bvn || undefined,
        nin: personal.nin || undefined,
      },
      businessInfo: {
        companyName: business.companyName || undefined,
        rcNumber: business.rcNumber || undefined,
        taxId: business.taxId || undefined,
        businessType: business.businessType || undefined,
        yearsInOperation: business.yearsInOperation ? Number(business.yearsInOperation) : undefined,
        annualTurnover: business.annualTurnover || undefined,
      },
      stakeholderSpecific: {
        farmSize: specific.farmSize || undefined,
        primaryCrops: specific.primaryCrops ? specific.primaryCrops.split(",").map(s => s.trim()) : undefined,
        farmLocation: specific.farmLocation || undefined,
        farmingType: (specific.farmingType as "SUBSISTENCE" | "COMMERCIAL" | "COOPERATIVE") || undefined,
        tradingExperience: specific.tradingExperience || undefined,
        preferredMarkets: specific.preferredMarkets ? specific.preferredMarkets.split(",").map(s => s.trim()) : undefined,
        capitalRange: specific.capitalRange || undefined,
        licenseNumber: specific.licenseNumber || undefined,
        regulatoryBody: specific.regulatoryBody || undefined,
        clientBase: specific.clientBase || undefined,
        warehouseName: specific.warehouseName || undefined,
        warehouseLocation: specific.warehouseLocation || undefined,
        storageCapacity: specific.storageCapacity || undefined,
        commoditiesHandled: specific.commoditiesHandled ? specific.commoditiesHandled.split(",").map(s => s.trim()) : undefined,
        certifications: specific.certifications ? specific.certifications.split(",").map(s => s.trim()) : undefined,
        tradingDesk: specific.tradingDesk || undefined,
        liquidityProvided: specific.liquidityProvided ? specific.liquidityProvided.split(",").map(s => s.trim()) : undefined,
        minSpread: specific.minSpread || undefined,
        adminCode: specific.adminCode || undefined,
        department: specific.department || undefined,
      },
      documentsUploaded: Object.values(uploadedDocs).map(d => ({ type: d.type, url: d.url, name: d.fileName })),
      agreedToTerms,
      agreedToKyc,
    });
  }, [stakeholderType, personal, business, specific, uploadedDocs, agreedToTerms, agreedToKyc, submitMutation]);

  // ── Loading / auth gate ──
  if (loading || statusLoading) {
    return (
      <div className="min-h-screen bg-[#0a0f0a] flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#0a0f0a] flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <Shield className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Sign In Required</h2>
          <p className="text-muted-foreground mb-6">You must be signed in to complete onboarding.</p>
          <a href={getLoginUrl()}
            className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-lg font-semibold transition-colors">
            Sign In to Continue <ChevronRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    );
  }

  // ── Already submitted ──
  if (submitted || (statusData?.kycStatus && statusData.kycStatus !== "NOT_STARTED")) {
    const status = statusData?.kycStatus ?? "PENDING";
    const statusConfig = {
      PENDING: { color: "text-yellow-400", icon: Clock, label: "Under Review", desc: "Your application is being reviewed by our compliance team. This typically takes 2-3 business days." },
      VERIFIED: { color: "text-emerald-400", icon: CheckCircle2, label: "Approved", desc: "Your account has been verified. You now have full access to all platform features." },
      REJECTED: { color: "text-red-400", icon: AlertCircle, label: "Rejected", desc: "Your application was not approved. Please contact support for more information." },
      NOT_STARTED: { color: "text-muted-foreground", icon: User, label: "Not Started", desc: "" },
    }[status] ?? { color: "text-yellow-400", icon: Clock, label: "Pending", desc: "" };
    const StatusIcon = statusConfig.icon;

    return (
      <div className="min-h-screen bg-[#0a0f0a] flex items-center justify-center p-4">
        <div className="text-center max-w-lg bg-white/5 border border-white/10 rounded-2xl p-10">
          <StatusIcon className={`w-16 h-16 mx-auto mb-4 ${statusConfig.color}`} />
          <h2 className="text-2xl font-bold text-white mb-2">Application {statusConfig.label}</h2>
          <p className="text-muted-foreground mb-6">{statusConfig.desc}</p>
          {statusData?.application && (
            <div className="text-xs text-muted-foreground bg-white/5 rounded-lg px-4 py-3 text-left space-y-1">
              <div className="flex justify-between"><span>Application ID</span><span className="text-white font-mono">#{statusData.application.id}</span></div>
              <div className="flex justify-between"><span>Submitted</span><span className="text-white">{new Date(statusData.application.submittedAt).toLocaleDateString()}</span></div>
              <div className="flex justify-between"><span>Status</span><span className={statusConfig.color}>{statusConfig.label}</span></div>
            </div>
          )}
          {status === "REJECTED" && (
            <Button className="mt-6 bg-emerald-600 hover:bg-emerald-500" onClick={() => { setSubmitted(false); setStep(0); }}>
              Resubmit Application
            </Button>
          )}
        </div>
      </div>
    );
  }

  const selectedConfig = STAKEHOLDERS.find(s => s.type === stakeholderType);

  const parseCsv = (text: string) => {
    setBulkParseError("");
    const lines = text.trim().split("\n").filter(Boolean);
    if (lines.length < 2) { setBulkParseError("CSV must have a header row and at least one data row."); setBulkPreview([]); return; }
    const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
    const required = ["firstname", "lastname", "phone", "state", "address"];
    const missing = required.filter(r => !headers.includes(r));
    if (missing.length > 0) { setBulkParseError(`Missing required columns: ${missing.join(", ")}`); setBulkPreview([]); return; }
    const rows = lines.slice(1).map(line => {
      const vals = line.split(",").map(v => v.trim());
      return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
    });
    setBulkPreview(rows);
  };

  const handleBulkFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      setBulkCsvText(text);
      parseCsv(text);
    };
    reader.readAsText(file);
  };

  const handleBulkSubmit = () => {
    if (!bulkCoopName.trim()) { toast.error("Please enter the cooperative name."); return; }
    if (bulkPreview.length === 0) { toast.error("Please upload a valid CSV file first."); return; }
    const members = bulkPreview.map(row => ({
      firstName: row.firstname || row["first_name"] || "",
      lastName: row.lastname || row["last_name"] || "",
      phone: row.phone || "",
      bvn: row.bvn || undefined,
      nin: row.nin || undefined,
      state: row.state || "",
      address: row.address || "",
      email: row.email || undefined,
    })).filter(m => m.firstName && m.lastName && m.phone && m.state && m.address);
    if (members.length === 0) { toast.error("No valid member rows found in the CSV."); return; }
    bulkUploadMutation.mutate({ fileName: bulkFileName || "bulk_kyc.csv", members, cooperativeName: bulkCoopName });
  };

  return (
    <div className="min-h-screen bg-[#0a0f0a] text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#0d1410] px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">NEXCOM Exchange Onboarding</h1>
            <p className="text-sm text-muted-foreground">Complete your registration to access the platform</p>
          </div>
          {user && (
            <div className="text-right text-xs text-muted-foreground">
              <div className="text-white">{user.name}</div>
              <div>{user.email}</div>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            {STEPS.map((s, i) => (
              <div key={i} className="flex items-center">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  i < step ? "bg-emerald-600 text-white" :
                  i === step ? "bg-emerald-500 text-white ring-2 ring-emerald-500/30" :
                  "bg-white/10 text-muted-foreground"
                }`}>
                  {i < step ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-0.5 w-full mx-1 transition-all ${i < step ? "bg-emerald-600" : "bg-white/10"}`}
                    style={{ minWidth: "2rem", maxWidth: "4rem" }} />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>{STEPS[step]}</span>
            <span>Step {step + 1} of {STEPS.length}</span>
          </div>
        </div>

        {/* Step content */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 min-h-[400px]">

          {/* Step 0: Choose stakeholder type */}
          {step === 0 && (
            <div>
              <h2 className="text-lg font-bold mb-1">Who are you on the NEXCOM Exchange?</h2>
              <p className="text-sm text-muted-foreground mb-6">Select the role that best describes your participation on the platform.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {STAKEHOLDERS.map(({ type, label, icon: Icon, description, color }) => (
                  <button key={type} onClick={() => setStakeholderType(type)}
                    className={`text-left p-4 rounded-xl border transition-all ${
                      stakeholderType === type
                        ? `${COLOR_MAP[color]} border-opacity-80`
                        : "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20"
                    }`}>
                    <div className="flex items-center gap-3 mb-2">
                      <Icon className={`w-5 h-5 ${stakeholderType === type ? "" : "text-muted-foreground"}`} />
                      <span className="font-semibold text-sm">{label}</span>
                      {stakeholderType === type && <CheckCircle2 className="w-4 h-4 ml-auto" />}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 1: Personal information */}
          {step === 1 && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <User className="w-5 h-5 text-emerald-400" />
                <h2 className="text-lg font-bold">Personal Information</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-6">Your personal details for identity verification.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="First Name" required><TextInput value={personal.firstName} onChange={updatePersonal("firstName")} placeholder="Emeka" /></Field>
                <Field label="Last Name" required><TextInput value={personal.lastName} onChange={updatePersonal("lastName")} placeholder="Okafor" /></Field>
                <Field label="Email Address" required><TextInput type="email" value={personal.email} onChange={updatePersonal("email")} placeholder="emeka@example.com" /></Field>
                <Field label="Phone Number" required><TextInput type="tel" value={personal.phone} onChange={updatePersonal("phone")} placeholder="+234 800 000 0000" /></Field>
                <Field label="Country"><TextInput value={personal.country} onChange={updatePersonal("country")} placeholder="Nigeria" /></Field>
                <Field label="State / Province" required><TextInput value={personal.state} onChange={updatePersonal("state")} placeholder="Lagos" /></Field>
                <Field label="Address" required>
                  <div className="sm:col-span-2">
                    <TextInput value={personal.address} onChange={updatePersonal("address")} placeholder="123 Exchange Road, Victoria Island" />
                  </div>
                </Field>
                <Field label="BVN (Bank Verification Number)"><TextInput value={personal.bvn} onChange={updatePersonal("bvn")} placeholder="22xxxxxxxxx" /></Field>
                <Field label="NIN (National ID Number)"><TextInput value={personal.nin} onChange={updatePersonal("nin")} placeholder="12345678901" /></Field>
              </div>
            </div>
          )}

          {/* Step 2: Business information */}
          {step === 2 && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-5 h-5 text-emerald-400" />
                <h2 className="text-lg font-bold">Business / Entity Information</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-6">
                {stakeholderType === "FARMER" ? "Optional for individual farmers. Required for cooperatives." : "Required for all registered entities."}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Company / Entity Name"><TextInput value={business.companyName} onChange={updateBusiness("companyName")} placeholder="Okafor Farms Ltd" /></Field>
                <Field label="RC Number (CAC)"><TextInput value={business.rcNumber} onChange={updateBusiness("rcNumber")} placeholder="RC1234567" /></Field>
                <Field label="Tax Identification Number"><TextInput value={business.taxId} onChange={updateBusiness("taxId")} placeholder="TIN-XXXXXXXXXX" /></Field>
                <Field label="Business Type"><TextInput value={business.businessType} onChange={updateBusiness("businessType")} placeholder="Limited Liability Company" /></Field>
                <Field label="Years in Operation"><TextInput type="number" value={business.yearsInOperation} onChange={updateBusiness("yearsInOperation")} placeholder="5" /></Field>
                <Field label="Annual Turnover (USD)"><TextInput value={business.annualTurnover} onChange={updateBusiness("annualTurnover")} placeholder="$500,000 - $1M" /></Field>
              </div>
            </div>
          )}

          {/* Step 3: Stakeholder-specific details */}
          {step === 3 && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                {selectedConfig && <selectedConfig.icon className="w-5 h-5 text-emerald-400" />}
                <h2 className="text-lg font-bold">{selectedConfig?.label} Details</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-6">Specific information required for your stakeholder category.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {stakeholderType === "FARMER" && <>
                  <Field label="Farm Size (hectares)"><TextInput value={specific.farmSize} onChange={updateSpecific("farmSize")} placeholder="e.g. 50 ha" /></Field>
                  <Field label="Farm Location"><TextInput value={specific.farmLocation} onChange={updateSpecific("farmLocation")} placeholder="Kano, Kano State" /></Field>
                  <Field label="Primary Crops (comma-separated)">
                    <TextInput value={specific.primaryCrops} onChange={updateSpecific("primaryCrops")} placeholder="Maize, Sorghum, Ginger" />
                  </Field>
                  <Field label="Farming Type">
                    <select value={specific.farmingType} onChange={e => updateSpecific("farmingType")(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 text-white rounded-md h-9 px-3 text-sm">
                      <option value="COMMERCIAL">Commercial</option>
                      <option value="SUBSISTENCE">Subsistence</option>
                      <option value="COOPERATIVE">Cooperative</option>
                    </select>
                  </Field>
                </>}
                {stakeholderType === "TRADER" && <>
                  <Field label="Trading Experience"><TextInput value={specific.tradingExperience} onChange={updateSpecific("tradingExperience")} placeholder="5 years commodity trading" /></Field>
                  <Field label="Capital Range (USD)"><TextInput value={specific.capitalRange} onChange={updateSpecific("capitalRange")} placeholder="$100K - $500K" /></Field>
                  <Field label="Preferred Markets (comma-separated)">
                    <TextInput value={specific.preferredMarkets} onChange={updateSpecific("preferredMarkets")} placeholder="Grains, Oilseeds, Metals" />
                  </Field>
                </>}
                {stakeholderType === "BROKER" && <>
                  <Field label="License Number" required><TextInput value={specific.licenseNumber} onChange={updateSpecific("licenseNumber")} placeholder="SEC/BRK/2024/001" /></Field>
                  <Field label="Regulatory Body" required><TextInput value={specific.regulatoryBody} onChange={updateSpecific("regulatoryBody")} placeholder="SEC Nigeria / CFTC" /></Field>
                  <Field label="Client Base Size"><TextInput value={specific.clientBase} onChange={updateSpecific("clientBase")} placeholder="50-100 active clients" /></Field>
                </>}
                {stakeholderType === "WAREHOUSE_OPERATOR" && <>
                  <Field label="Warehouse Name" required><TextInput value={specific.warehouseName} onChange={updateSpecific("warehouseName")} placeholder="Northern Grain Storage Ltd" /></Field>
                  <Field label="Warehouse Location" required><TextInput value={specific.warehouseLocation} onChange={updateSpecific("warehouseLocation")} placeholder="Kaduna, Kaduna State" /></Field>
                  <Field label="Storage Capacity (MT)"><TextInput value={specific.storageCapacity} onChange={updateSpecific("storageCapacity")} placeholder="10,000 MT" /></Field>
                  <Field label="Commodities Handled (comma-separated)">
                    <TextInput value={specific.commoditiesHandled} onChange={updateSpecific("commoditiesHandled")} placeholder="Maize, Wheat, Soya" />
                  </Field>
                  <Field label="Certifications (comma-separated)">
                    <TextInput value={specific.certifications} onChange={updateSpecific("certifications")} placeholder="ISO 22000, NAFDAC, CBN" />
                  </Field>
                </>}
                {stakeholderType === "MARKET_MAKER" && <>
                  <Field label="Trading Desk Name" required><TextInput value={specific.tradingDesk} onChange={updateSpecific("tradingDesk")} placeholder="Lagos Commodities Desk" /></Field>
                  <Field label="Liquidity Provided (comma-separated)">
                    <TextInput value={specific.liquidityProvided} onChange={updateSpecific("liquidityProvided")} placeholder="MAIZE-NG-SPOT, WHEAT-NG-SPOT" />
                  </Field>
                  <Field label="Minimum Spread (%)"><TextInput value={specific.minSpread} onChange={updateSpecific("minSpread")} placeholder="0.05" /></Field>
                </>}
                {stakeholderType === "ADMIN" && <>
                  <Field label="Department" required><TextInput value={specific.department} onChange={updateSpecific("department")} placeholder="Compliance / Operations / IT" /></Field>
                  <Field label="Admin Authorization Code" required><TextInput value={specific.adminCode} onChange={updateSpecific("adminCode")} placeholder="NEXCOM-ADMIN-XXXX" /></Field>
                </>}
              </div>
            </div>
          )}

          {/* Step 4: Documents */}
          {step === 4 && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Upload className="w-5 h-5 text-emerald-400" />
                <h2 className="text-lg font-bold">Document Upload</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-6">Upload the required documents for KYC verification. Accepted formats: PDF, JPG, PNG (max 5MB each).</p>
              <div className="space-y-3">
                {([
                  { id: "government_id", label: "Government-issued ID (NIN slip, International Passport, or Driver's License)", required: true },
                  { id: "proof_of_address", label: "Proof of Address (utility bill or bank statement, not older than 3 months)", required: true },
                  ...(stakeholderType === "FARMER" ? [
                    { id: "land_ownership", label: "Land ownership document or lease agreement", required: false },
                    { id: "cooperative_cert", label: "Cooperative membership certificate (if applicable)", required: false },
                  ] : []),
                  ...(stakeholderType === "BROKER" ? [
                    { id: "sec_license", label: "SEC / regulatory license certificate", required: true },
                    { id: "indemnity_insurance", label: "Professional indemnity insurance", required: false },
                  ] : []),
                  ...(stakeholderType === "WAREHOUSE_OPERATOR" ? [
                    { id: "warehouse_cert", label: "Warehouse certification / inspection report", required: true },
                    { id: "insurance_policy", label: "Insurance policy document", required: true },
                  ] : []),
                  ...(stakeholderType === "MARKET_MAKER" ? [
                    { id: "proof_of_capital", label: "Proof of capital / bank statement", required: true },
                    { id: "trading_infra", label: "Trading infrastructure description", required: false },
                  ] : []),
                  { id: "cac_certificate", label: "CAC Certificate of Incorporation (for entities)", required: false },
                ] as Array<{ id: string; label: string; required: boolean }>).map((doc) => {
                  const uploaded = uploadedDocs[doc.id];
                  const isUploading = uploadingDocId === doc.id;
  if (statusLoading) return <PageSkeleton cards={2} tableRows={4} tableCols={3} />;
                  return (
                    <div key={doc.id} className={`flex items-center gap-3 p-3 border rounded-lg transition-colors ${uploaded ? "bg-emerald-900/20 border-emerald-500/30" : "bg-white/5 border-white/10 hover:bg-white/10"}`}>
                      {uploaded
                        ? <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                        : <FileText className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                      }
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{doc.label}</p>
                        {uploaded
                          ? <p className="text-xs text-emerald-400 truncate">{uploaded.fileName}</p>
                          : <p className="text-xs text-muted-foreground">{doc.required ? "Required" : "Optional"}</p>
                        }
                      </div>
                      <input
                        ref={el => { docInputRefs.current[doc.id] = el; }}
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.webp"
                        className="hidden"
                        onChange={(e) => handleDocFileChange(doc.id, doc.label, e)}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isUploading}
                        onClick={() => docInputRefs.current[doc.id]?.click()}
                        className={`text-xs border-white/20 bg-transparent ${uploaded ? "text-emerald-400 border-emerald-500/40" : "text-muted-foreground hover:text-white"}`}
                      >
                        {isUploading
                          ? <><RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Uploading...</>
                          : uploaded
                            ? <><Upload className="w-3 h-3 mr-1" /> Replace</>
                            : <><Upload className="w-3 h-3 mr-1" /> Upload</>
                        }
                      </Button>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-4 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Files are uploaded securely to encrypted S3 storage. Accepted: PDF, JPG, PNG (max 5 MB each).
              </p>
            </div>
          )}

          {/* Step 5: Review & Submit */}
          {step === 5 && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Eye className="w-5 h-5 text-emerald-400" />
                <h2 className="text-lg font-bold">Review & Submit</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-6">Please review your information before submitting.</p>

              <div className="space-y-4 text-sm">
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    {selectedConfig && <selectedConfig.icon className="w-4 h-4 text-emerald-400" />}
                    <span className="font-semibold text-emerald-400">{selectedConfig?.label}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-muted-foreground">Name</span><div className="text-white">{personal.firstName} {personal.lastName}</div></div>
                    <div><span className="text-muted-foreground">Email</span><div className="text-white truncate">{personal.email}</div></div>
                    <div><span className="text-muted-foreground">Phone</span><div className="text-white">{personal.phone}</div></div>
                    <div><span className="text-muted-foreground">State</span><div className="text-white">{personal.state}, {personal.country}</div></div>
                    {business.companyName && <><div><span className="text-muted-foreground">Company</span><div className="text-white">{business.companyName}</div></div><div><span className="text-muted-foreground">RC Number</span><div className="text-white">{business.rcNumber || "—"}</div></div></>}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={agreedToTerms} onChange={e => setAgreedToTerms(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-emerald-500" />
                    <span className="text-xs text-muted-foreground">
                      I agree to the <span className="text-emerald-400 underline cursor-pointer">NEXCOM Exchange Terms of Service</span> and <span className="text-emerald-400 underline cursor-pointer">Trading Rules</span>. I confirm that all information provided is accurate and complete.
                    </span>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={agreedToKyc} onChange={e => setAgreedToKyc(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-emerald-500" />
                    <span className="text-xs text-muted-foreground">
                      I consent to the collection and processing of my personal data for KYC/AML compliance purposes in accordance with the <span className="text-emerald-400 underline cursor-pointer">Privacy Policy</span>.
                    </span>
                  </label>
                </div>

                {(!agreedToTerms || !agreedToKyc) && (
                  <p className="text-xs text-yellow-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Please agree to both checkboxes to submit.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center justify-between mt-6">
          <Button variant="outline" onClick={() => setStep(s => s - 1)} disabled={step === 0}
            className="border-white/20 text-muted-foreground hover:text-white bg-transparent gap-2">
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>

          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep(s => s + 1)} disabled={!canProceed()}
              className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2">
              Continue <ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit}
              disabled={!agreedToTerms || !agreedToKyc || submitMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2 min-w-[140px]">
              {submitMutation.isPending
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> Submitting…</>
                : <><CheckCircle2 className="w-4 h-4" /> Submit Application</>
              }
            </Button>
          )}
        </div>
      </div>

      {/* Cooperative Bulk KYC Upload Panel */}
      <div className="max-w-3xl mx-auto px-4 pb-12 mt-8">
        <button
          onClick={() => setShowBulkPanel(v => !v)}
          className="w-full flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-5 py-4 hover:bg-white/8 transition-colors group"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-amber-400" />
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold text-white">Cooperative Bulk KYC Upload</div>
              <div className="text-xs text-muted-foreground">Fast-track KYC for multiple farmers via CSV upload</div>
            </div>
          </div>
          <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${showBulkPanel ? "rotate-90" : ""}`} />
        </button>

        {showBulkPanel && (
          <div className="mt-3 bg-white/5 border border-white/10 rounded-xl p-6 space-y-5">
            <div>
              <h3 className="text-base font-bold text-white mb-1">Bulk KYC — Cooperative Administrator</h3>
              <p className="text-xs text-muted-foreground">
                Upload a CSV file with your cooperative members' details. Each row creates a pending KYC application.
                Required columns: <span className="text-amber-300 font-mono">firstName, lastName, phone, state, address</span>.
                Optional: <span className="font-mono text-muted-foreground">bvn, nin, email</span>.
              </p>
            </div>

            {/* CSV Template download */}
            <button
              onClick={() => {
                const csv = "firstName,lastName,phone,bvn,nin,state,address,email\nAminatu,Musa,08012345678,22222222222,,Kano,12 Farm Road Kano,aminatu@example.com\nEmeka,Obi,07098765432,,,Enugu,5 Market Street Enugu,";
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a"); a.href = url; a.download = "nexcom_bulk_kyc_template.csv"; a.click();
                URL.revokeObjectURL(url);
              }}
              className="flex items-center gap-2 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Download CSV Template
            </button>

            {/* Cooperative name */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Cooperative Name <span className="text-red-400">*</span></Label>
              <Input
                value={bulkCoopName}
                onChange={e => setBulkCoopName(e.target.value)}
                placeholder="e.g. Kano Ginger Farmers Cooperative"
                className="bg-white/5 border-white/10 text-white placeholder:text-gray-600 h-9 text-sm"
              />
            </div>

            {/* File upload */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">CSV File <span className="text-red-400">*</span></Label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-white/10 rounded-lg p-6 text-center cursor-pointer hover:border-amber-500/40 transition-colors"
              >
                <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                {bulkFileName
                  ? <p className="text-sm text-amber-300 font-medium">{bulkFileName}</p>
                  : <p className="text-sm text-muted-foreground">Click to select a CSV file</p>
                }
                <p className="text-xs text-gray-600 mt-1">Max 500 rows per upload</p>
              </div>
              <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleBulkFileChange} />
            </div>

            {/* Parse error */}
            {bulkParseError && (
              <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {bulkParseError}
              </div>
            )}

            {/* Preview table */}
            {bulkPreview.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">{bulkPreview.length} member{bulkPreview.length !== 1 ? "s" : ""} detected</span>
                  <Badge variant="outline" className="text-amber-400 border-amber-400/30 text-xs">{bulkPreview.length} rows</Badge>
                </div>
                <div className="overflow-x-auto rounded-lg border border-white/10">
                  <table className="w-full text-xs">
                    <thead className="bg-white/5">
                      <tr>
                        {Object.keys(bulkPreview[0]).slice(0, 6).map(h => (
                          <th key={h} className="px-3 py-2 text-left text-muted-foreground font-medium capitalize">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bulkPreview.slice(0, 5).map((row, i) => (
                        <tr key={i} className="border-t border-white/5 hover:bg-white/3">
                          {Object.values(row).slice(0, 6).map((val, j) => (
                            <td key={j} className="px-3 py-2 text-muted-foreground truncate max-w-[120px]">{val || "—"}</td>
                          ))}
                        </tr>
                      ))}
                      {bulkPreview.length > 5 && (
                        <tr className="border-t border-white/5">
                          <td colSpan={6} className="px-3 py-2 text-center text-muted-foreground text-xs">…and {bulkPreview.length - 5} more rows</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Upload result */}
            {bulkUploadMutation.data && (
              <div className={`rounded-lg border px-4 py-3 text-sm ${
                bulkUploadMutation.data.status === "COMPLETED" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                : bulkUploadMutation.data.status === "PARTIAL" ? "bg-amber-500/10 border-amber-500/20 text-amber-300"
                : "bg-red-500/10 border-red-500/20 text-red-300"
              }`}>
                <div className="font-semibold mb-1">
                  {bulkUploadMutation.data.status === "COMPLETED" ? "✓ Upload Successful"
                  : bulkUploadMutation.data.status === "PARTIAL" ? "⚠ Partial Upload"
                  : "✗ Upload Failed"}
                </div>
                <div className="text-xs space-y-0.5">
                  <div>Total rows: {bulkUploadMutation.data.total}</div>
                  <div>Applications created: {bulkUploadMutation.data.success}</div>
                  {bulkUploadMutation.data.failed > 0 && <div>Failed: {bulkUploadMutation.data.failed}</div>}
                  {bulkUploadMutation.data.errors.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {bulkUploadMutation.data.errors.slice(0, 5).map((e, i) => (
                        <div key={i} className="font-mono">Row {e.row} ({e.name}): {e.reason}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <Button
              onClick={handleBulkSubmit}
              disabled={bulkPreview.length === 0 || !bulkCoopName.trim() || bulkUploadMutation.isPending}
              className="w-full bg-amber-600 hover:bg-amber-500 text-white gap-2"
            >
              {bulkUploadMutation.isPending
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> Processing {bulkPreview.length} members…</>
                : <><Users className="w-4 h-4" /> Submit {bulkPreview.length > 0 ? bulkPreview.length : ""} KYC Applications</>
              }
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
