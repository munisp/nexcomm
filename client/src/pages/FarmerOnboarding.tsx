/**
 * NEXCOM Exchange — Farmer Onboarding PWA
 * Mobile-first, offline-capable 6-step onboarding wizard.
 *
 * Steps:
 *   1. Splash / Welcome
 *   2. Personal Information  (name, phone, NIN, BVN, state, LGA)
 *   3. Bank / Mobile Money   (payment details)
 *   4. KYC Documents         (NIN slip, BVN confirmation, passport photo, utility bill)
 *   5. Review & Submit
 *   6. Add Your Farm         (unlocked only after KYC status = APPROVED)
 *
 * Notes:
 *   - Step 6 is locked (shown as a teaser) until kycStatus === "APPROVED"
 *   - addFarm is enforced by backend (rejects if kycStatus !== APPROVED)
 *   - Draft auto-saved server-side after every step via trpc.farmer.saveDraft
 *   - Offline indicator + PWA install prompt
 */
import { useState, useEffect, useRef, useCallback } from "react";
import OSMMapDraw, { type PinLocation, type BoundaryStats } from "@/components/OSMMapDraw";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  User,
  Landmark,
  FileText,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Upload,
  Loader2,
  Smartphone,
  Wifi,
  WifiOff,
  Download,
  Leaf,
  Shield,
  AlertCircle,
  X,
  Eye,
  Sprout,
  ArrowRight,
  TrendingUp,
  ShieldCheck,
  Wheat,
  Users,
  Lock,
  MapPin,
  Tractor,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const NIGERIAN_STATES = [
  "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno",
  "Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT","Gombe","Imo",
  "Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa",
  "Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba",
  "Yobe","Zamfara",
];

const MOBILE_MONEY_PROVIDERS = [
  "MTN MoMo","Airtel Money","Glo Pay","9mobile Pay","OPay","PalmPay","Kuda","Moniepoint",
];

const DOCUMENT_TYPES = [
  { value: "nin_slip",         label: "NIN Slip",           required: true  },
  { value: "bvn_confirmation", label: "BVN Confirmation",   required: true  },
  { value: "passport_photo",   label: "Passport Photo",     required: true  },
  { value: "utility_bill",     label: "Utility Bill",       required: false },
  { value: "farm_photo",       label: "Farm Photo",         required: false },
];

const SOIL_TYPES = [
  { value: "LOAMY",  label: "Loamy"  },
  { value: "CLAY",   label: "Clay"   },
  { value: "SANDY",  label: "Sandy"  },
  { value: "SILT",   label: "Silt"   },
  { value: "PEAT",   label: "Peat"   },
  { value: "CHALK",  label: "Chalk"  },
  { value: "OTHER",  label: "Other"  },
];

// Steps: 1=splash, 2=personal, 3=bank, 4=docs, 5=review, 6=add-farm
const STEP_TITLES = ["Welcome", "Personal Info", "Bank / Wallet", "KYC Documents", "Review & Submit", "Add Your Farm"];

// ─── Types ────────────────────────────────────────────────────────────────────

interface PersonalInfo {
  fullName: string;
  phone: string;
  nin: string;
  bvn: string;
  state: string;
  lga: string;
}

interface BankDetails {
  paymentMethod: "bank" | "mobile_money";
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  mobileMoneyProvider: string;
  mobileMoneyNumber: string;
}

interface UploadedDoc {
  documentType: string;
  documentLabel: string;
  fileUrl: string;
  fileName: string;
  fileSize: number;
}

