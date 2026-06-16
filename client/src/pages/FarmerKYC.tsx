/**
 * FarmerKYC — KYC document submission screen
 * Farmers upload NIN slip, utility bill, and farm ownership proof via real S3 upload
 * Includes active liveness check + face match before submission.
 */
import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ShieldCheck,
  ShieldAlert,
  Clock,
  Upload,
  CheckCircle2,
  ChevronLeft,
  FileText,
  Camera,
  AlertCircle,
  Loader2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { KycAnalysisPanel } from "@/components/KycAnalysisPanel";
import { PageSkeleton } from "@/components/PageSkeleton";
import LivenessChallengeModal, { LivenessResult } from "@/components/LivenessChallengeModal";

const KYC_DOCS = [
  {
    id: "nin_slip",
    label: "NIN Slip / National ID",
    description: "Clear photo of your National Identification Number slip",
    required: true,
    accept: "image/*,application/pdf",
  },
  {
    id: "utility_bill",
    label: "Utility Bill / Proof of Address",
    description: "Recent electricity or water bill (not older than 3 months)",
    required: true,
    accept: "image/*,application/pdf",
  },
  {
    id: "farm_ownership",
    label: "Farm Ownership / Land Certificate",
    description: "Certificate of occupancy, customary right of occupancy, or tenancy agreement",
    required: false,
    accept: "image/*,application/pdf",
  },
  {
    id: "passport_photo",
    label: "Passport Photograph",
    description: "Recent passport-sized photograph with white background",
    required: true,
    accept: "image/*",
  },
];

const MAX_FILE_SIZE_MB = 16;

