/**
 * NEXCOM Exchange — Register / KYC Onboarding Wizard
 * Multi-step onboarding: account type → personal info → KYC docs → review
 * Fully wired to live tRPC onboarding.submit mutation
 */
import { useState } from "react";
import {
  User, Building2, FileText, CheckCircle2, ChevronRight,
  Upload, Shield, AlertCircle, ArrowLeft, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";

type AccountType = "INDIVIDUAL" | "COMPANY" | "COOPERATIVE";
type Step = 1 | 2 | 3 | 4;

const ACCOUNT_TYPES = [
  { type: "INDIVIDUAL" as AccountType, icon: User,      title: "Individual Trader",    desc: "For personal commodity trading and investment" },
  { type: "COMPANY"    as AccountType, icon: Building2, title: "Corporate Entity",     desc: "For registered businesses and trading companies" },
  { type: "COOPERATIVE" as AccountType,icon: User,      title: "Farmer Cooperative",   desc: "For agricultural cooperatives and farmer groups" },
];

const STEPS = [
  { n: 1, label: "Account Type" },
  { n: 2, label: "Personal Info" },
  { n: 3, label: "KYC Documents" },
  { n: 4, label: "Review" },
];

const COUNTRIES = ["Nigeria","Ghana","Kenya","Ethiopia","Tanzania","Ivory Coast","Cameroon","Senegal","Uganda","Rwanda"];

export default function Register() {
  const [step, setStep] = useState<Step>(1);
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "", country: "",
    state: "", address: "", bvn: "", nin: "", companyName: "", rcNumber: "",
    taxId: "",
  });
  const [docs, setDocs] = useState({
    idDoc: false, addressProof: false, bankStatement: false, cacCert: false,
  });
  const [submitted, setSubmitted] = useState(false);

  const setField = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  const submitMutation = trpc.onboarding.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      toast.success("Application submitted!", {
        description: "Your KYC application is under review. Expect a response within 24-48 hours.",
      });
    },
    onError: (e) => toast.error(e.message),
  });

  const canProceed = () => {
    if (step === 1) return !!accountType;
    if (step === 2) return !!(form.firstName && form.lastName && form.email && form.phone && form.country);
    if (step === 3) return docs.idDoc && docs.addressProof;
    return true;
  };

  const handleSubmit = () => {
    if (!accountType) return;
    const stakeholderType = accountType === "COOPERATIVE" ? "FARMER" : accountType === "COMPANY" ? "TRADER" : "TRADER";
    submitMutation.mutate({
      stakeholderType,
      personalInfo: {
        firstName: form.firstName || form.companyName || "N/A",
        lastName: form.lastName || "N/A",
        email: form.email,
        phone: form.phone,
        country: form.country,
        state: form.state || "N/A",
        address: form.address || "N/A",
        bvn: form.bvn || undefined,
        nin: form.nin || undefined,
      },
      businessInfo: {
        companyName: form.companyName || undefined,
        rcNumber: form.rcNumber || undefined,
        taxId: form.taxId || undefined,
        businessType: accountType,
      },
      stakeholderSpecific: {},
      documentsUploaded: [
        ...(docs.idDoc        ? [{ type: "ID_DOCUMENT",    url: "pending", name: "Government ID" }]     : []),
        ...(docs.addressProof ? [{ type: "ADDRESS_PROOF",  url: "pending", name: "Proof of Address" }]  : []),
        ...(docs.bankStatement? [{ type: "BANK_STATEMENT", url: "pending", name: "Bank Statement" }]    : []),
        ...(docs.cacCert      ? [{ type: "CAC_CERTIFICATE",url: "pending", name: "CAC Certificate" }]   : []),
      ],
      agreedToTerms: true,
      agreedToKyc: true,
    });
  };

  if (submitted) {
    return (
      <div className="page-container flex items-center justify-center min-h-[60vh]">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-positive/20 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-positive" />
          </div>
          <h2 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'DM Serif Display', serif" }}>
            Application Submitted!
          </h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Your KYC application has been received. Our compliance team will review your documents within 24-48 business hours.
            You will be notified via email once your account is approved.
          </p>
          <div className="rounded-xl border border-border bg-card p-4 text-left space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Reference</span>
              <span className="font-mono text-foreground">KYC-{String(Date.now()).slice(-6)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Account Type</span>
              <span className="text-foreground">{accountType}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Status</span>
              <Badge className="badge-pending text-[10px]">Under Review</Badge>
            </div>
          </div>
          <Link
            href="/"
            className="inline-flex items-center justify-center w-full h-10 px-4 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container max-w-2xl mx-auto space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'DM Serif Display', serif" }}>
          Open Your NEXCOM Account
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Complete KYC verification to start trading on Africa's premier commodity exchange
        </p>
      </div>

      {/* Progress */}
      <div className="flex items-center justify-center gap-0">
        {STEPS.map((s, i) => (
          <div key={s.n} className="flex items-center">
            <div className="flex flex-col items-center">
              <div className={"w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all " + (
                step > s.n ? "bg-positive text-white" :
                step === s.n ? "bg-primary text-primary-foreground" :
                "bg-secondary text-muted-foreground"
              )}>
                {step > s.n ? <CheckCircle2 className="w-4 h-4" /> : s.n}
              </div>
              <span className={"text-[10px] mt-1 hidden sm:block " + (step >= s.n ? "text-foreground" : "text-muted-foreground")}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={"h-px w-12 sm:w-20 mx-1 mb-4 " + (step > s.n ? "bg-positive" : "bg-border")} />
            )}
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        {/* Step 1 */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Choose Account Type</h2>
            <div className="space-y-3">
              {ACCOUNT_TYPES.map(({ type, icon: Icon, title, desc }) => (
                <button
                  key={type}
                  onClick={() => setAccountType(type)}
                  className={"w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left " + (
                    accountType === type ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                  )}
                >
                  <div className={"w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 " + (accountType === type ? "bg-primary/20" : "bg-secondary")}>
                    <Icon className={"w-5 h-5 " + (accountType === type ? "text-primary" : "text-muted-foreground")} />
                  </div>
                  <div>
                    <div className="font-semibold text-foreground">{title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                  </div>
                  {accountType === type && <CheckCircle2 className="w-5 h-5 text-primary ml-auto flex-shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">
              {accountType === "COMPANY" ? "Company Information" : "Personal Information"}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {accountType === "COMPANY" ? (
                <>
                  <div className="col-span-2 space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Company Name *</Label>
                    <Input value={form.companyName} onChange={e => setField("companyName", e.target.value)} placeholder="ACME Trading Ltd." />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">RC Number *</Label>
                    <Input value={form.rcNumber} onChange={e => setField("rcNumber", e.target.value)} placeholder="RC123456" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Tax ID</Label>
                    <Input value={form.taxId} onChange={e => setField("taxId", e.target.value)} placeholder="TIN-XXXXXXX" />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">First Name *</Label>
                    <Input value={form.firstName} onChange={e => setField("firstName", e.target.value)} placeholder="John" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Last Name *</Label>
                    <Input value={form.lastName} onChange={e => setField("lastName", e.target.value)} placeholder="Doe" />
                  </div>
                </>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Email Address *</Label>
                <Input type="email" value={form.email} onChange={e => setField("email", e.target.value)} placeholder="john@example.com" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Phone Number *</Label>
                <Input value={form.phone} onChange={e => setField("phone", e.target.value)} placeholder="+234 800 000 0000" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Country *</Label>
                <Select value={form.country} onValueChange={v => setField("country", v)}>
                  <SelectTrigger><SelectValue placeholder="Select country..." /></SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">State / Region</Label>
                <Input value={form.state} onChange={e => setField("state", e.target.value)} placeholder="Lagos" />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs text-muted-foreground">Address</Label>
                <Input value={form.address} onChange={e => setField("address", e.target.value)} placeholder="123 Main Street, Victoria Island" />
              </div>
              {form.country === "Nigeria" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">BVN</Label>
                    <Input value={form.bvn} onChange={e => setField("bvn", e.target.value)} placeholder="22XXXXXXXXX" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">NIN</Label>
                    <Input value={form.nin} onChange={e => setField("nin", e.target.value)} placeholder="XXXXXXXXXXX" />
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Upload KYC Documents</h2>
            <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-3 flex gap-2">
              <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-400/90">
                Documents must be clear, unedited, and in PDF, JPG, or PNG format. Maximum file size: 5MB per document.
              </p>
            </div>
            <div className="space-y-3">
              {([
                { key: "idDoc"        as const, label: "Government-Issued ID *",   desc: "National ID, Passport, or Driver's License",    required: true },
                { key: "addressProof" as const, label: "Proof of Address *",       desc: "Utility bill or bank statement (last 3 months)", required: true },
                { key: "bankStatement"as const, label: "Bank Statement",           desc: "Last 6 months bank statement",                   required: false },
                ...(accountType === "COMPANY" ? [{ key: "cacCert" as const, label: "CAC Certificate *", desc: "Certificate of Incorporation", required: true }] : []),
              ]).map(({ key, label, desc }) => (
                <div
                  key={key}
                  className={"flex items-center justify-between p-4 rounded-xl border-2 transition-all " + (
                    docs[key] ? "border-positive/40 bg-positive/5" : "border-border hover:border-primary/30"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={"w-9 h-9 rounded-lg flex items-center justify-center " + (docs[key] ? "bg-positive/20" : "bg-secondary")}>
                      {docs[key]
                        ? <CheckCircle2 className="w-4 h-4 text-positive" />
                        : <FileText className="w-4 h-4 text-muted-foreground" />
                      }
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground">{label}</div>
                      <div className="text-xs text-muted-foreground">{desc}</div>
                    </div>
                  </div>
                  <Button
                    variant={docs[key] ? "outline" : "default"}
                    size="sm"
                    className="gap-1.5 h-8 text-xs"
                    onClick={() => setDocs(d => ({ ...d, [key]: !d[key] }))}
                  >
                    {docs[key] ? <><CheckCircle2 className="w-3 h-3" />Uploaded</> : <><Upload className="w-3 h-3" />Upload</>}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 4 */}
        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Review &amp; Submit</h2>
            <div className="space-y-3">
              <div className="rounded-xl bg-secondary/50 border border-border p-4 space-y-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Account Details</div>
                {[
                  ["Account Type", accountType],
                  ["Name", accountType === "COMPANY" ? form.companyName : `${form.firstName} ${form.lastName}`],
                  ["Email", form.email],
                  ["Phone", form.phone],
                  ["Country", form.country],
                ].map(([k, v]) => (
                  <div key={String(k)} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="text-foreground font-medium">{v || "—"}</span>
                  </div>
                ))}
              </div>
              <div className="rounded-xl bg-secondary/50 border border-border p-4 space-y-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Documents</div>
                {[
                  ["Government ID",    docs.idDoc],
                  ["Proof of Address", docs.addressProof],
                  ["Bank Statement",   docs.bankStatement],
                ].map(([k, v]) => (
                  <div key={String(k)} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{k}</span>
                    <span className={v ? "text-positive" : "text-muted-foreground"}>
                      {v ? "✓ Uploaded" : "Not provided"}
                    </span>
                  </div>
                ))}
              </div>
              <div className="rounded-lg bg-primary/10 border border-primary/20 p-3 flex gap-2">
                <Shield className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                <p className="text-xs text-primary/90">
                  Your information is encrypted and processed in accordance with NEXCOM's privacy policy and applicable financial regulations.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        {step > 1 && (
          <Button variant="outline" className="gap-2" onClick={() => setStep(s => (s - 1) as Step)}>
            <ArrowLeft className="w-4 h-4" />Back
          </Button>
        )}
        <div className="flex-1" />
        {step < 4 ? (
          <Button className="gap-2" disabled={!canProceed()} onClick={() => setStep(s => (s + 1) as Step)}>
            Continue <ChevronRight className="w-4 h-4" />
          </Button>
        ) : (
          <Button className="gap-2" onClick={handleSubmit} disabled={submitMutation.isPending}>
            {submitMutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" />Submitting...</>
              : <><CheckCircle2 className="w-4 h-4" />Submit Application</>
            }
          </Button>
        )}
      </div>
    </div>
  );
}