interface FarmInfo {
  farmName: string;
  sizeHectares: string;
  state: string;
  lga: string;
  soilType: string;
  description: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

// ─── Step 2: Personal Info ────────────────────────────────────────────────────

function StepPersonal({ data, onChange }: { data: PersonalInfo; onChange: (d: PersonalInfo) => void }) {
  const set = (k: keyof PersonalInfo) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...data, [k]: e.target.value });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="fullName" className="text-slate-300">Full Legal Name <span className="text-red-400">*</span></Label>
          <Input id="fullName" placeholder="As on NIN card" value={data.fullName} onChange={set("fullName")}
            className="bg-slate-800 border-slate-600 text-white h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone" className="text-slate-300">Phone Number <span className="text-red-400">*</span></Label>
          <Input id="phone" type="tel" placeholder="08012345678" value={data.phone} onChange={set("phone")}
            className="bg-slate-800 border-slate-600 text-white h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nin" className="text-slate-300">NIN (optional)</Label>
          <Input id="nin" placeholder="11-digit NIN" maxLength={11} value={data.nin} onChange={set("nin")}
            className="bg-slate-800 border-slate-600 text-white h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bvn" className="text-slate-300">BVN (optional)</Label>
          <Input id="bvn" placeholder="11-digit BVN" maxLength={11} value={data.bvn} onChange={set("bvn")}
            className="bg-slate-800 border-slate-600 text-white h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="state" className="text-slate-300">State <span className="text-red-400">*</span></Label>
          <Select value={data.state} onValueChange={v => onChange({ ...data, state: v })}>
            <SelectTrigger id="state" className="bg-slate-800 border-slate-600 text-white h-11">
              <SelectValue placeholder="Select state" />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600">
              {NIGERIAN_STATES.map(s => <SelectItem key={s} value={s} className="text-white">{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lga" className="text-slate-300">LGA <span className="text-red-400">*</span></Label>
          <Input id="lga" placeholder="Local Government Area" value={data.lga} onChange={set("lga")}
            className="bg-slate-800 border-slate-600 text-white h-11" />
        </div>
      </div>
      <p className="text-xs text-slate-500 flex items-center gap-1.5 pt-1">
        <Shield className="h-3.5 w-3.5 text-green-500 shrink-0" />
        NIN and BVN are encrypted at rest and used only for KYC verification.
      </p>
    </div>
  );
}

// ─── Step 3: Bank / Mobile Money ──────────────────────────────────────────────

function StepBank({ data, onChange }: { data: BankDetails; onChange: (d: BankDetails) => void }) {
  const set = (k: keyof BankDetails) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...data, [k]: e.target.value });
  return (
    <div className="space-y-5">
      <div className="flex gap-3">
        <button type="button" onClick={() => onChange({ ...data, paymentMethod: "bank" })}
          className={`flex-1 flex items-center gap-2 rounded-lg border-2 p-3 text-sm font-medium transition-colors ${data.paymentMethod === "bank" ? "border-green-500 bg-green-500/10 text-green-400" : "border-slate-600 text-slate-400 hover:border-slate-500"}`}>
          <Landmark className="h-4 w-4 shrink-0" /> Bank Account
        </button>
        <button type="button" onClick={() => onChange({ ...data, paymentMethod: "mobile_money" })}
          className={`flex-1 flex items-center gap-2 rounded-lg border-2 p-3 text-sm font-medium transition-colors ${data.paymentMethod === "mobile_money" ? "border-green-500 bg-green-500/10 text-green-400" : "border-slate-600 text-slate-400 hover:border-slate-500"}`}>
          <Smartphone className="h-4 w-4 shrink-0" /> Mobile Money
        </button>
      </div>
      {data.paymentMethod === "bank" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-slate-300">Bank Name <span className="text-red-400">*</span></Label>
            <Input placeholder="e.g. First Bank Nigeria" value={data.bankName} onChange={set("bankName")}
              className="bg-slate-800 border-slate-600 text-white h-11" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-slate-300">Account Number <span className="text-red-400">*</span></Label>
            <Input placeholder="10-digit NUBAN" maxLength={10} value={data.bankAccountNumber} onChange={set("bankAccountNumber")}
              className="bg-slate-800 border-slate-600 text-white h-11" />
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <Label className="text-slate-300">Account Name <span className="text-red-400">*</span></Label>
            <Input placeholder="As registered with your bank" value={data.bankAccountName} onChange={set("bankAccountName")}
              className="bg-slate-800 border-slate-600 text-white h-11" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-slate-300">Provider <span className="text-red-400">*</span></Label>
            <Select value={data.mobileMoneyProvider} onValueChange={v => onChange({ ...data, mobileMoneyProvider: v })}>
              <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-11">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                {MOBILE_MONEY_PROVIDERS.map(p => <SelectItem key={p} value={p} className="text-white">{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-slate-300">Mobile Number <span className="text-red-400">*</span></Label>
            <Input type="tel" placeholder="08012345678" value={data.mobileMoneyNumber} onChange={set("mobileMoneyNumber")}
              className="bg-slate-800 border-slate-600 text-white h-11" />
          </div>
        </div>
      )}
      <p className="text-xs text-slate-500 flex items-center gap-1.5">
        <Shield className="h-3.5 w-3.5 text-green-500 shrink-0" />
        Payment details are used to credit commodity sale proceeds to your account.
      </p>
    </div>
  );
}

// ─── Step 4: KYC Documents ────────────────────────────────────────────────────

