import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, Clock, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

interface WithdrawalChallengeModalProps {
  open: boolean;
  amount: number;
  onVerified: (challengeId: number) => void;
  onCancel: () => void;
}

export function WithdrawalChallengeModal({
  open,
  amount,
  onVerified,
  onCancel,
}: WithdrawalChallengeModalProps) {
  const [challengeId, setChallengeId] = useState<number | null>(null);
  const [challengeText, setChallengeText] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [answer, setAnswer] = useState("");
  const [attemptsRemaining, setAttemptsRemaining] = useState(3);
  const [hint, setHint] = useState<string | null>(null);
  const [passed, setPassed] = useState(false);

  const createChallenge = trpc.withdrawalVerification.createChallenge.useMutation({
    onSuccess: (data) => {
      if (data.required && data.challengeId) {
        setChallengeId(data.challengeId);
        setChallengeText(data.challengeText ?? null);
        setExpiresAt(data.expiresAt ? new Date(data.expiresAt) : null);
        setAttemptsRemaining(3);
        setAnswer("");
        setHint(null);
      }
    },
    onError: (err) => {
      toast.error("Failed to create verification challenge", { description: err.message });
    },
  });

  const submitAnswer = trpc.withdrawalVerification.submitAnswer.useMutation({
    onSuccess: (data) => {
      if (data.passed) {
        setPassed(true);
        toast.success("Identity verified", { description: "You may now proceed with the withdrawal." });
        setTimeout(() => {
          if (challengeId) onVerified(challengeId);
        }, 1500);
      } else {
        setAttemptsRemaining(data.attemptsRemaining ?? 0);
        setHint(data.hint ?? null);
        toast.warning("Incorrect answer", {
          description: `${data.attemptsRemaining} attempt${data.attemptsRemaining === 1 ? "" : "s"} remaining.`,
        });
      }
    },
    onError: (err) => {
      toast.error("Verification failed", { description: err.message });
      onCancel();
    },
  });

  function handleOpen() {
    if (!challengeId) {
      createChallenge.mutate({ amount });
    }
  }

  function handleSubmit() {
    if (!challengeId || !answer.trim()) return;
    submitAnswer.mutate({ challengeId, answer: answer.trim() });
  }

  function formatAmount(n: number) {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(n);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) handleOpen();
        else if (!passed) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            <DialogTitle>Large Withdrawal Verification</DialogTitle>
          </div>
          <DialogDescription>
            This withdrawal of <strong>{formatAmount(amount)}</strong> requires identity
            verification to protect against social-engineering and deepfake fraud.
          </DialogDescription>
        </DialogHeader>

        {createChallenge.isPending && (
          <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
            <Clock className="h-4 w-4 animate-spin" />
            Generating verification challenge…
          </div>
        )}

        {passed && (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <p className="text-sm font-medium text-green-600">Identity verified successfully</p>
          </div>
        )}

        {challengeText && !passed && (
          <div className="space-y-4">
            <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-sm text-amber-800 dark:text-amber-200">
                {challengeText}
              </AlertDescription>
            </Alert>

            {expiresAt && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                Challenge expires at {expiresAt.toLocaleTimeString()}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="challenge-answer">Your answer</Label>
              <Input
                id="challenge-answer"
                placeholder="Type your answer here…"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                disabled={submitAnswer.isPending}
                autoComplete="off"
              />
            </div>

            {hint && (
              <Alert className="border-red-200 bg-red-50 dark:bg-red-950/20">
                <XCircle className="h-4 w-4 text-red-500" />
                <AlertDescription className="text-sm text-red-700 dark:text-red-300">
                  {hint}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex items-center justify-between">
              <Badge variant={attemptsRemaining <= 1 ? "destructive" : "secondary"}>
                {attemptsRemaining} attempt{attemptsRemaining === 1 ? "" : "s"} remaining
              </Badge>
            </div>
          </div>
        )}

        {!passed && (
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={onCancel} disabled={submitAnswer.isPending}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!challengeId || !answer.trim() || submitAnswer.isPending || attemptsRemaining === 0}
            >
              {submitAnswer.isPending ? "Verifying…" : "Verify Identity"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
