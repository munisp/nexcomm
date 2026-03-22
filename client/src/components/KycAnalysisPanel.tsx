/**
 * KycAnalysisPanel
 * Reusable component that triggers the PaddleOCR + VLM + Docling microservice
 * and displays the analysis result inline within any KYC submission form.
 *
 * Usage:
 *   <KycAnalysisPanel
 *     documentUrl={docUrl}
 *     selfieUrl={selfieUrl}   // optional
 *     stakeholderType="FARMER"
 *     onResult={(result) => setAnalysisResult(result)}
 *   />
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  Shield,
  Eye,
  FileText,
  ChevronDown,
  ChevronUp,
  Activity,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

export type StakeholderType =
  | "FARMER"
  | "TRADER"
  | "BROKER"
  | "WAREHOUSE_OPERATOR"
  | "MARKET_MAKER";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";

export interface KycAnalysisResult {
  id: number | null;
  success: boolean;
  overallRiskLevel: string;
  overallScore: number;
  riskFlags: string[];
  recommendation: string;
  documentType: unknown;
  documentAuthenticityScore: unknown;
  ocrExtractedFields: Record<string, unknown>;
  selfieScore: unknown;
  livenessAssessment: unknown;
  passiveLivenessScore: unknown;
  passiveLivenessFlags: string[];
  documentSummary: unknown;
  selfieSummary: unknown;
}

interface KycAnalysisPanelProps {
  documentUrl: string;
  selfieUrl?: string;
  stakeholderType: StakeholderType;
  documentTypeHint?: string;
  isPdf?: boolean;
  onResult?: (result: KycAnalysisResult) => void;
  className?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RISK_CONFIG: Record<
  RiskLevel,
  { label: string; color: string; icon: React.ReactNode; bg: string }
> = {
  LOW: {
    label: "Low Risk",
    color: "text-emerald-600",
    bg: "bg-emerald-50 border-emerald-200",
    icon: <CheckCircle className="w-4 h-4 text-emerald-600" />,
  },
  MEDIUM: {
    label: "Medium Risk",
    color: "text-amber-600",
    bg: "bg-amber-50 border-amber-200",
    icon: <AlertTriangle className="w-4 h-4 text-amber-600" />,
  },
  HIGH: {
    label: "High Risk",
    color: "text-orange-600",
    bg: "bg-orange-50 border-orange-200",
    icon: <AlertTriangle className="w-4 h-4 text-orange-600" />,
  },
  CRITICAL: {
    label: "Critical Risk",
    color: "text-red-600",
    bg: "bg-red-50 border-red-200",
    icon: <XCircle className="w-4 h-4 text-red-600" />,
  },
  UNKNOWN: {
    label: "Unknown",
    color: "text-slate-500",
    bg: "bg-slate-50 border-slate-200",
    icon: <Activity className="w-4 h-4 text-slate-500" />,
  },
};

function ScoreBar({ score, label }: { score: number; label: string }) {
  const pct = Math.round(Math.min(100, Math.max(0, score * 100)));
  const color =
    pct >= 80
      ? "bg-emerald-500"
      : pct >= 60
      ? "bg-amber-500"
      : pct >= 40
      ? "bg-orange-500"
      : "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-medium">{pct}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ServiceHealthBadge() {
  const { data: health } = trpc.kycAnalysis.serviceHealth.useQuery(undefined, {
    staleTime: 30_000,
    retry: false,
  });
  if (!health) return null;
  return (
    <Badge
      variant="outline"
      className={
        health.healthy
          ? "text-emerald-600 border-emerald-300"
          : "text-red-600 border-red-300"
      }
    >
      <Activity className="w-3 h-3 mr-1" />
      KYC Service {health.healthy ? "Online" : "Offline"}
    </Badge>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function KycAnalysisPanel({
  documentUrl,
  selfieUrl,
  stakeholderType,
  documentTypeHint,
  isPdf = false,
  onResult,
  className = "",
}: KycAnalysisPanelProps) {
  const [result, setResult] = useState<KycAnalysisResult | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const analyseMutation = trpc.kycAnalysis.analyse.useMutation({
    onSuccess: (data) => {
      setResult(data as unknown as KycAnalysisResult);
      onResult?.(data as unknown as KycAnalysisResult);
    },
  });

  const riskLevel = (result?.overallRiskLevel ?? "UNKNOWN") as RiskLevel;
  const riskCfg = RISK_CONFIG[riskLevel] ?? RISK_CONFIG.UNKNOWN;

  const handleAnalyse = () => {
    if (!documentUrl) return;
    analyseMutation.mutate({
      documentUrl,
      selfieUrl,
      stakeholderType,
      documentTypeHint,
      isPdf,
    });
  };

  const ocrFields = result?.ocrExtractedFields ?? {};
  const ocrEntries = Object.entries(ocrFields).filter(
    ([, v]) => v !== null && v !== undefined && v !== ""
  );

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">AI Document Analysis</span>
        </div>
        <ServiceHealthBadge />
      </div>

      {/* Trigger button */}
      {!result && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAnalyse}
          disabled={!documentUrl || analyseMutation.isPending}
          className="w-full"
        >
          {analyseMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Analysing document…
            </>
          ) : (
            <>
              <Shield className="w-4 h-4 mr-2" />
              Run Authenticity & Liveness Check
            </>
          )}
        </Button>
      )}

      {/* Error state */}
      {analyseMutation.isError && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
          Analysis failed: {analyseMutation.error?.message ?? "Unknown error"}
        </div>
      )}

      {/* Result card */}
      {result && (
        <Card className={`border ${riskCfg.bg}`}>
          <CardHeader className="pb-2 pt-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                {riskCfg.icon}
                <span className={riskCfg.color}>{riskCfg.label}</span>
              </CardTitle>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${riskCfg.color}`}>
                  Score: {Math.round((result.overallScore ?? 0) * 100)}%
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1"
                  onClick={() => setShowDetails((v) => !v)}
                >
                  {showDetails ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="px-4 pb-3 space-y-3">
            {/* Score bars */}
            <div className="space-y-2">
              {typeof result.documentAuthenticityScore === "number" && (
                <ScoreBar
                  score={result.documentAuthenticityScore}
                  label="Document Authenticity"
                />
              )}
              {typeof result.selfieScore === "number" && (
                <ScoreBar score={result.selfieScore} label="Selfie Analysis" />
              )}
              {typeof result.passiveLivenessScore === "number" && (
                <ScoreBar
                  score={result.passiveLivenessScore}
                  label="Passive Liveness"
                />
              )}
            </div>

            {/* Recommendation */}
            <p className="text-xs text-muted-foreground leading-relaxed">
              {result.recommendation}
            </p>

            {/* Risk flags */}
            {result.riskFlags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {result.riskFlags.map((flag) => (
                  <Badge
                    key={flag}
                    variant="outline"
                    className="text-xs text-orange-700 border-orange-300 bg-orange-50"
                  >
                    {flag.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
            )}

            {/* Expanded details */}
            {showDetails && (
              <div className="space-y-3 pt-2 border-t border-current/10">
                {/* Document type */}
                {result.documentType != null && (
                  <div className="flex items-center gap-2 text-xs">
                    <FileText className="w-3 h-3 text-muted-foreground" />
                    <span className="text-muted-foreground">
                      Detected type:
                    </span>
                    <span className="font-medium">
                      {String(result.documentType)}
                    </span>
                  </div>
                )}

                {/* Liveness assessment */}
                {result.livenessAssessment != null && (
                  <div className="flex items-center gap-2 text-xs">
                    <Eye className="w-3 h-3 text-muted-foreground" />
                    <span className="text-muted-foreground">Liveness:</span>
                    <span className="font-medium">
                      {String(result.livenessAssessment)}
                    </span>
                  </div>
                )}

                {/* Passive liveness flags */}
                {result.passiveLivenessFlags.length > 0 && (
                  <div className="text-xs space-y-1">
                    <span className="text-muted-foreground font-medium">
                      Liveness flags:
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {result.passiveLivenessFlags.map((f) => (
                        <Badge
                          key={f}
                          variant="outline"
                          className="text-xs text-slate-600"
                        >
                          {f}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* OCR extracted fields */}
                {ocrEntries.length > 0 && (
                  <div className="text-xs space-y-1">
                    <span className="text-muted-foreground font-medium">
                      OCR-extracted fields:
                    </span>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      {ocrEntries.slice(0, 12).map(([k, v]) => (
                        <div key={k} className="flex flex-col">
                          <span className="text-muted-foreground capitalize">
                            {k.replace(/_/g, " ")}
                          </span>
                          <span className="font-medium truncate">
                            {String(v)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Re-run button */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleAnalyse}
                  disabled={analyseMutation.isPending}
                  className="w-full text-xs"
                >
                  {analyseMutation.isPending ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <Shield className="w-3 h-3 mr-1" />
                  )}
                  Re-run Analysis
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default KycAnalysisPanel;