function StepDocuments({ docs, onUpload, onRemove, uploading }: {
  docs: UploadedDoc[];
  onUpload: (docType: string, file: File) => Promise<void>;
  onRemove: (docType: string) => void;
  uploading: string | null;
}) {
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        Upload clear, legible copies. Accepted: PDF, JPEG, PNG, WEBP (max 10 MB each).
      </p>
      {DOCUMENT_TYPES.map(({ value, label, required }) => {
        const uploaded = docs.find(d => d.documentType === value);
        const isUploading = uploading === value;
        return (
          <div key={value}
            className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${uploaded ? "border-green-500/40 bg-green-500/5" : "border-slate-700 bg-slate-800/40"}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">{label}</span>
                {required && <Badge className="text-[10px] px-1.5 py-0 bg-slate-700 text-slate-300 border-0">Required</Badge>}
              </div>
              {uploaded ? (
                <p className="text-xs text-slate-400 truncate mt-0.5">{uploaded.fileName} · {formatBytes(uploaded.fileSize)}</p>
              ) : (
                <p className="text-xs text-slate-500 mt-0.5">No file selected</p>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {uploaded && (
                <>
                  <a href={uploaded.fileUrl} target="_blank" rel="noopener noreferrer">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-white" aria-label="Preview">
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  </a>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-300" onClick={() => onRemove(value)} aria-label="Remove">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
              <Button
                variant={uploaded ? "outline" : "default"}
                size="sm"
                className={`h-7 text-xs ${!uploaded ? "bg-green-600 hover:bg-green-700 text-white border-0" : "border-slate-600 text-slate-300"}`}
                disabled={isUploading}
                onClick={() => fileInputRefs.current[value]?.click()}
              >
                {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
                {uploaded ? "Replace" : "Upload"}
              </Button>
              <input
                ref={el => { fileInputRefs.current[value] = el; }}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) onUpload(value, file);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 5: Review ───────────────────────────────────────────────────────────

function StepReview({ personal, bank, docs }: { personal: PersonalInfo; bank: BankDetails; docs: UploadedDoc[] }) {
  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex justify-between items-center px-3 py-2 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-white text-right max-w-[60%] truncate">{value || "—"}</span>
    </div>
  );
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold text-green-400 uppercase tracking-wider px-1">{title}</h3>
      <div className="rounded-lg border border-slate-700 divide-y divide-slate-700/60 bg-slate-800/40">
        {children}
      </div>
    </div>
  );
  const requiredDocs = DOCUMENT_TYPES.filter(d => d.required);
  const missingRequired = requiredDocs.filter(d => !docs.some(u => u.documentType === d.value));
  return (
    <div className="space-y-4">
      {missingRequired.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-900/20 p-3 text-sm text-amber-300">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Required KYC documents are missing.</p>
            <p className="text-xs text-amber-400 mt-0.5">Go back to Step 3 and upload them.</p>
          </div>
        </div>
      )}
      <Section title="Personal Information">
        <Row label="Full Name" value={personal.fullName} />
        <Row label="Phone" value={personal.phone} />
        <Row label="NIN" value={personal.nin ? "Provided" : "Not provided"} />
        <Row label="BVN" value={personal.bvn ? "Provided" : "Not provided"} />
        <Row label="State" value={personal.state} />
        <Row label="LGA" value={personal.lga} />
      </Section>
      <Section title="Payment Details">
        <Row label="Method" value={personal.phone ? (bank.paymentMethod === "bank" ? "Bank Account" : "Mobile Money") : "—"} />
        {bank.paymentMethod === "bank" ? (
          <>
            <Row label="Bank" value={bank.bankName} />
            <Row label="Account No." value={bank.bankAccountNumber ? `••••••${bank.bankAccountNumber.slice(-4)}` : "—"} />
            <Row label="Account Name" value={bank.bankAccountName} />
          </>
        ) : (
          <>
            <Row label="Provider" value={bank.mobileMoneyProvider} />
            <Row label="Number" value={bank.mobileMoneyNumber ? `••••••${bank.mobileMoneyNumber.slice(-4)}` : "—"} />
          </>
        )}
      </Section>
      <Section title="KYC Documents">
        {DOCUMENT_TYPES.map(dt => {
          const uploaded = docs.find(d => d.documentType === dt.value);
          return (
            <div key={dt.value} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-slate-400">{dt.label}</span>
              {uploaded ? (
                <span className="flex items-center gap-1 text-green-400 text-xs font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Uploaded
                </span>
              ) : (
                <span className={`text-xs font-medium ${dt.required ? "text-red-400" : "text-slate-500"}`}>
                  {dt.required ? "Missing" : "Optional"}
                </span>
              )}
            </div>
          );
        })}
      </Section>
      {/* Step 6 preview — locked until KYC approved */}
      <div className="rounded-lg border border-slate-700/60 bg-slate-800/20 p-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-slate-700/60 border border-slate-600/40 flex items-center justify-center shrink-0">
            <Lock className="h-4 w-4 text-slate-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-300">Step 5: Add Your Farm</p>
            <p className="text-xs text-slate-500 mt-0.5">Unlocks after KYC approval (1–2 business days)</p>
          </div>
          <Badge className="bg-slate-700/60 text-slate-400 border-slate-600/40 text-[10px]">Locked</Badge>
        </div>
      </div>
    </div>
  );
}

// ─── Step 6: Add Your Farm ────────────────────────────────────────────────────

function StepAddFarm({ data, onChange, kycStatus, farmPin, onPinChange, farmBoundary, onBoundaryChange, onBoundaryStats }: {
  data: FarmInfo;
  onChange: (d: FarmInfo) => void;
  kycStatus: string;
  farmPin: PinLocation | null;
  onPinChange: (loc: PinLocation | null) => void;
  farmBoundary: GeoJSON.Feature<GeoJSON.Polygon> | null;
  onBoundaryChange: (b: GeoJSON.Feature<GeoJSON.Polygon> | null) => void;
  onBoundaryStats: (s: BoundaryStats) => void;
}) {
  const set = (k: keyof FarmInfo) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ ...data, [k]: e.target.value });

  // Auto-fill hectares from Sedona boundary-stats when polygon is drawn
  const handleBoundaryStats = (stats: BoundaryStats) => {
    onBoundaryStats(stats);
    if (stats.area_ha > 0 && (!data.sizeHectares || data.sizeHectares === "")) {
      onChange({ ...data, sizeHectares: stats.area_ha.toFixed(2) });
    }
  };

  if (kycStatus !== "APPROVED") {
    return (
      <div className="space-y-4 text-center py-8">
        <div className="flex justify-center">
          <div className="h-20 w-20 rounded-full bg-amber-900/30 border-2 border-amber-700/40 flex items-center justify-center">
            <Lock className="h-10 w-10 text-amber-400" />
          </div>
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-bold text-white">KYC Approval Required</h3>
          <p className="text-slate-400 text-sm max-w-xs mx-auto">
            This step unlocks once our compliance team approves your KYC documents.
            You'll receive a notification when it's ready.
          </p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4 text-sm text-left space-y-2 max-w-xs mx-auto">
          <p className="font-medium text-slate-300 text-center">Current KYC Status</p>
          <div className="flex items-center justify-center gap-2 pt-1">
            {kycStatus === "SUBMITTED" || kycStatus === "UNDER_REVIEW" ? (
              <Badge className="bg-amber-900/60 text-amber-300 border-amber-700">
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                {kycStatus === "UNDER_REVIEW" ? "Under Review" : "Submitted"}
              </Badge>
            ) : kycStatus === "REJECTED" ? (
              <Badge className="bg-red-900/60 text-red-300 border-red-700">
                <X className="h-3 w-3 mr-1" /> Rejected
              </Badge>
            ) : (
              <Badge className="bg-slate-700/60 text-slate-400 border-slate-600">
                <AlertCircle className="h-3 w-3 mr-1" /> Pending
              </Badge>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-lg border border-green-700/40 bg-green-900/20 p-3 text-sm text-green-300">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>KYC approved! You can now register your farm and start listing commodities.</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2 space-y-1.5">
          <Label className="text-slate-300">Farm Name <span className="text-red-400">*</span></Label>
          <Input placeholder="e.g. Adeyemi Green Farms" value={data.farmName} onChange={set("farmName")}
            className="bg-slate-800 border-slate-600 text-white h-11" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300">Farm Size (hectares) <span className="text-red-400">*</span></Label>
          <Input type="number" min="0.1" step="0.1" placeholder="e.g. 5.5" value={data.sizeHectares} onChange={set("sizeHectares")}
            className="bg-slate-800 border-slate-600 text-white h-11" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300">Soil Type</Label>
          <Select value={data.soilType} onValueChange={v => onChange({ ...data, soilType: v })}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-11">
              <SelectValue placeholder="Select soil type" />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600">
              {SOIL_TYPES.map(st => <SelectItem key={st.value} value={st.value} className="text-white">{st.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300">Farm State <span className="text-red-400">*</span></Label>
          <Select value={data.state} onValueChange={v => onChange({ ...data, state: v })}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-11">
              <SelectValue placeholder="Select state" />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600">
              {NIGERIAN_STATES.map(s => <SelectItem key={s} value={s} className="text-white">{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300">Farm LGA <span className="text-red-400">*</span></Label>
          <Input placeholder="Local Government Area" value={data.lga} onChange={set("lga")}
            className="bg-slate-800 border-slate-600 text-white h-11" />
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <Label className="text-slate-300">Description (optional)</Label>
          <textarea
            placeholder="Describe your farm — crops grown, irrigation, certifications…"
            value={data.description}
            onChange={set("description")}
            rows={3}
            className="w-full rounded-md border border-slate-600 bg-slate-800 text-white text-sm px-3 py-2 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-green-500/40 resize-none"
          />
        </div>
      </div>

      {/* GPS Pin + Polygon Boundary — MapLibre GL + OpenStreetMap + Terra Draw */}
      <div className="space-y-2">
        <Label className="text-slate-300 flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-green-400" />
          Farm Location & Boundary
          <span className="text-slate-500 font-normal text-xs">(tap to pin · draw boundary polygon)</span>
        </Label>
        <OSMMapDraw
          onPinChange={onPinChange}
          onBoundaryChange={onBoundaryChange}
          onBoundaryStats={handleBoundaryStats}
          initialPin={farmPin}
          initialBoundary={farmBoundary}
          height="320px"
          showDrawTools={true}
        />
        {farmPin && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="font-mono text-green-400">
              {farmPin.lat.toFixed(5)}, {farmPin.lng.toFixed(5)}
            </span>
            {farmPin.address && (
              <><span className="text-slate-600">·</span><span className="truncate">{farmPin.address}</span></>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function FarmerOnboarding() {
  const [, navigate] = useLocation();
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const online = useOnlineStatus();

  // step: 1=splash, 2=personal, 3=bank, 4=docs, 5=review, 6=add-farm
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [farmAdded, setFarmAdded] = useState(false);

  const [personal, setPersonal] = useState<PersonalInfo>({
    fullName: "", phone: "", nin: "", bvn: "", state: "", lga: "",
  });
  const [bank, setBank] = useState<BankDetails>({
    paymentMethod: "bank", bankName: "", bankAccountNumber: "",
    bankAccountName: "", mobileMoneyProvider: "", mobileMoneyNumber: "",
  });
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const [farm, setFarm] = useState<FarmInfo>({
    farmName: "", sizeHectares: "", state: "", lga: "", soilType: "LOAMY", description: "",
  });
  const [farmPin, setFarmPin] = useState<PinLocation | null>(null);
  const [farmBoundary, setFarmBoundary] = useState<GeoJSON.Feature<GeoJSON.Polygon> | null>(null);
  const [farmBoundaryStats, setFarmBoundaryStats] = useState<BoundaryStats | null>(null);

  // PWA install prompt
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e as BeforeInstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // tRPC
  const utils = trpc.useUtils();
  const { data: draftData } = trpc.farmer.getDraft.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 30_000,
  });
  // Fetch farmer profile to check kycStatus for Step 6
  const { data: farmerProfile } = trpc.farmer.getMyFarmerProfile.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 30_000,
  });
  const kycStatus = farmerProfile?.kycStatus ?? "PENDING";

  const saveDraftMutation = trpc.farmer.saveDraft.useMutation();
  const deleteDraftMutation = trpc.farmer.deleteDraft.useMutation();
  const registerFarmerMutation = trpc.farmer.registerFarmer.useMutation();
  const updateBankMutation = trpc.farmer.updateBankDetails.useMutation();
  const submitKycMutation = trpc.farmer.submitKYC.useMutation();
  const updateStepMutation = trpc.farmer.updateOnboardingStep.useMutation();
  const addFarmMutation = trpc.farmer.addFarm.useMutation({
    onSuccess: () => {
      utils.farmer.getMyFarms.invalidate();
    },
  });

  // Restore draft
  useEffect(() => {
    if (!draftData) return;
    const p = draftData.payload as Record<string, unknown>;
    if (p.personal) setPersonal(p.personal as PersonalInfo);
    if (p.bank) setBank(p.bank as BankDetails);
    if (p.docs) setDocs(p.docs as UploadedDoc[]);
    if (draftData.step && draftData.step > 1 && draftData.step < 5) setStep(draftData.step);
  }, [draftData]);

  // Pre-fill name
  useEffect(() => {
    if (user?.name && !personal.fullName) setPersonal(prev => ({ ...prev, fullName: user.name ?? "" }));
  }, [user]);

  // Pre-fill farm state/lga from personal info
  useEffect(() => {
    if (personal.state && !farm.state) setFarm(prev => ({ ...prev, state: personal.state, lga: personal.lga }));
  }, [personal.state, personal.lga]);

  const autoSaveDraft = useCallback((currentStep: number) => {
    if (!isAuthenticated) return;
    saveDraftMutation.mutate({ step: currentStep, payload: { personal, bank, docs } });
  }, [isAuthenticated, personal, bank, docs]);

  // Only block steps 2+ on auth loading — splash (step 1) renders immediately
  if (step > 1 && authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-950 to-slate-950 flex items-center justify-center">
        <Sprout className="h-10 w-10 text-green-400 animate-pulse" />
      </div>
    );
  }

  if (step > 1 && !authLoading && !isAuthenticated) {
    window.location.href = getLoginUrl();
    return null;
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  function validateStep(s: number): string | null {
    if (s === 2) {
      if (!personal.fullName.trim()) return "Full name is required.";
      if (!personal.phone.trim()) return "Phone number is required.";
      if (!personal.state) return "State is required.";
      if (!personal.lga.trim()) return "LGA is required.";
    }
    if (s === 3) {
      if (bank.paymentMethod === "bank") {
        if (!bank.bankName.trim()) return "Bank name is required.";
        if (!bank.bankAccountNumber.trim()) return "Account number is required.";
        if (!bank.bankAccountName.trim()) return "Account name is required.";
      } else {
        if (!bank.mobileMoneyProvider) return "Mobile money provider is required.";
        if (!bank.mobileMoneyNumber.trim()) return "Mobile money number is required.";
      }
    }
    if (s === 6) {
      if (!farm.farmName.trim()) return "Farm name is required.";
      const size = parseFloat(farm.sizeHectares);
      if (!farm.sizeHectares || isNaN(size) || size <= 0) return "Farm size must be a positive number.";
      if (!farm.state) return "Farm state is required.";
      if (!farm.lga.trim()) return "Farm LGA is required.";
    }
    return null;
  }

  function handleNext() {
    const err = validateStep(step);
    if (err) { toast.error(err); return; }
    const next = step + 1;
    setStep(next);
    if (isAuthenticated) {
      autoSaveDraft(next);
      updateStepMutation.mutate({ step: next });
    }
  }

  function handleBack() {
    const prev = step - 1;
    setStep(prev);
    if (isAuthenticated) autoSaveDraft(prev);
  }

  // ── Document upload ─────────────────────────────────────────────────────────
  async function handleDocUpload(docType: string, file: File) {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large — maximum file size is 10 MB.");
      return;
    }
    setUploadingDoc(docType);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("documentType", docType);
      const res = await fetch("/api/farmer/kyc-upload", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Upload failed");
      }
      const result = await res.json() as UploadedDoc;
      setDocs(prev => [...prev.filter(d => d.documentType !== docType), result]);
      toast.success(`${result.documentLabel} uploaded successfully.`);
    } catch (err) {
      toast.error((err as Error).message ?? "Upload failed");
    } finally {
      setUploadingDoc(null);
    }
  }

  function handleDocRemove(docType: string) {
    setDocs(prev => prev.filter(d => d.documentType !== docType));
  }

  // ── Final submission (steps 2–5) ────────────────────────────────────────────
  async function handleSubmit() {
    const requiredDocs = DOCUMENT_TYPES.filter(d => d.required);
    const missingDocs = requiredDocs.filter(d => !docs.some(u => u.documentType === d.value));
    if (missingDocs.length > 0) {
      toast.error(`Please upload: ${missingDocs.map(d => d.label).join(", ")}`);
      return;
    }
    setSubmitting(true);
    try {
      await registerFarmerMutation.mutateAsync({
        fullName: personal.fullName,
        phone: personal.phone,
        nin: personal.nin || undefined,
        bvn: personal.bvn || undefined,
        state: personal.state,
        lga: personal.lga,
      });
      await updateBankMutation.mutateAsync({
        bankName: bank.paymentMethod === "bank" ? bank.bankName : undefined,
        bankAccountNumber: bank.paymentMethod === "bank" ? bank.bankAccountNumber : undefined,
        bankAccountName: bank.paymentMethod === "bank" ? bank.bankAccountName : undefined,
        mobileMoneyProvider: bank.paymentMethod === "mobile_money" ? bank.mobileMoneyProvider : undefined,
        mobileMoneyNumber: bank.paymentMethod === "mobile_money" ? bank.mobileMoneyNumber : undefined,
      });
      const ninDoc = docs.find(d => d.documentType === "nin_slip");
      const bvnDoc = docs.find(d => d.documentType === "bvn_confirmation");
      const allDocUrls = docs.reduce((acc, d) => ({ ...acc, [d.documentType]: d.fileUrl }), {});
      await submitKycMutation.mutateAsync({
        ninDocumentUrl: ninDoc?.fileUrl,
        bvnDocumentUrl: bvnDoc?.fileUrl,
        kycDocuments: JSON.stringify(allDocUrls),
      });
      await deleteDraftMutation.mutateAsync(undefined);
      setSubmitted(true);
    } catch (err) {
      const msg = (err as Error).message ?? "Submission failed.";
      if (msg.includes("already exists")) { setSubmitted(true); return; }
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Add Farm submission (step 6) ────────────────────────────────────────────
  async function handleAddFarm() {
    const err = validateStep(6);
    if (err) { toast.error(err); return; }
    setSubmitting(true);
    try {
      await addFarmMutation.mutateAsync({
        farmName: farm.farmName,
        sizeHectares: parseFloat(farm.sizeHectares),
        state: farm.state,
        lga: farm.lga,
        soilType: farm.soilType as "LOAMY" | "CLAY" | "SANDY" | "SILT" | "PEAT" | "CHALK" | "OTHER",
        description: farm.description || undefined,
        latitude: farmPin?.lat,
        longitude: farmPin?.lng,
        boundary: farmBoundary ? {
            type: "Polygon" as const,
            coordinates: farmBoundary.geometry.coordinates.map(ring =>
              ring.map(pos => [pos[0], pos[1]] as [number, number])
            ),
          } : undefined,
      });
      setFarmAdded(true);
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to add farm.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Farm added success screen ───────────────────────────────────────────────
  if (farmAdded) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-950 to-slate-950 flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center space-y-6">
          <div className="flex justify-center">
            <div className="h-20 w-20 rounded-full bg-green-500/20 border-2 border-green-500/40 flex items-center justify-center">
              <Tractor className="h-10 w-10 text-green-400" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-white">Farm Registered!</h1>
            <p className="text-slate-400 text-sm">
              <span className="text-green-400 font-medium">{farm.farmName}</span> has been added to your profile.
              You can now list your crops on the exchange.
            </p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4 text-sm text-left space-y-2">
            <p className="font-medium text-slate-300">What's next?</p>
            {[
              "Go to your Farmer Dashboard to manage your farm",
              "List your first crop for sale on the exchange",
              "Join a cooperative to access bulk pricing",
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
                <p className="text-slate-400 text-xs">{item}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <Button className="w-full h-11 bg-green-600 hover:bg-green-700 text-white" onClick={() => navigate("/farmer-dashboard")}>
              Go to Farmer Dashboard <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
            <Button variant="outline" className="w-full h-11 border-slate-600 text-slate-300 hover:bg-slate-800"
              onClick={() => { setFarmAdded(false); setFarm({ farmName: "", sizeHectares: "", state: "", lga: "", soilType: "LOAMY", description: "" }); }}>
              Add Another Farm
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── KYC submission success screen ──────────────────────────────────────────
  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-950 to-slate-950 flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center space-y-6">
          <div className="flex justify-center">
            <div className="h-20 w-20 rounded-full bg-green-500/20 border-2 border-green-500/40 flex items-center justify-center">
              <CheckCircle2 className="h-10 w-10 text-green-400" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-white">Registration Submitted!</h1>
            <p className="text-slate-400 text-sm">
              Your profile and KYC documents are under review. You'll be notified within 1–2 business days.
            </p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4 text-sm text-left space-y-2">
            <p className="font-medium text-slate-300">What happens next?</p>
            {[
              "Compliance team reviews your KYC documents",
              "You receive an SMS/push notification on approval",
              "Step 5 unlocks — add your farm and start listing commodities",
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
                <p className="text-slate-400 text-xs">{item}</p>
              </div>
            ))}
          </div>
          {/* If KYC is already approved (re-registration edge case), show Step 6 CTA */}
          {kycStatus === "APPROVED" ? (
            <Button className="w-full h-11 bg-green-600 hover:bg-green-700 text-white" onClick={() => setStep(6)}>
              <Tractor className="h-4 w-4 mr-2" /> Add Your Farm Now
            </Button>
          ) : (
            <Button className="w-full h-11 bg-green-600 hover:bg-green-700 text-white" onClick={() => navigate("/farmer-dashboard")}>
              Go to Dashboard <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── Splash screen (step 1) ──────────────────────────────────────────────────
  if (step === 1) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-950 via-slate-900 to-slate-950 flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          {/* Install prompt */}
          {installPrompt && (
            <div className="w-full max-w-sm mb-4 flex items-center justify-between rounded-xl border border-green-700/40 bg-green-900/30 px-4 py-2.5 text-sm">
              <span className="text-green-300 flex items-center gap-2"><Smartphone className="h-4 w-4" /> Install NEXCOM Farmer App</span>
              <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                onClick={() => { installPrompt.prompt(); setInstallPrompt(null); }}>
                <Download className="h-3 w-3 mr-1" /> Install
              </Button>
            </div>
          )}
          <div className="w-24 h-24 rounded-full bg-green-500/20 border-2 border-green-500/40 flex items-center justify-center mb-6 shadow-lg shadow-green-900/40">
            <Sprout className="w-12 h-12 text-green-400" />
          </div>
          <Badge className="bg-green-900/60 text-green-300 border-green-700 mb-4">NEXCOM Farmer Portal</Badge>
          <h1 className="text-3xl font-bold text-white mb-3 leading-tight">
            Sell Your Crops at<br /><span className="text-green-400">Market Price</span>
          </h1>
          <p className="text-slate-400 text-sm max-w-xs mb-8">
            Register your farm, list your crops, and connect directly with buyers on Nigeria's leading commodity exchange.
          </p>
          <div className="grid grid-cols-2 gap-3 w-full max-w-sm mb-8">
            {[
              { icon: TrendingUp, label: "Live Prices", desc: "Real-time market rates" },
              { icon: ShieldCheck, label: "Verified KYC", desc: "Secure & compliant" },
              { icon: Wheat, label: "Crop Listings", desc: "List any commodity" },
              { icon: Users, label: "Cooperative", desc: "Join farmer groups" },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="bg-slate-800/60 rounded-xl p-3 text-left border border-slate-700/50">
                <Icon className="w-5 h-5 text-green-400 mb-1" />
                <p className="text-white text-xs font-semibold">{label}</p>
                <p className="text-slate-400 text-xs">{desc}</p>
              </div>
            ))}
          </div>
          {isAuthenticated ? (
            <Button onClick={() => setStep(2)}
              className="bg-green-600 hover:bg-green-700 text-white w-full max-w-sm h-12 text-base font-semibold shadow-lg shadow-green-900/40">
              Start Registration <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          ) : (
            <Button onClick={() => window.location.href = getLoginUrl()}
              className="bg-green-600 hover:bg-green-700 text-white w-full max-w-sm h-12 text-base font-semibold">
              Sign In to Register <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          )}
          <button onClick={() => navigate("/farmer-dashboard")} className="mt-3 text-slate-400 text-sm underline underline-offset-2">
            Already registered? Go to Dashboard
          </button>
        </div>
        {/* Step indicator */}
        <div className="p-6">
          <div className="flex items-center justify-center gap-2 mb-2">
            {["Register","KYC","Bank","Submit","Farm"].map((s, i) => (
              <div key={s} className="flex items-center gap-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i === 0 ? "bg-green-500 text-white" : i === 4 ? "bg-amber-700/60 text-amber-300" : "bg-slate-700 text-slate-400"}`}>{i + 1}</div>
                {i < 4 && <div className="w-5 h-px bg-slate-700" />}
              </div>
            ))}
          </div>
          <p className="text-center text-slate-500 text-xs">Complete 4 steps · Step 5 unlocks after KYC approval</p>
        </div>
      </div>
    );
  }

  // ── Multi-step wizard (steps 2–6) ───────────────────────────────────────────
  const totalWizardSteps = 5; // steps 2–6
  const progress = ((step - 2) / (totalWizardSteps - 1)) * 100;
  const stepIcons = [null, User, Landmark, FileText, CheckCircle2, Tractor];
  const StepIcon = stepIcons[step] ?? User;
  const isStep6 = step === 6;
  const isStep6Locked = isStep6 && kycStatus !== "APPROVED";

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-950 to-slate-950">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <Leaf className="h-4 w-4 text-green-400" />
              <span className="font-semibold text-sm text-white">NEXCOM Farmer Registration</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`flex items-center gap-1 text-xs ${online ? "text-green-400" : "text-amber-400"}`}>
                {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                {online ? "Online" : "Offline — draft saved"}
              </span>
              {installPrompt && (
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1 border-slate-600 text-slate-300"
                  onClick={() => { installPrompt.prompt(); setInstallPrompt(null); }}>
                  <Download className="h-3 w-3" /> Install
                </Button>
              )}
            </div>
          </div>
          {/* Progress bar */}
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {/* Step header */}
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${isStep6Locked ? "bg-amber-900/30 border border-amber-700/40" : "bg-green-500/20 border border-green-500/40"}`}>
            {isStep6Locked
              ? <Lock className="h-5 w-5 text-amber-400" />
              : <StepIcon className="h-5 w-5 text-green-400" />
            }
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">{STEP_TITLES[step - 1]}</h1>
            <p className="text-sm text-slate-400">
              {isStep6Locked ? "Locked — awaiting KYC approval" : `Step ${step - 1} of ${totalWizardSteps}`}
            </p>
          </div>
          <div className="ml-auto flex gap-1.5">
            {[2, 3, 4, 5, 6].map(s => (
              <button key={s} type="button"
                disabled={s > step || (s === 6 && kycStatus !== "APPROVED")}
                onClick={() => { if (s < step && !(s === 6 && kycStatus !== "APPROVED")) setStep(s); }}
                className={`w-2 h-2 rounded-full transition-colors ${
                  s === 6 && kycStatus !== "APPROVED"
                    ? "bg-amber-700/50 cursor-not-allowed"
                    : s < step ? "bg-green-500 cursor-pointer"
                    : s === step ? "bg-green-400"
                    : "bg-slate-700 cursor-not-allowed"
                }`}
                aria-label={`Step ${s - 1}`}
              />
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="min-h-[320px]">
          {step === 2 && <StepPersonal data={personal} onChange={setPersonal} />}
          {step === 3 && <StepBank data={bank} onChange={setBank} />}
          {step === 4 && <StepDocuments docs={docs} onUpload={handleDocUpload} onRemove={handleDocRemove} uploading={uploadingDoc} />}
          {step === 5 && <StepReview personal={personal} bank={bank} docs={docs} />}
          {step === 6 && <StepAddFarm data={farm} onChange={setFarm} kycStatus={kycStatus} farmPin={farmPin} onPinChange={setFarmPin} farmBoundary={farmBoundary} onBoundaryChange={setFarmBoundary} onBoundaryStats={setFarmBoundaryStats} />}
        </div>

        {/* Navigation */}
        <div className="flex gap-3 pt-2">
          <Button variant="outline" onClick={handleBack}
            className="flex-1 sm:flex-none sm:w-32 border-slate-600 text-slate-300 hover:bg-slate-800">
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          {step < 5 ? (
            <Button onClick={handleNext} className="flex-1 bg-green-600 hover:bg-green-700 text-white">
              Continue <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : step === 5 ? (
            <Button onClick={handleSubmit} disabled={submitting}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold">
              {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting…</> : <><CheckCircle2 className="h-4 w-4 mr-2" /> Submit Registration</>}
            </Button>
          ) : (
            /* Step 6 — Add Farm */
            <Button onClick={handleAddFarm} disabled={submitting || isStep6Locked}
              className={`flex-1 font-semibold ${isStep6Locked ? "bg-slate-700 text-slate-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700 text-white"}`}>
              {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Adding Farm…</> : isStep6Locked ? <><Lock className="h-4 w-4 mr-2" /> Locked</> : <><Tractor className="h-4 w-4 mr-2" /> Add Farm</>}
            </Button>
          )}
        </div>

        {saveDraftMutation.isPending && (
          <p className="text-xs text-slate-500 text-center flex items-center justify-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving draft…
          </p>
        )}
      </div>
    </div>
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}
