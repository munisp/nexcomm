/**
 * NEXCOM Exchange — Cash Withdrawal
 *
 * Full withdrawal flow with three layers of security:
 *   1. Velocity limit check  — blocks if rolling window limit is exceeded
 *   2. TOTP challenge        — required when user has 2FA enabled
 *   3. Large-amount challenge — typed identity verification above ₦500k threshold
 *
 * After all checks pass the withdrawal is recorded in the velocity ledger and
 * a confirmation notification is sent to the user.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { TotpChallengeModal } from "@/components/TotpChallengeModal";
import { WithdrawalChallengeModal } from "@/components/WithdrawalChallengeModal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Banknote,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Info,
  ArrowRight,
  Clock,
  Building2,
} from "lucide-react";
import { toast } from "sonner";

// ─── Step definitions ────────────────────────────────────────────────────────
type Step = "form" | "velocity" | "totp" | "challenge" | "confirm" | "done";

function fmt(n: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(n);
}

// ─── Velocity status card ─────────────────────────────────────────────────────
function VelocityCard({
  amount,
  onContinue,
  onBack,
}: {
  amount: number;
  onContinue: () => void;
  onBack: () => void;
}) {
  const [stableAmount] = useState(amount);
  const { data, isLoading } = trpc.velocityLimit.checkLimit.useQuery(
    { amount: stableAmount, currency: "NGN" },
    { enabled: stableAmount > 0 }
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm justify-center">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking velocity limits…
      </div>
    );
  }

  const pct = data
    ? Math.min(100, (data.usedAmount / data.limitAmount) * 100)
    : 0;
  const allowed = data?.allowed ?? true;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Clock className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Velocity Limit Check</h3>
      </div>

      <div className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            Used in last {data?.windowHours ?? 24}h
          </span>
          <span className="font-mono font-medium">
            {fmt(data?.usedAmount ?? 0)} / {fmt(data?.limitAmount ?? 0)}
          </span>
        </div>
        <Progress value={pct} className={pct >= 90 ? "text-destructive" : ""} />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Remaining: {fmt(data?.remaining ?? 0)}</span>
          <span>This withdrawal: {fmt(amount)}</span>
        </div>
      </div>

      {!allowed ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            This withdrawal of <strong>{fmt(amount)}</strong> would exceed your{" "}
            {data?.windowHours ?? 24}-hour velocity limit. Remaining capacity:{" "}
            <strong>{fmt(data?.remaining ?? 0)}</strong>. Please try a smaller
            amount or wait for the window to reset.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="border-green-500/30 bg-green-500/10">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <AlertDescription className="text-green-700 dark:text-green-300">
            Withdrawal of <strong>{fmt(amount)}</strong> is within your velocity
            limit. Remaining after this withdrawal:{" "}
            <strong>{fmt((data?.remaining ?? 0) - amount)}</strong>.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex gap-3 justify-end">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onContinue} disabled={!allowed}>
          Continue
          <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ─── Summary / confirm card ───────────────────────────────────────────────────
function ConfirmCard({
  amount,
  bankName,
  bankAccount,
  onConfirm,
  onBack,
  isPending,
}: {
  amount: number;
  bankName: string;
  bankAccount: string;
  onConfirm: () => void;
  onBack: () => void;
  isPending: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Confirm Withdrawal</h3>
      </div>

      <div className="rounded-lg border border-border/60 divide-y divide-border/60">
        {[
          { label: "Amount", value: fmt(amount) },
          { label: "Fee", value: "₦500" },
          { label: "Net amount", value: fmt(amount - 500) },
          { label: "Destination bank", value: bankName || "—" },
          { label: "Account number", value: bankAccount ? `****${bankAccount.slice(-4)}` : "—" },
          { label: "Processing time", value: "1–2 business days" },
        ].map(({ label, value }) => (
          <div key={label} className="flex justify-between px-4 py-3 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium">{value}</span>
          </div>
        ))}
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          By confirming, you authorise NEXCOM to transfer the above amount to
          your registered bank account. This action cannot be reversed once
          processed.
        </AlertDescription>
      </Alert>

      <div className="flex gap-3 justify-end">
        <Button variant="outline" onClick={onBack} disabled={isPending}>
          Back
        </Button>
        <Button
          onClick={onConfirm}
          disabled={isPending}
          className="bg-primary text-white"
        >
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Processing…
            </>
          ) : (
            <>
              <Banknote className="h-4 w-4 mr-2" />
              Confirm Withdrawal
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function CashWithdrawal() {
  const { isAuthenticated } = useAuth();

  // Form state
  const [amountStr, setAmountStr] = useState("");
  const [note, setNote] = useState("");

  // Step machine
  const [step, setStep] = useState<Step>("form");

  // Modals
  const [showTotp, setShowTotp] = useState(false);
  const [showChallenge, setShowChallenge] = useState(false);

  // Flags set after each gate passes
  const [totpPassed, setTotpPassed] = useState(false);
  const [challengePassed, setChallengePassedState] = useState(false);
  const [challengeId, setChallengeId] = useState<number | null>(null);

  // Derived
  const amount = useMemo(() => {
    const n = parseFloat(amountStr.replace(/,/g, ""));
    return isNaN(n) ? 0 : n;
  }, [amountStr]);

  // Live data
  const { data: profile } = trpc.profile.get.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const { data: totpStatus } = trpc.totp.getStatus.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const { data: challengeRequired } =
    trpc.withdrawalVerification.checkRequired.useQuery(
      { amount },
      { enabled: amount > 0 }
    );

  // Mutations
  const recordWithdrawal = trpc.velocityLimit.recordWithdrawal.useMutation({
    onSuccess: () => {
      setStep("done");
      toast.success("Withdrawal submitted", {
        description: `${fmt(amount)} will be credited to your bank account within 1–2 business days.`,
      });
    },
    onError: (err) => {
      toast.error("Withdrawal failed", { description: err.message });
      setStep("form");
    },
  });

  // ─── Step handlers ──────────────────────────────────────────────────────────
  function handleFormSubmit() {
    if (amount < 1000) {
      toast.error("Minimum withdrawal is ₦1,000");
      return;
    }
    if (!profile?.bankAccount) {
      toast.error("No bank account linked", {
        description: "Please add your bank account in Account → Profile before withdrawing.",
      });
      return;
    }
    setStep("velocity");
  }

  function handleVelocityPassed() {
    // Next gate: TOTP (if enabled)
    if (totpStatus?.isEnabled) {
      setShowTotp(true);
    } else if (challengeRequired?.required) {
      setStep("challenge");
    } else {
      setStep("confirm");
    }
  }

  function handleTotpVerified() {
    setShowTotp(false);
    setTotpPassed(true);
    if (challengeRequired?.required) {
      setStep("challenge");
    } else {
      setStep("confirm");
    }
  }

  function handleTotpCancelled() {
    setShowTotp(false);
    setStep("velocity");
  }

  function handleChallengeVerified(cId: number) {
    setShowChallenge(false);
    setChallengePassedState(true);
    setChallengeId(cId);
    setStep("confirm");
  }

  function handleChallengeCancelled() {
    setShowChallenge(false);
    setStep(totpStatus?.isEnabled ? "velocity" : "velocity");
  }

  function handleConfirm() {
    recordWithdrawal.mutate({
      amount,
      currency: "NGN",
      reference: note.trim() || undefined,
    });
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div className="page-container max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1
            className="text-2xl font-bold text-foreground flex items-center gap-2"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            <Banknote className="w-6 h-6 text-primary" />
            Cash Withdrawal
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Transfer funds from your NEXCOM account to your registered bank account
          </p>
        </div>

        {/* Security badges */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="gap-1.5 text-xs">
            <ShieldCheck className="h-3 w-3 text-primary" />
            Velocity-limit protected
          </Badge>
          {totpStatus?.isEnabled && (
            <Badge variant="outline" className="gap-1.5 text-xs">
              <ShieldCheck className="h-3 w-3 text-green-500" />
              2FA required
            </Badge>
          )}
          {challengeRequired?.required && (
            <Badge variant="outline" className="gap-1.5 text-xs">
              <ShieldCheck className="h-3 w-3 text-amber-500" />
              Identity challenge required
            </Badge>
          )}
        </div>

        {/* Step card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {step === "form" && "Enter Withdrawal Details"}
              {step === "velocity" && "Velocity Limit Check"}
              {step === "totp" && "Two-Factor Authentication"}
              {step === "challenge" && "Identity Verification"}
              {step === "confirm" && "Review & Confirm"}
              {step === "done" && "Withdrawal Submitted"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* ── FORM ── */}
            {step === "form" && (
              <div className="space-y-5">
                {/* Bank account preview */}
                {profile?.bankAccount ? (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border/60">
                    <Building2 className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <div>
                      <div className="text-sm font-medium">
                        {profile.bankName ?? "Bank"} ****
                        {profile.bankAccount.slice(-4)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Registered bank account
                      </div>
                    </div>
                    <Badge className="ml-auto" variant="secondary">
                      Verified
                    </Badge>
                  </div>
                ) : (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      No bank account linked. Please add your bank account in{" "}
                      <strong>Account → Profile</strong> before withdrawing.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label htmlFor="amount">Amount (NGN)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                      ₦
                    </span>
                    <Input
                      id="amount"
                      className="pl-7 font-mono text-lg"
                      placeholder="0"
                      value={amountStr}
                      onChange={(e) =>
                        setAmountStr(e.target.value.replace(/[^0-9.]/g, ""))
                      }
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Minimum: ₦1,000 · Fee: ₦500 · Net:{" "}
                    {amount >= 500 ? fmt(amount - 500) : "—"}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="note">Reference / Note (optional)</Label>
                  <Input
                    id="note"
                    placeholder="e.g. Monthly salary withdrawal"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={128}
                  />
                </div>

                <Separator />

                {/* Security summary */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Security checks for this withdrawal
                  </p>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      Velocity limit check (rolling 24h window)
                    </div>
                    {totpStatus?.isEnabled ? (
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        Two-factor authentication (TOTP enabled)
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Info className="h-4 w-4" />
                        2FA not enabled — consider enabling it for extra security
                      </div>
                    )}
                    {amount >= (challengeRequired?.threshold ?? 500_000) ? (
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="h-4 w-4 text-amber-500" />
                        Identity challenge required (amount ≥{" "}
                        {fmt(challengeRequired?.threshold ?? 500_000)})
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Info className="h-4 w-4" />
                        No identity challenge needed below{" "}
                        {fmt(challengeRequired?.threshold ?? 500_000)}
                      </div>
                    )}
                  </div>
                </div>

                <Button
                  className="w-full bg-primary text-white"
                  onClick={handleFormSubmit}
                  disabled={amount < 1000 || !profile?.bankAccount}
                >
                  Proceed
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            )}

            {/* ── VELOCITY ── */}
            {step === "velocity" && (
              <VelocityCard
                amount={amount}
                onContinue={handleVelocityPassed}
                onBack={() => setStep("form")}
              />
            )}

            {/* ── TOTP (inline prompt while modal is open) ── */}
            {step === "velocity" && showTotp && (
              <TotpChallengeModal
                open={showTotp}
                onVerified={handleTotpVerified}
                onCancel={handleTotpCancelled}
                title="Two-Factor Authentication"
                description={`Enter your authenticator code to authorise the ${fmt(amount)} withdrawal.`}
              />
            )}

            {/* ── CHALLENGE ── */}
            {step === "challenge" && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  <h3 className="font-semibold">Identity Verification Required</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  Withdrawals above{" "}
                  {fmt(challengeRequired?.threshold ?? 500_000)} require an
                  additional identity challenge to protect against social-engineering
                  attacks.
                </p>
                <div className="flex gap-3 justify-end">
                  <Button
                    variant="outline"
                    onClick={() => setStep(totpStatus?.isEnabled ? "velocity" : "velocity")}
                  >
                    Back
                  </Button>
                  <Button
                    onClick={() => setShowChallenge(true)}
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    Start Identity Challenge
                  </Button>
                </div>
                <WithdrawalChallengeModal
                  open={showChallenge}
                  amount={amount}
                  onVerified={handleChallengeVerified}
                  onCancel={handleChallengeCancelled}
                />
              </div>
            )}

            {/* ── CONFIRM ── */}
            {step === "confirm" && (
              <ConfirmCard
                amount={amount}
                bankName={profile?.bankName ?? ""}
                bankAccount={profile?.bankAccount ?? ""}
                onConfirm={handleConfirm}
                onBack={() => {
                  if (challengeRequired?.required) setStep("challenge");
                  else if (totpStatus?.isEnabled) setStep("velocity");
                  else setStep("velocity");
                }}
                isPending={recordWithdrawal.isPending}
              />
            )}

            {/* ── DONE ── */}
            {step === "done" && (
              <div className="flex flex-col items-center gap-4 py-8">
                <CheckCircle2 className="h-16 w-16 text-green-500" />
                <div className="text-center space-y-1">
                  <p className="text-lg font-semibold">Withdrawal Submitted</p>
                  <p className="text-sm text-muted-foreground">
                    {fmt(amount)} will be credited to your bank account within
                    1–2 business days.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setStep("form");
                    setAmountStr("");
                    setNote("");
                    setTotpPassed(false);
                    setChallengePassedState(false);
                    setChallengeId(null);
                  }}
                >
                  Make Another Withdrawal
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* TOTP modal — shown after velocity check passes */}
        {step !== "velocity" && (
          <TotpChallengeModal
            open={showTotp}
            onVerified={handleTotpVerified}
            onCancel={handleTotpCancelled}
            title="Two-Factor Authentication"
            description={`Enter your authenticator code to authorise the ${fmt(amount)} withdrawal.`}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
