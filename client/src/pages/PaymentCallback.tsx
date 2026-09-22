/**
 * PaymentCallback — /payment/callback (PAY-RAILS)
 *
 * Landing page after a provider redirect (Paystack/Flutterwave/Monnify/
 * Interswitch/Stripe/Mock hosted checkout). Reads ?reference&provider from the
 * URL, calls payments.verifyPayment once, then polls payments.paymentStatus
 * (up to 5 tries, 2s backoff) while the rail settles.
 *
 * Low-bandwidth / offline behaviour (rural 2G-first):
 *  - uses useConnectionQuality() — when offline we show a "queued" banner and
 *    pause polling instead of burning airtime on doomed requests;
 *  - on "slow" connections we double the poll interval;
 *  - all statuses render compact, single-request UIs (no heavy assets).
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useConnectionQuality } from "@/lib/connectionQuality";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Loader2, WifiOff, Clock } from "lucide-react";

type ViewState = "verifying" | "polling" | "success" | "failed" | "pending" | "error" | "offline";

const MAX_POLLS = 5;
const BASE_BACKOFF_MS = 2_000;

function formatAmount(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  if (currency === "NGN") return `₦${major.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
  return `${currency} ${major.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

export default function PaymentCallback() {
  const [, navigate] = useLocation();
  const { quality, isOnline } = useConnectionQuality();
  const utils = trpc.useUtils();

  const params = new URLSearchParams(window.location.search);
  const reference = params.get("reference") ?? params.get("trxref") ?? params.get("tx_ref") ?? "";
  const provider = params.get("provider") ?? "";
  const cancelled = params.get("cancelled") === "1";

  const [state, setState] = useState<ViewState>(cancelled ? "failed" : "verifying");
  const [statusLine, setStatusLine] = useState<string>("");
  const [amountLine, setAmountLine] = useState<string>("");
  const attempts = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const verifyMutation = trpc.payments.verifyPayment.useMutation();

  useEffect(() => {
    if (!reference) {
      setState("error");
      setStatusLine("No payment reference in the URL.");
      return;
    }

    let cancelledLocal = false;

    const pollDelay = () => (quality === "slow" ? BASE_BACKOFF_MS * 2 : BASE_BACKOFF_MS);

    const run = async () => {
      if (cancelledLocal) return;

      // Offline: park the flow — the payment itself continues at the provider
      // and the webhook will settle it; we just can't confirm right now.
      if (!isOnline) {
        setState("offline");
        timer.current = setTimeout(run, pollDelay());
        return;
      }

      try {
        if (attempts.current === 0) {
          setState("verifying");
          const res = await verifyMutation.mutateAsync({ providerRef: reference });
          const status = res.payment.status;
          setAmountLine(formatAmount(Number(res.payment.amountMinor), res.payment.currency));
          if (status === "success") {
            setState("success");
            toast.success("Payment confirmed — wallet credited");
            return;
          }
          if (status === "failed" || status === "abandoned") {
            setState("failed");
            toast.error("Payment was not successful");
            return;
          }
          // Fall through to polling for pending/processing.
        } else {
          setState("polling");
          const res = await utils.payments.paymentStatus.fetch({ providerRef: reference });
          if (res) {
            setAmountLine(formatAmount(Number(res.amountMinor), res.currency));
            if (res.status === "success") {
              setState("success");
              toast.success("Payment confirmed — wallet credited");
              return;
            }
            if (res.status === "failed" || res.status === "abandoned") {
              setState("failed");
              toast.error("Payment was not successful");
              return;
            }
          }
        }
      } catch (e) {
        // Transient verify failure — treat like a pending poll tick.
        console.warn("[PaymentCallback] verify/poll failed:", (e as Error).message);
      }

      attempts.current += 1;
      if (attempts.current >= MAX_POLLS) {
        // Still unsettled after all tries — that's OK for USSD/bank transfer;
        // the webhook completes the credit and the user can re-check later.
        setState("pending");
        setStatusLine(
          "Your payment is still processing. Bank transfer / USSD payments can take a few minutes — we'll credit your wallet automatically once confirmed."
        );
        return;
      }
      timer.current = setTimeout(run, pollDelay());
    };

    void run();
    return () => {
      cancelledLocal = true;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference, isOnline]);

  void provider; // reserved for provider-specific messaging

  return (
    <div className="container max-w-lg py-10">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {(state === "verifying" || state === "polling") && <Loader2 className="h-5 w-5 animate-spin" />}
            {state === "success" && <CheckCircle2 className="h-5 w-5 text-green-600" />}
            {state === "failed" && <XCircle className="h-5 w-5 text-red-600" />}
            {state === "pending" && <Clock className="h-5 w-5 text-amber-600" />}
            {state === "offline" && <WifiOff className="h-5 w-5 text-amber-600" />}
            Payment {state === "success" ? "Confirmed" : state === "failed" ? "Failed" : state === "error" ? "Error" : "Status"}
          </CardTitle>
          <CardDescription>
            {amountLine && <span className="font-medium">{amountLine}</span>}
            {reference && <span className="block text-xs mt-1 break-all">Ref: {reference}</span>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {state === "verifying" && <p>Confirming your payment with the provider…</p>}
          {state === "polling" && (
            <p>
              Waiting for confirmation…{" "}
              <Badge variant="secondary">
                attempt {attempts.current + 1}/{MAX_POLLS}
              </Badge>
            </p>
          )}
          {state === "offline" && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
              You're offline. Verification is queued and will resume automatically when your
              connection returns — your payment is not lost.
            </div>
          )}
          {state === "pending" && <p className="text-sm">{statusLine}</p>}
          {state === "success" && <p>Your wallet has been credited. You can start trading.</p>}
          {state === "failed" && (
            <p className="text-sm">This payment did not complete. No money was credited. You can try again.</p>
          )}
          {state === "error" && <p className="text-sm text-red-600">{statusLine}</p>}

          <div className="flex gap-2">
            {state === "success" && (
              <>
                <Button onClick={() => navigate("/trade")}>Start Trading</Button>
                <Button variant="outline" onClick={() => navigate("/payments")}>View Payments</Button>
              </>
            )}
            {(state === "failed" || state === "pending") && (
              <>
                <Button onClick={() => navigate("/deposits")}>Back to Deposits</Button>
                <Button variant="outline" onClick={() => navigate("/payments")}>Payment History</Button>
              </>
            )}
            {state === "error" && (
              <Button onClick={() => navigate("/deposits")}>Back to Deposits</Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
