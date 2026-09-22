/**
 * RiskShieldBadge.tsx — INNOVATION 3: TRADE RISK SHIELD (inline badge)
 * ─────────────────────────────────────────────────────────────────────────────
 * Compact shield badge for the order ticket:
 *   green  (allow)  ·  amber (review)  ·  red (block)  ·  grey (unavailable)
 * Tooltip breaks down fraud probability, GNN ring probability, cold-start
 * state and model version. Cold-start and unavailable are rendered as honest
 * states — never implied by a fake "0%" score.
 *
 * Design tokens follow the Trade page: bg-white/5, border-white/10,
 * text-muted-foreground, emerald/amber/red accent tints (low saturation).
 */
import { Shield, ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type RiskDecision = "allow" | "review" | "block";

export interface RiskShieldBadgeProps {
  /** null while no assessment has run yet */
  status: "idle" | "loading" | "ok" | "unavailable";
  decision?: RiskDecision | null;
  fraudProbability?: number | null;
  ringProbability?: number | null; // null = graph cold-start / unknown account
  coldStart?: boolean;
  modelVersion?: string | null;
  unavailableReason?: string | null;
}

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;

export function RiskShieldBadge({
  status,
  decision,
  fraudProbability,
  ringProbability,
  coldStart,
  modelVersion,
  unavailableReason,
}: RiskShieldBadgeProps) {
  let icon = <Shield className="h-3.5 w-3.5" />;
  let label = "Risk check";
  let classes = "bg-white/5 text-muted-foreground border-white/10";

  if (status === "loading") {
    icon = <Shield className="h-3.5 w-3.5 animate-pulse" />;
    label = "Checking…";
  } else if (status === "unavailable") {
    icon = <ShieldQuestion className="h-3.5 w-3.5" />;
    label = "Risk check unavailable";
    classes = "bg-white/5 text-muted-foreground border-white/10";
  } else if (status === "ok" && decision === "allow") {
    icon = <ShieldCheck className="h-3.5 w-3.5" />;
    label = "Shielded";
    classes = "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
  } else if (status === "ok" && decision === "review") {
    icon = <ShieldAlert className="h-3.5 w-3.5" />;
    label = "Review advised";
    classes = "bg-amber-500/10 text-amber-300 border-amber-500/30";
  } else if (status === "ok" && decision === "block") {
    icon = <ShieldX className="h-3.5 w-3.5" />;
    label = "High risk";
    classes = "bg-red-500/10 text-red-300 border-red-500/30";
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium cursor-default ${classes}`}
            data-testid="risk-shield-badge"
          >
            {icon}
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent className="bg-[#0d1410] border-white/10 text-white max-w-xs">
          {status === "unavailable" ? (
            <div className="space-y-1 text-xs">
              <p className="font-medium">Pre-trade risk scoring is offline.</p>
              <p className="text-muted-foreground">
                {unavailableReason ?? "ml-platform did not respond within the 800 ms budget."}
              </p>
              <p className="text-muted-foreground">Orders still route through standard surveillance.</p>
            </div>
          ) : status === "ok" ? (
            <div className="space-y-1 text-xs">
              <div className="flex justify-between gap-6">
                <span className="text-muted-foreground">Fraud probability</span>
                <span className="font-mono">
                  {fraudProbability != null ? pct(fraudProbability) : "—"}
                </span>
              </div>
              <div className="flex justify-between gap-6">
                <span className="text-muted-foreground">Fraud-ring probability (GNN)</span>
                <span className="font-mono">
                  {ringProbability != null ? pct(ringProbability) : "no graph history"}
                </span>
              </div>
              <div className="flex justify-between gap-6">
                <span className="text-muted-foreground">Decision</span>
                <span className="font-mono uppercase">{decision ?? "—"}</span>
              </div>
              {coldStart && (
                <p className="text-amber-300/90 pt-1">
                  Cold start: limited account history — score confidence is low until you build
                  trading history on the platform.
                </p>
              )}
              {modelVersion && (
                <p className="text-muted-foreground pt-1">model {modelVersion}</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Enter quantity and price to get a live pre-trade risk assessment.
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default RiskShieldBadge;