export default function FarmerKYC() {
  const [, navigate] = useLocation();
  const profileQ = trpc.farmer.getMyFarmerProfile.useQuery();
  const utils = trpc.useUtils();

  // Track uploaded doc URLs (docId → url)
  const [uploadedDocs, setUploadedDocs] = useState<Record<string, string>>({});
  // Track per-doc uploading state
  const [uploadingDoc, setUploadingDoc] = useState<Record<string, boolean>>({});
  const [analysisResult, setAnalysisResult] = useState<{ overallRiskLevel: string; overallScore: number } | null>(null);

  // Liveness state
  const [livenessOpen, setLivenessOpen] = useState(false);
  const [livenessResult, setLivenessResult] = useState<LivenessResult | null>(null);
  const [applicationId] = useState(() => `farmer-kyc-${Date.now()}`);

  // Hidden file inputs — one per doc
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const uploadMut = trpc.farmer.uploadKycDocument.useMutation({
    onSuccess: (data) => {
      setUploadedDocs((prev) => ({ ...prev, [data.docId]: data.url }));
      setUploadingDoc((prev) => ({ ...prev, [data.docId]: false }));
      toast.success("Document uploaded successfully");
      utils.farmer.getMyFarmerProfile.invalidate();
    },
    onError: (e, vars) => {
      setUploadingDoc((prev) => ({ ...prev, [vars.docId]: false }));
      toast.error(`Upload failed: ${e.message}`);
    },
  });

  const [submitted, setSubmitted] = useState(false);
  const submitKYCMut = trpc.farmer.submitKYC.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      toast.success(
        "KYC submitted successfully!",
        {
          description: "We'll review your documents within 1-2 business days. You'll receive a notification once approved.",
          duration: 6000,
        }
      );
    },
    onError: (e) => toast.error("Submission failed", { description: e.message }),
  });

  type FarmerKYCProfile = { id: number; userId: number; fullName: string; kycStatus: string; kycNotes?: string | null; kycDocuments?: Record<string, string> | string | null };
  const profile = profileQ.data as FarmerKYCProfile | null | undefined;
  const kycStatus = (profile?.kycStatus ?? "PENDING") as string;

  // Merge server-stored docs with locally uploaded ones
  const serverDocs: Record<string, string> = profile?.kycDocuments
    ? (typeof profile.kycDocuments === "string"
        ? JSON.parse(profile.kycDocuments)
        : (profile.kycDocuments as Record<string, string>))
    : {};
  const allDocs = { ...serverDocs, ...uploadedDocs };

  function handleFileChange(docId: string, file: File) {
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      toast.error(`File too large. Maximum size is ${MAX_FILE_SIZE_MB} MB.`);
      return;
    }
    setUploadingDoc((prev) => ({ ...prev, [docId]: true }));
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = (e.target?.result as string).split(",")[1];
      uploadMut.mutate({
        docId,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        base64Data: base64,
      });
    };
    reader.onerror = () => {
      setUploadingDoc((prev) => ({ ...prev, [docId]: false }));
      toast.error("Failed to read file");
    };
    reader.readAsDataURL(file);
  }

  function triggerUpload(docId: string) {
    fileInputRefs.current[docId]?.click();
  }

  function handleSubmit() {
    const requiredDocs = KYC_DOCS.filter((d) => d.required);
    const missingRequired = requiredDocs.filter((d) => !allDocs[d.id]);
    if (missingRequired.length > 0) {
      toast.error(`Please upload: ${missingRequired.map((d) => d.label).join(", ")}`);
      return;
    }
    if (!livenessResult?.passed) {
      toast.error("Please complete the liveness check before submitting.");
      return;
    }
    submitKYCMut.mutate({ kycDocuments: JSON.stringify(allDocs) });
  }

  if (profileQ.isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-950 to-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-green-400 animate-spin" />
      </div>
    );
  }

  if (kycStatus === "APPROVED") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-950 to-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <ShieldCheck className="w-16 h-16 text-green-400 mb-4" />
        <h2 className="text-white text-xl font-bold mb-2">KYC Approved!</h2>
        <p className="text-slate-400 text-sm mb-6">Your identity has been verified. You can now add farms and list crops.</p>
        <Button onClick={() => navigate("/farmer-farms")} className="bg-green-600 hover:bg-green-700 text-white">
          Add Your Farm
        </Button>
      </div>
    );
  }

  if (kycStatus === "SUBMITTED" || kycStatus === "UNDER_REVIEW") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-950 to-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <Clock className="w-16 h-16 text-amber-400 mb-4 animate-pulse" />
        <h2 className="text-white text-xl font-bold mb-2">Under Review</h2>
        <p className="text-slate-400 text-sm mb-2">Your KYC documents are being reviewed.</p>
        <p className="text-slate-500 text-xs mb-6">Estimated time: 1-2 business days</p>
        <Button variant="outline" onClick={() => navigate("/farmer-dashboard")} className="border-slate-600 text-slate-300">
          Back to Dashboard
        </Button>
      </div>
    );
  }

  if (profileQ.isLoading) return <PageSkeleton cards={2} tableRows={4} tableCols={3} />;

  // ── Success screen shown immediately after submission ──────────────────────
  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-950 to-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="relative mb-6">
          <div className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center">
            <CheckCircle2 className="w-14 h-14 text-green-400" />
          </div>
          <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-green-500 flex items-center justify-center">
            <span className="text-white text-xs font-bold">✓</span>
          </div>
        </div>
        <h2 className="text-white text-2xl font-bold mb-2">Documents Submitted!</h2>
        <p className="text-slate-300 text-sm mb-1">Your KYC documents have been received.</p>
        <p className="text-slate-400 text-xs mb-6">Our compliance team will review them within <strong className="text-slate-300">1–2 business days</strong>. You’ll be notified once approved.</p>
        <div className="w-full max-w-xs bg-slate-800/60 border border-slate-700 rounded-xl p-4 mb-6 text-left space-y-2">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1">What happens next?</p>
          {[
            { step: "1", text: "Our team reviews your documents" },
            { step: "2", text: "Identity verified against NIN database" },
            { step: "3", text: "You receive an approval notification" },
            { step: "4", text: "Start listing your crops on NEXCOM" },
          ].map(({ step, text }) => (
            <div key={step} className="flex items-center gap-3">
              <span className="w-6 h-6 rounded-full bg-green-700/50 text-green-300 text-xs font-bold flex items-center justify-center shrink-0">{step}</span>
              <span className="text-slate-300 text-sm">{text}</span>
            </div>
          ))}
        </div>
        <Button
          onClick={() => navigate("/farmer-dashboard")}
          className="w-full max-w-xs bg-green-600 hover:bg-green-700 text-white font-semibold h-12"
        >
          Back to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-950 to-slate-950 flex flex-col max-w-md mx-auto" role="main" aria-label="KYC Verification">
      {/* Header */}
      <div className="p-4 flex items-center gap-3 border-b border-slate-800">
        <button onClick={() => navigate("/farmer-dashboard")} className="text-slate-400 hover:text-white" aria-label="Back to dashboard" type="button">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-white font-semibold">KYC Verification</h2>
          <p className="text-slate-400 text-xs">Upload your identity documents</p>
        </div>
        <Badge className="ml-auto bg-amber-900/60 text-amber-300 border-amber-700 text-xs">
          {kycStatus}
        </Badge>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1 bg-slate-800" role="progressbar" aria-label="Document upload progress" aria-valuenow={Object.keys(allDocs).length} aria-valuemin={0} aria-valuemax={KYC_DOCS.filter(d => d.required).length}>
        <div
          className="h-full bg-green-500 transition-all"
          style={{ width: `${(Object.keys(allDocs).length / KYC_DOCS.filter(d => d.required).length) * 100}%` }}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-24">
        {/* Rejection banner */}
        {kycStatus === "REJECTED" && (
          <Card className="bg-red-950/40 border-red-800/40">
            <CardContent className="p-4 flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-red-300 text-sm font-semibold">KYC Rejected</p>
                <p className="text-red-400/80 text-xs mt-1">
                  {profile?.kycNotes ?? "Please resubmit clearer documents."}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="bg-slate-800/60 border-slate-700">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-slate-300 text-xs">
              All documents are encrypted and stored securely. We only use them to verify your identity as required by the SEC Nigeria.
            </p>
          </CardContent>
        </Card>

        {/* Document Upload Cards */}
        {KYC_DOCS.map((doc) => {
          const uploaded = !!allDocs[doc.id];
          const isUploading = !!uploadingDoc[doc.id];
          return (
            <Card key={doc.id} className={`border ${uploaded ? "bg-green-950/30 border-green-800/40" : "bg-slate-800 border-slate-700"}`}>
              <CardContent className="p-4">
                {/* Hidden file input */}
                <input
                  ref={(el) => { fileInputRefs.current[doc.id] = el; }}
                  type="file"
                  accept={doc.accept}
                  className="hidden"
                  aria-label={`Upload ${doc.label}`}
                  id={`file-input-${doc.id}`}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileChange(doc.id, file);
                    e.target.value = "";
                  }}
                />
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${uploaded ? "bg-green-500/20" : "bg-slate-700"}`}>
                    {isUploading ? (
                      <Loader2 className="w-5 h-5 text-green-400 animate-spin" />
                    ) : uploaded ? (
                      <CheckCircle2 className="w-5 h-5 text-green-400" />
                    ) : (
                      <FileText className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">
                      {doc.label}
                      {doc.required && <span className="text-red-400 ml-1">*</span>}
                    </p>
                    <p className="text-slate-400 text-xs mt-0.5">{doc.description}</p>
                    {uploaded && (
                      <p className="text-green-400 text-xs mt-1 truncate">
                        ✓ Uploaded — <a href={allDocs[doc.id]} target="_blank" rel="noopener noreferrer" className="underline">View</a>
                      </p>
                    )}
                  </div>
                  {uploaded && (
                    <button
                      onClick={() => setUploadedDocs((prev) => { const n = { ...prev }; delete n[doc.id]; return n; })}
                      className="text-slate-500 hover:text-red-400 shrink-0"
                      aria-label={`Remove ${doc.label}`}
                      type="button"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => triggerUpload(doc.id)}
                    disabled={isUploading}
                    className={`flex-1 h-9 text-xs ${uploaded ? "border-green-700 text-green-400 hover:bg-green-950/40" : "border-slate-600 text-slate-300 hover:bg-slate-700"}`}
                  >
                    {isUploading ? (
                      <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Uploading…</>
                    ) : uploaded ? (
                      <><CheckCircle2 className="w-3.5 h-3.5 mr-1" />Uploaded — Replace</>
                    ) : (
                      <><Upload className="w-3.5 h-3.5 mr-1" />Upload Document</>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => triggerUpload(doc.id)}
                    disabled={isUploading}
                    className="h-9 w-9 p-0 border-slate-600 text-slate-300 hover:bg-slate-700"
                    title="Take photo"
                  >
                    <Camera className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* AI Document Analysis — triggers after NIN slip is uploaded */}
        {allDocs["nin_slip"] && (
          <KycAnalysisPanel
            documentUrl={allDocs["nin_slip"]}
            selfieUrl={allDocs["passport_photo"]}
            stakeholderType="FARMER"
            documentTypeHint="NIN_SLIP"
            onResult={(r) => setAnalysisResult({ overallRiskLevel: r.overallRiskLevel, overallScore: r.overallScore })}
            className="bg-slate-800/60 border border-slate-700 rounded-lg p-3"
          />
        )}

        {/* Liveness Check — shown once passport photo is uploaded */}
        {allDocs["passport_photo"] && (
          <div className="pt-1">
            {livenessResult?.passed ? (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-950/40 border border-green-800/40 text-green-400 text-sm">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  Liveness check passed
                  {livenessResult.faceMatchScore != null
                    ? ` · Face match: ${Math.round(livenessResult.faceMatchScore * 100)}%`
                    : ""}
                </span>
              </div>
            ) : (
              <Button
                onClick={() => setLivenessOpen(true)}
                variant="outline"
                className="w-full h-11 border-slate-600 text-slate-200 hover:bg-slate-700"
              >
                <Camera className="w-4 h-4 mr-2" />
                Complete Liveness Check <span className="text-red-400 ml-1">*</span>
              </Button>
            )}
          </div>
        )}

        {/* Submit */}
        <div className="pt-2">
          {analysisResult && analysisResult.overallRiskLevel === "CRITICAL" && (
            <p className="text-xs text-red-400 text-center mb-2">
              High-risk signals detected. Your submission will be flagged for manual review.
            </p>
          )}
          <Button
            onClick={handleSubmit}
            disabled={submitKYCMut.isPending || Object.values(uploadingDoc).some(Boolean)}
            className="w-full h-12 bg-green-600 hover:bg-green-700 text-white font-semibold"
          >
            {submitKYCMut.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting…</>
            ) : (
              "Submit for Verification"
            )}
          </Button>
          <p className="text-center text-slate-500 text-xs mt-2">
            Fields marked with * are required
          </p>
        </div>
      </div>

      {/* Full-screen submission overlay */}
      {submitKYCMut.isPending && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 p-8 rounded-2xl bg-slate-900/90 border border-green-800/40 shadow-2xl">
            <Loader2 className="w-12 h-12 text-green-400 animate-spin" />
            <div className="text-center">
              <p className="text-white font-semibold text-lg">Submitting KYC Documents</p>
              <p className="text-slate-400 text-sm mt-1">Please wait while we securely process your submission…</p>
            </div>
            <div className="flex gap-1.5 mt-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-2 h-2 rounded-full bg-green-500 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        </div>
      )}
      {/* Liveness Modal */}
      <LivenessChallengeModal
        open={livenessOpen}
        onClose={() => setLivenessOpen(false)}
        onComplete={(result) => {
          setLivenessResult(result);
          setLivenessOpen(false);
          if (result.passed) {
            toast.success("Liveness check passed!");
          } else {
            toast.error("Liveness check failed. Please try again in good lighting.");
          }
        }}
        applicationId={applicationId}
        documentPhotoUrl={allDocs["passport_photo"]}
        title="Farmer Identity Verification"
      />
    </div>
  );
}
