/**
 * NEXCOM Exchange — KYB (Know Your Business) Onboarding Wizard (FIX-KYB)
 * ─────────────────────────────────────────────────────────────────────────────
 * Multi-step corporate verification wizard:
 *   1. Business info → 2. CAC/TIN registration → 3. Directors →
 *   4. Beneficial owners (CBN ≥25% UBO auto-flagging) → 5. Documents →
 *   6. Review & submit for screening
 *
 * If the user already has a KYB application, shows the live status tracker
 * (trpc.kyb.getKybStatus) instead of the wizard.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Building2,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  Upload,
  Users,
  Landmark,
} from "lucide-react";
import { toast } from "sonner";

type BusinessType = "SOLE_PROP" | "LLC" | "PLC" | "COOPERATIVE" | "PARTNERSHIP" | "NGO";
type DocSlot = "cacCertificate" | "memart" | "statusReport" | "boardResolution" | "proofOfAddress";

const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: "SOLE_PROP", label: "Sole Proprietorship (BN)" },
  { value: "LLC", label: "Limited Liability Company (Ltd)" },
  { value: "PLC", label: "Public Limited Company (PLC)" },
  { value: "COOPERATIVE", label: "Cooperative Society" },
  { value: "PARTNERSHIP", label: "Partnership" },
  { value: "NGO", label: "NGO / Incorporated Trustees" },
];

const DOC_SLOTS: { slot: DocSlot; label: string; required: boolean }[] = [
  { slot: "cacCertificate", label: "CAC Certificate of Incorporation / Registration", required: true },
  { slot: "memart", label: "Memorandum & Articles of Association (MEMART)", required: true },
  { slot: "statusReport", label: "CAC Status Report (≤ 3 months old)", required: true },
  { slot: "boardResolution", label: "Board Resolution authorising exchange trading", required: false },
  { slot: "proofOfAddress", label: "Proof of Operating Address (utility bill / lease)", required: true },
];

const UBO_THRESHOLD = 25;

interface DirectorForm {
  fullName: string;
  role: string;
  appointmentDate: string;
  bvn: string;
  nin: string;
}

interface OwnerForm {
  fullName: string;
  dateOfBirth: string;
  nationality: string;
  bvn: string;
  nin: string;
  ownershipPercent: string;
  isPep: boolean;
  pepDetails: string;
}

const emptyDirector: DirectorForm = { fullName: "", role: "Director", appointmentDate: "", bvn: "", nin: "" };
const emptyOwner: OwnerForm = {
  fullName: "", dateOfBirth: "", nationality: "Nigerian", bvn: "", nin: "",
  ownershipPercent: "", isPep: false, pepDetails: "",
};

const STATUS_STEPS = ["SUBMITTED", "SCREENING", "UNDER_REVIEW", "APPROVED"] as const;

export default function KybOnboarding() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);

  const statusQuery = trpc.kyb.getKybStatus.useQuery(undefined, { retry: false });
  const existingApp = statusQuery.data?.application ?? null;

  const [business, setBusiness] = useState({
    businessName: "",
    businessType: "LLC" as BusinessType,
    registeredAddress: "",
    operatingStates: "",
    websiteUrl: "",
    contactEmail: "",
    contactPhone: "",
    expectedMonthlyVolume: "",
  });
  const [reg, setReg] = useState({ cacRcNumber: "", tinNumber: "", incorporationDate: "" });
  const [directors, setDirectors] = useState<DirectorForm[]>([{ ...emptyDirector }]);
  const [owners, setOwners] = useState<OwnerForm[]>([{ ...emptyOwner }]);
  const [applicationId, setApplicationId] = useState<number | null>(null);
  const [uploadedDocs, setUploadedDocs] = useState<Partial<Record<DocSlot, string>>>({});
  const [uploading, setUploading] = useState<Partial<Record<DocSlot, boolean>>>({});
  const fileInputs = useRef<Partial<Record<DocSlot, HTMLInputElement | null>>>({});

  const submitMutation = trpc.kyb.submitKybApplication.useMutation();
  const uploadMutation = trpc.kyb.uploadKybDocument.useMutation();
  const screeningMutation = trpc.kyb.requestScreening.useMutation();

  // Pre-fill from an existing DRAFT/SUBMITTED application so users can resume
  useEffect(() => {
    if (existingApp && ["DRAFT", "SUBMITTED"].includes(existingApp.status)) {
      setApplicationId(existingApp.id);
    }
  }, [existingApp]);

  const totalOwnership = useMemo(
    () => owners.reduce((s, o) => s + (parseFloat(o.ownershipPercent) || 0), 0),
    [owners],
  );
  const hasDeclaredUbo = owners.some((o) => (parseFloat(o.ownershipPercent) || 0) >= UBO_THRESHOLD);

  const rcKind = useMemo(() => {
    const v = reg.cacRcNumber.trim().toUpperCase();
    if (/^RC[-\s]?\d{6,7}$/.test(v)) return "RC";
    if (/^BN[-\s]?\d{7}$/.test(v)) return "BN";
    return null;
  }, [reg.cacRcNumber]);

  function validateStep(): boolean {
    if (step === 1) {
      if (business.businessName.trim().length < 2) { toast.error("Business name is required"); return false; }
      if (business.registeredAddress.trim().length < 5) { toast.error("Registered address is required"); return false; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(business.contactEmail)) { toast.error("Valid contact email is required"); return false; }
      if (business.contactPhone.trim().length < 7) { toast.error("Valid contact phone is required"); return false; }
      return true;
    }
    if (step === 2) {
      if (!rcKind) {
        toast.error("Enter a valid CAC number: RC + 6–7 digits (companies) or BN + 7 digits (business names)");
        return false;
      }
      if (rcKind === "BN" && !["SOLE_PROP", "PARTNERSHIP"].includes(business.businessType)) {
        toast.error("BN numbers are issued to business names (sole proprietorship / partnership). Companies have RC numbers.");
        return false;
      }
      if (rcKind === "RC" && ["SOLE_PROP", "PARTNERSHIP"].includes(business.businessType)) {
        toast.error("Incorporated entities (RC) should select LLC / PLC / Cooperative / NGO as the business type.");
        return false;
      }
      if (reg.tinNumber && !/^\d{8,13}$/.test(reg.tinNumber.replace(/[-\s]/g, ""))) {
        toast.error("TIN must be 8–13 digits (FIRS format)");
        return false;
      }
      return true;
    }
    if (step === 3) {
      if (directors.some((d) => d.fullName.trim().length < 2)) { toast.error("Every director needs a full name"); return false; }
      return true;
    }
    if (step === 4) {
      if (owners.some((o) => o.fullName.trim().length < 2)) { toast.error("Every beneficial owner needs a full name"); return false; }
      if (owners.some((o) => !(parseFloat(o.ownershipPercent) > 0))) { toast.error("Every beneficial owner needs an ownership percentage"); return false; }
      if (totalOwnership > 100) { toast.error(`Total ownership is ${totalOwnership.toFixed(1)}% — cannot exceed 100%`); return false; }
      if (!hasDeclaredUbo) {
        toast.warning(`No declared owner holds ≥${UBO_THRESHOLD}% — CBN rules require all ≥${UBO_THRESHOLD}% owners to be declared. Your application will be flagged for review.`);
      }
      return true;
    }
    return true;
  }

  async function ensureApplication(): Promise<number | null> {
    if (applicationId) return applicationId;
    try {
      const result = await submitMutation.mutateAsync({
        businessName: business.businessName.trim(),
        businessType: business.businessType,
        cacRcNumber: reg.cacRcNumber.trim(),
        tinNumber: reg.tinNumber.trim() || undefined,
        incorporationDate: reg.incorporationDate || undefined,
        registeredAddress: business.registeredAddress.trim(),
        operatingStates: business.operatingStates
          ? business.operatingStates.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
        websiteUrl: business.websiteUrl.trim() || undefined,
        contactEmail: business.contactEmail.trim(),
        contactPhone: business.contactPhone.trim(),
        expectedMonthlyVolume: business.expectedMonthlyVolume ? parseFloat(business.expectedMonthlyVolume) : undefined,
        directors: directors.map((d) => ({
          fullName: d.fullName.trim(),
          role: d.role.trim() || "Director",
          appointmentDate: d.appointmentDate || undefined,
          bvn: d.bvn.trim() || undefined,
          nin: d.nin.trim() || undefined,
        })),
        beneficialOwners: owners.map((o) => ({
          fullName: o.fullName.trim(),
          dateOfBirth: o.dateOfBirth || undefined,
          nationality: o.nationality.trim() || "Nigerian",
          bvn: o.bvn.trim() || undefined,
          nin: o.nin.trim() || undefined,
          ownershipPercent: parseFloat(o.ownershipPercent),
          isPep: o.isPep,
          pepDetails: o.isPep ? o.pepDetails.trim() || undefined : undefined,
        })),
      });
      setApplicationId(result.applicationId);
      if (result.uboWarnings?.length) {
        result.uboWarnings.forEach((w) => toast.warning(w));
      }
      return result.applicationId;
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to submit KYB application");
      return null;
    }
  }

  async function goToDocuments() {
    if (!validateStep()) return;
    const id = await ensureApplication();
    if (id) setStep(5);
  }

  function handleFile(slot: DocSlot, file: File) {
    if (file.size > 10 * 1024 * 1024) { toast.error("File must be under 10 MB"); return; }
    setUploading((p) => ({ ...p, [slot]: true }));
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const base64 = (e.target?.result as string).split(",")[1];
        const res = await uploadMutation.mutateAsync({
          docSlot: slot,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          base64Data: base64,
        });
        setUploadedDocs((p) => ({ ...p, [slot]: res.url }));
        toast.success(`${DOC_SLOTS.find((d) => d.slot === slot)?.label} uploaded`);
      } catch (err: any) {
        toast.error(err?.message ?? "Upload failed");
      } finally {
        setUploading((p) => ({ ...p, [slot]: false }));
      }
    };
    reader.onerror = () => {
      setUploading((p) => ({ ...p, [slot]: false }));
      toast.error("Failed to read file");
    };
    reader.readAsDataURL(file);
  }

  async function submitForScreening() {
    const missing = DOC_SLOTS.filter((d) => d.required && !uploadedDocs[d.slot]);
    if (missing.length > 0) {
      toast.error(`Required documents missing: ${missing.map((d) => d.label).join(", ")}`);
      return;
    }
    try {
      const res = await screeningMutation.mutateAsync();
      if (res.screeningCompleted) {
        toast.success(`Screening complete — risk level ${res.riskLevel}. Your application is now under review.`);
      } else {
        toast.info("Screening service is currently unavailable — your application is queued for screening. No action needed.");
      }
      statusQuery.refetch();
      setStep(7);
    } catch (e: any) {
      toast.error(e?.message ?? "Screening request failed");
    }
  }

  // ── Status tracker for existing applications ────────────────────────────────
  if (statusQuery.isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  if (existingApp && !["DRAFT", "SUBMITTED"].includes(existingApp.status)) {
    const status = statusQuery.data!.status as string;
    const currentStepIdx = status === "APPROVED" ? 4 : STATUS_STEPS.indexOf(status as any);
    return (
      <div className="min-h-screen bg-slate-950 text-white px-6 py-12">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <ShieldCheck className="w-8 h-8 text-emerald-400" />
            <div>
              <h1 className="text-2xl font-bold">Business Verification Status</h1>
              <p className="text-slate-400 text-sm">{existingApp.businessName} · {existingApp.cacRcNumber}</p>
            </div>
          </div>

          <Card className="bg-slate-900 border-slate-800 mb-6">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-slate-400 text-sm">Application #{existingApp.id}</span>
                <Badge className={
                  status === "APPROVED" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                  status === "REJECTED" || status === "SUSPENDED" ? "bg-red-500/15 text-red-400 border-red-500/30" :
                  status === "EDD_REQUIRED" ? "bg-orange-500/15 text-orange-400 border-orange-500/30" :
                  "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
                }>
                  {status.replace(/_/g, " ")}
                </Badge>
              </div>
              {status !== "REJECTED" && status !== "SUSPENDED" && (
                <div className="flex items-center gap-2 mb-4">
                  {STATUS_STEPS.map((s, i) => (
                    <div key={s} className="flex items-center gap-2 flex-1">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        i <= currentStepIdx ? "bg-emerald-500 text-white" : "bg-slate-800 text-slate-500"
                      }`}>
                        {i < currentStepIdx ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                      </div>
                      <span className={`text-xs ${i <= currentStepIdx ? "text-emerald-300" : "text-slate-500"}`}>
                        {s.replace(/_/g, " ")}
                      </span>
                      {i < STATUS_STEPS.length - 1 && <div className="flex-1 h-px bg-slate-800" />}
                    </div>
                  ))}
                </div>
              )}
              {statusQuery.data!.screeningPending && (
                <div className="flex items-start gap-2 text-sm text-yellow-300 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-3">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  Screening is pending — the screening service will process your application automatically. No action needed.
                </div>
              )}
              {status === "REJECTED" && statusQuery.data!.rejectionReason && (
                <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-3">
                  <strong>Reason:</strong> {statusQuery.data!.rejectionReason}
                </div>
              )}
              {status === "EDD_REQUIRED" && statusQuery.data!.eddChecklist && (
                <div className="text-sm text-orange-200 bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 mb-3">
                  <strong className="block mb-2">Enhanced due diligence checklist:</strong>
                  <ul className="list-disc list-inside space-y-1">
                    {statusQuery.data!.eddChecklist.map((c, i) => (
                      <li key={i} className={c.done ? "line-through opacity-60" : ""}>{c.item}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="grid grid-cols-3 gap-3 text-center text-sm">
                <div className="bg-slate-800/60 rounded-lg p-3">
                  <div className="text-lg font-semibold">{statusQuery.data!.directorCount}</div>
                  <div className="text-slate-400 text-xs">Directors</div>
                </div>
                <div className="bg-slate-800/60 rounded-lg p-3">
                  <div className="text-lg font-semibold">{statusQuery.data!.beneficialOwnerCount}</div>
                  <div className="text-slate-400 text-xs">Owners ({statusQuery.data!.totalOwnershipPercent}%)</div>
                </div>
                <div className="bg-slate-800/60 rounded-lg p-3">
                  <div className="text-lg font-semibold">{statusQuery.data!.uploadedDocuments?.length ?? 0}</div>
                  <div className="text-slate-400 text-xs">Documents</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <h2 className="text-sm font-semibold text-slate-300 mb-2">Timeline</h2>
          <div className="space-y-2 mb-8">
            {(statusQuery.data!.timeline ?? []).map((t) => (
              <div key={t.id} className="flex items-start gap-3 text-sm bg-slate-900 border border-slate-800 rounded-lg p-3">
                <div className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0" />
                <div className="flex-1">
                  <div className="font-medium">{t.action.replace(/_/g, " ")}</div>
                  {t.notes && <div className="text-slate-400 text-xs mt-0.5">{t.notes}</div>}
                </div>
                <div className="text-slate-500 text-xs">{new Date(t.createdAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
          <Button variant="outline" onClick={() => navigate("/dashboard")} className="border-slate-700 text-slate-300">
            Back to dashboard
          </Button>
        </div>
      </div>
    );
  }

  // ── Wizard ──────────────────────────────────────────────────────────────────
  const stepTitles = ["Business Info", "CAC / TIN", "Directors", "Beneficial Owners", "Documents", "Review & Submit"];

  return (
    <div className="min-h-screen bg-slate-950 text-white px-6 py-10">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <Building2 className="w-8 h-8 text-emerald-400" />
          <h1 className="text-2xl font-bold">Business Verification (KYB)</h1>
        </div>
        <p className="text-slate-400 text-sm mb-6">
          Corporate verification unlocks Tier 3 trading (no daily limit). CAC registration is verified
          and all owners ≥{UBO_THRESHOLD}% are screened under CBN AML/CFT rules.
        </p>

        {step <= 6 && (
          <div className="flex items-center gap-1.5 mb-8">
            {stepTitles.map((t, i) => (
              <div key={t} className="flex items-center gap-1.5 flex-1">
                <div className={`h-1.5 rounded-full flex-1 ${i + 1 <= step ? "bg-emerald-500" : "bg-slate-800"}`} />
              </div>
            ))}
          </div>
        )}
        {step <= 6 && <p className="text-xs text-slate-500 mb-4">Step {step} of 6 — {stepTitles[step - 1]}</p>}

        {/* Step 1: Business info */}
        {step === 1 && (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-6 space-y-4">
              <div>
                <Label>Business name (exactly as on CAC certificate)</Label>
                <Input className="bg-slate-800 border-slate-700 mt-1" value={business.businessName}
                  onChange={(e) => setBusiness({ ...business, businessName: e.target.value })} placeholder="e.g. Greenfield Commodities Ltd" />
              </div>
              <div>
                <Label>Business type</Label>
                <Select value={business.businessType} onValueChange={(v) => setBusiness({ ...business, businessType: v as BusinessType })}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BUSINESS_TYPES.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Registered address</Label>
                <Textarea className="bg-slate-800 border-slate-700 mt-1" value={business.registeredAddress}
                  onChange={(e) => setBusiness({ ...business, registeredAddress: e.target.value })} placeholder="Registered office address" />
              </div>
              <div>
                <Label>Operating states (comma separated)</Label>
                <Input className="bg-slate-800 border-slate-700 mt-1" value={business.operatingStates}
                  onChange={(e) => setBusiness({ ...business, operatingStates: e.target.value })} placeholder="Lagos, Kano, Kaduna" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Contact email</Label>
                  <Input type="email" className="bg-slate-800 border-slate-700 mt-1" value={business.contactEmail}
                    onChange={(e) => setBusiness({ ...business, contactEmail: e.target.value })} />
                </div>
                <div>
                  <Label>Contact phone</Label>
                  <Input className="bg-slate-800 border-slate-700 mt-1" value={business.contactPhone}
                    onChange={(e) => setBusiness({ ...business, contactPhone: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Website (optional)</Label>
                  <Input className="bg-slate-800 border-slate-700 mt-1" value={business.websiteUrl}
                    onChange={(e) => setBusiness({ ...business, websiteUrl: e.target.value })} placeholder="https://" />
                </div>
                <div>
                  <Label>Expected monthly volume (₦, optional)</Label>
                  <Input type="number" className="bg-slate-800 border-slate-700 mt-1" value={business.expectedMonthlyVolume}
                    onChange={(e) => setBusiness({ ...business, expectedMonthlyVolume: e.target.value })} />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: CAC / TIN */}
        {step === 2 && (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-start gap-2 text-sm text-slate-300 bg-slate-800/60 rounded-lg p-3">
                <Landmark className="w-4 h-4 mt-0.5 text-emerald-400 flex-shrink-0" />
                Your CAC number is verified against format rules immediately and queued for registry
                verification by our compliance team. Enter it exactly as printed on your certificate.
              </div>
              <div>
                <Label>CAC Registration Number (RC / BN)</Label>
                <Input className="bg-slate-800 border-slate-700 mt-1" value={reg.cacRcNumber}
                  onChange={(e) => setReg({ ...reg, cacRcNumber: e.target.value })} placeholder="RC1234567 or BN1234567" />
                {reg.cacRcNumber && (
                  <p className={`text-xs mt-1 ${rcKind ? "text-emerald-400" : "text-red-400"}`}>
                    {rcKind ? `Valid ${rcKind} format${rcKind === "BN" ? " (business name registration)" : " (incorporated entity)"}` : "Expected RC + 6–7 digits or BN + 7 digits"}
                  </p>
                )}
              </div>
              <div>
                <Label>TIN (FIRS Tax Identification Number, optional)</Label>
                <Input className="bg-slate-800 border-slate-700 mt-1" value={reg.tinNumber}
                  onChange={(e) => setReg({ ...reg, tinNumber: e.target.value })} placeholder="8–13 digits" />
              </div>
              <div>
                <Label>Incorporation date</Label>
                <Input type="date" className="bg-slate-800 border-slate-700 mt-1" value={reg.incorporationDate}
                  onChange={(e) => setReg({ ...reg, incorporationDate: e.target.value })} />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Directors */}
        {step === 3 && (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-6 space-y-5">
              {directors.map((d, i) => (
                <div key={i} className="border border-slate-800 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-300">Director {i + 1}</span>
                    {directors.length > 1 && (
                      <button onClick={() => setDirectors(directors.filter((_, j) => j !== i))}
                        className="text-red-400 hover:text-red-300"><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Full name</Label>
                      <Input className="bg-slate-800 border-slate-700 mt-1" value={d.fullName}
                        onChange={(e) => setDirectors(directors.map((x, j) => j === i ? { ...x, fullName: e.target.value } : x))} />
                    </div>
                    <div>
                      <Label>Role</Label>
                      <Input className="bg-slate-800 border-slate-700 mt-1" value={d.role}
                        onChange={(e) => setDirectors(directors.map((x, j) => j === i ? { ...x, role: e.target.value } : x))} />
                    </div>
                    <div>
                      <Label>Appointment date (optional)</Label>
                      <Input type="date" className="bg-slate-800 border-slate-700 mt-1" value={d.appointmentDate}
                        onChange={(e) => setDirectors(directors.map((x, j) => j === i ? { ...x, appointmentDate: e.target.value } : x))} />
                    </div>
                    <div>
                      <Label>BVN (optional — stored hashed)</Label>
                      <Input className="bg-slate-800 border-slate-700 mt-1" value={d.bvn} maxLength={11}
                        onChange={(e) => setDirectors(directors.map((x, j) => j === i ? { ...x, bvn: e.target.value.replace(/\D/g, "") } : x))} />
                    </div>
                  </div>
                </div>
              ))}
              <Button variant="outline" className="border-slate-700 text-slate-300"
                onClick={() => setDirectors([...directors, { ...emptyDirector }])}>
                <Plus className="w-4 h-4 mr-1" /> Add director
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Beneficial owners */}
        {step === 4 && (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-6 space-y-5">
              <div className="flex items-start gap-2 text-sm text-slate-300 bg-slate-800/60 rounded-lg p-3">
                <Users className="w-4 h-4 mt-0.5 text-emerald-400 flex-shrink-0" />
                Under CBN AML/CFT rules, every person owning ≥{UBO_THRESHOLD}% must be declared as an
                Ultimate Beneficial Owner (UBO) and is individually screened for sanctions and PEP status.
              </div>
              <div className={`text-sm rounded-lg p-3 border ${
                totalOwnership > 100
                  ? "text-red-300 bg-red-500/10 border-red-500/30"
                  : totalOwnership === 100
                    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
                    : "text-yellow-300 bg-yellow-500/10 border-yellow-500/30"
              }`}>
                Declared ownership: <strong>{totalOwnership.toFixed(1)}%</strong> of 100%
                {!hasDeclaredUbo && totalOwnership > 0 && (
                  <span className="block text-xs mt-1">
                    ⚠ No owner reaches the {UBO_THRESHOLD}% UBO threshold — this will be flagged for reviewer verification.
                  </span>
                )}
              </div>
              {owners.map((o, i) => {
                const pct = parseFloat(o.ownershipPercent) || 0;
                const isUbo = pct >= UBO_THRESHOLD;
                return (
                  <div key={i} className={`border rounded-lg p-4 space-y-3 ${isUbo ? "border-emerald-500/40" : "border-slate-800"}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-300">
                        Owner {i + 1}
                        {isUbo && <Badge className="ml-2 bg-emerald-500/15 text-emerald-400 border-emerald-500/30">UBO ≥{UBO_THRESHOLD}%</Badge>}
                      </span>
                      {owners.length > 1 && (
                        <button onClick={() => setOwners(owners.filter((_, j) => j !== i))}
                          className="text-red-400 hover:text-red-300"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Full name</Label>
                        <Input className="bg-slate-800 border-slate-700 mt-1" value={o.fullName}
                          onChange={(e) => setOwners(owners.map((x, j) => j === i ? { ...x, fullName: e.target.value } : x))} />
                      </div>
                      <div>
                        <Label>Ownership %</Label>
                        <Input type="number" min={0} max={100} step="0.01" className="bg-slate-800 border-slate-700 mt-1" value={o.ownershipPercent}
                          onChange={(e) => setOwners(owners.map((x, j) => j === i ? { ...x, ownershipPercent: e.target.value } : x))} />
                      </div>
                      <div>
                        <Label>Date of birth (optional)</Label>
                        <Input type="date" className="bg-slate-800 border-slate-700 mt-1" value={o.dateOfBirth}
                          onChange={(e) => setOwners(owners.map((x, j) => j === i ? { ...x, dateOfBirth: e.target.value } : x))} />
                      </div>
                      <div>
                        <Label>Nationality</Label>
                        <Input className="bg-slate-800 border-slate-700 mt-1" value={o.nationality}
                          onChange={(e) => setOwners(owners.map((x, j) => j === i ? { ...x, nationality: e.target.value } : x))} />
                      </div>
                      <div>
                        <Label>BVN (optional — stored hashed)</Label>
                        <Input className="bg-slate-800 border-slate-700 mt-1" value={o.bvn} maxLength={11}
                          onChange={(e) => setOwners(owners.map((x, j) => j === i ? { ...x, bvn: e.target.value.replace(/\D/g, "") } : x))} />
                      </div>
                      <div>
                        <Label>NIN (optional — stored hashed)</Label>
                        <Input className="bg-slate-800 border-slate-700 mt-1" value={o.nin} maxLength={11}
                          onChange={(e) => setOwners(owners.map((x, j) => j === i ? { ...x, nin: e.target.value.replace(/\D/g, "") } : x))} />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-slate-300">
                      <input type="checkbox" checked={o.isPep}
                        onChange={(e) => setOwners(owners.map((x, j) => j === i ? { ...x, isPep: e.target.checked } : x))}
                        className="rounded border-slate-600" />
                      This person is a Politically Exposed Person (PEP)
                    </label>
                    {o.isPep && (
                      <Textarea className="bg-slate-800 border-slate-700" placeholder="PEP details (office held, period, relationship)"
                        value={o.pepDetails}
                        onChange={(e) => setOwners(owners.map((x, j) => j === i ? { ...x, pepDetails: e.target.value } : x))} />
                    )}
                  </div>
                );
              })}
              <Button variant="outline" className="border-slate-700 text-slate-300"
                onClick={() => setOwners([...owners, { ...emptyOwner }])}>
                <Plus className="w-4 h-4 mr-1" /> Add beneficial owner
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 5: Documents */}
        {step === 5 && (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-6 space-y-4">
              {DOC_SLOTS.map((d) => (
                <div key={d.slot} className="flex items-center justify-between border border-slate-800 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <FileText className="w-5 h-5 text-slate-400 mt-0.5" />
                    <div>
                      <div className="text-sm font-medium">{d.label}{d.required && <span className="text-red-400"> *</span>}</div>
                      {uploadedDocs[d.slot] && (
                        <div className="text-xs text-emerald-400 flex items-center gap-1 mt-1">
                          <CheckCircle2 className="w-3 h-3" /> Uploaded
                        </div>
                      )}
                    </div>
                  </div>
                  <input
                    type="file"
                    className="hidden"
                    ref={(el) => { fileInputs.current[d.slot] = el; }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(d.slot, f); e.target.value = ""; }}
                    accept=".pdf,.jpg,.jpeg,.png"
                  />
                  <Button variant="outline" size="sm" className="border-slate-700 text-slate-300"
                    disabled={!!uploading[d.slot]}
                    onClick={() => fileInputs.current[d.slot]?.click()}>
                    {uploading[d.slot] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
                    {uploadedDocs[d.slot] ? "Replace" : "Upload"}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Step 6: Review */}
        {step === 6 && (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-semibold">Review your application</h3>
              <div className="text-sm space-y-2 text-slate-300">
                <div className="flex justify-between"><span className="text-slate-500">Business</span><span>{business.businessName} ({business.businessType})</span></div>
                <div className="flex justify-between"><span className="text-slate-500">CAC number</span><span>{reg.cacRcNumber.toUpperCase()}</span></div>
                {reg.tinNumber && <div className="flex justify-between"><span className="text-slate-500">TIN</span><span>{reg.tinNumber}</span></div>}
                <div className="flex justify-between"><span className="text-slate-500">Directors</span><span>{directors.length}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Beneficial owners</span><span>{owners.length} ({totalOwnership.toFixed(1)}% declared)</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Documents</span><span>{Object.keys(uploadedDocs).length} uploaded</span></div>
              </div>
              <div className="text-xs text-slate-500 bg-slate-800/60 rounded-lg p-3">
                By submitting you confirm the information is accurate and that all ≥{UBO_THRESHOLD}% beneficial
                owners have been declared. The entity, directors and UBOs will be screened against
                international sanctions, PEP and adverse-media sources (OpenSanctions). False declarations
                may lead to rejection or suspension.
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 7: Done */}
        {step === 7 && (
          <div className="flex flex-col items-center text-center py-16">
            <CheckCircle2 className="w-16 h-16 text-emerald-400 mb-4" />
            <h2 className="text-xl font-bold mb-2">Application submitted for review</h2>
            <p className="text-slate-400 text-sm mb-6 max-w-sm">
              Your business verification is being processed. You'll receive a notification when a
              compliance officer completes the review.
            </p>
            <Button onClick={() => navigate("/kyb-onboarding")} variant="outline" className="border-slate-700 text-slate-300">
              Track application status
            </Button>
          </div>
        )}

        {/* Nav buttons */}
        {step <= 6 && (
          <div className="flex justify-between mt-6">
            <Button variant="outline" className="border-slate-700 text-slate-300"
              disabled={step === 1}
              onClick={() => setStep(step - 1)}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            {step < 4 && (
              <Button className="bg-emerald-600 hover:bg-emerald-500"
                onClick={() => { if (validateStep()) setStep(step + 1); }}>
                Continue <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
            {step === 4 && (
              <Button className="bg-emerald-600 hover:bg-emerald-500"
                disabled={submitMutation.isPending}
                onClick={goToDocuments}>
                {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                Save & continue <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
            {step === 5 && (
              <Button className="bg-emerald-600 hover:bg-emerald-500" onClick={() => setStep(6)}>
                Review application <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
            {step === 6 && (
              <Button className="bg-emerald-600 hover:bg-emerald-500"
                disabled={screeningMutation.isPending}
                onClick={submitForScreening}>
                {screeningMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ShieldCheck className="w-4 h-4 mr-1" />}
                Submit for screening
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
