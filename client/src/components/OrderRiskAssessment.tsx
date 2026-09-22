/**
 * OrderRiskAssessment.tsx — INNOVATION 3: TRADE RISK SHIELD (pre-trade panel)
 * ─────────────────────────────────────────────────────────────────────────────
 * Debounced (600 ms) pre-trade risk panel that calls
 * trpc.riskShield.assessOrder as the order ticket is being composed.
 * Renders the RiskShieldBadge plus an honest breakdown line.
 *
 * Wiring (exact insertion point — client/src/pages/Trade.tsx):
 *   Inside the order-entry form container `<div className="max-w-sm mx-auto
 *   space-y-4">`, directly AFTER the estimated-value block (the
 *   `{orderQty && (<div className="flex justify-between ...">…)}` element,
 *   ~line 728) and BEFORE the submit `<Button onClick={handleSubmitOrder} …>`
 *   (~line 760):
 *
 *     import { OrderRiskAssessment } from "@/components/OrderRiskAssessment";
 *
 *     <OrderRiskAssessment
 *       commodity={selectedCommodity.name}
 *       amount={orderValue}
 *       quantity={parseFloat(orderQty) || undefined}
 *       channel="web"
 *     />
 */
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { RiskShieldBadge, type RiskDecision } from "@/components/RiskShieldBadge";

export interface OrderRiskAssessmentProps {
  commodity: string;
  /** estimated order value in NGN */
  amount: number;
  quantity?: number;
  counterparty?: string;
  channel?: "web" | "ussd" | "whatsapp" | "agent";
  debounceMs?: number;
}

type AssessResult = {
  status: "ok";
  fraud_probability: number;
  fraud_decision: RiskDecision;
  ring_probability: number | null;
  ring_cold_start: boolean;
  cold_start: boolean;
  feature_source: string;
  model_version: string;
  ring_model_version: string | null;
  assessed_at: string;
} | {
  status: "unavailable";
  reason: string;
  assessed_at: string;
};

export function OrderRiskAssessment({
  commodity,
  amount,
  quantity,
  counterparty,
  channel = "web",
  debounceMs = 600,
}: OrderRiskAssessmentProps) {
  const [result, setResult] = useState<AssessResult | null>(null);
  const assess = trpc.riskShield.assessOrder.useMutation({
    onSuccess: (data) => setResult(data as AssessResult),
    onError: (err) =>
      setResult({ status: "unavailable", reason: err.message, assessed_at: new Date().toISOString() }),
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced reassessment whenever the ticket changes materially.
  useEffect(() => {
    if (!commodity || !(amount > 0)) {
      setResult(null);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      assess.mutate({ commodity, amount, quantity, counterparty, channel });
    }, debounceMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commodity, amount, quantity, counterparty, channel]);

  const loading = assess.isPending;
  const ok = result?.status === "ok" ? result : null;

  return (
    <div
      className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 space-y-1"
      data-testid="order-risk-assessment"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Pre-trade risk</span>
        <RiskShieldBadge
          status={!commodity || !(amount > 0) ? "idle" : loading ? "loading" : result?.status ?? "idle"}
          decision={ok?.fraud_decision ?? null}
          fraudProbability={ok?.fraud_probability ?? null}
          ringProbability={ok?.ring_probability ?? null}
          coldStart={ok?.cold_start}
          modelVersion={ok?.model_version ?? null}
          unavailableReason={result?.status === "unavailable" ? result.reason : null}
        />
      </div>
      {ok && (
        <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
          <span>
            fraud {(ok.fraud_probability * 100).toFixed(1)}%
            {" · "}
            ring {ok.ring_probability != null ? `${(ok.ring_probability * 100).toFixed(1)}%` : "n/a"}
          </span>
          <span>{ok.cold_start ? "cold start" : ok.feature_source}</span>
        </div>
      )}
      {result?.status === "unavailable" && (
        <p className="text-[11px] text-muted-foreground">
          Scoring offline — order will still pass standard surveillance.
        </p>
      )}
    </div>
  );
}

export default OrderRiskAssessment;
