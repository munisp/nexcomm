/**
 * TotpChallengeModal
 *
 * Renders a TOTP / backup-code challenge dialog before sensitive operations
 * (e.g. large withdrawals, account changes).
 *
 * Usage:
 *   <TotpChallengeModal
 *     open={showTotp}
 *     onVerified={() => { setShowTotp(false); proceedWithWithdrawal(); }}
 *     onCancel={() => setShowTotp(false)}
 *     title="Confirm Withdrawal"
 *     description="Enter your 2FA code to authorise this withdrawal."
 *   />
 */
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShieldCheck, KeyRound, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

export interface TotpChallengeModalProps {
  open: boolean;
  /** Called when the code is verified successfully */
  onVerified: () => void;
  /** Called when the user cancels or the dialog is closed */
  onCancel: () => void;
  title?: string;
  description?: string;
}

export function TotpChallengeModal({
  open,
  onVerified,
  onCancel,
  title = "Two-Factor Authentication Required",
  description = "Enter your authenticator code or a backup code to continue.",
}: TotpChallengeModalProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setCode("");
      setError(null);
      setVerified(false);
    }
  }, [open]);

  const verifyMutation = trpc.totp.verifyCode.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        setVerified(true);
        toast.success("2FA verified", {
          description:
            data.method === "backup"
              ? `Backup code accepted. ${(data as { remaining?: number }).remaining ?? 0} backup codes remaining.`
              : "Authenticator code accepted.",
        });
        // Give the user a moment to see the success state before proceeding
        setTimeout(() => {
          onVerified();
        }, 900);
      }
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  function handleSubmit() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setError(null);
    verifyMutation.mutate({ code: trimmed });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSubmit();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !verified) onCancel();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {verified ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <p className="text-sm font-medium text-green-600">Identity verified</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="totp-code" className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5" />
                Authenticator Code or Backup Code
              </Label>
              <Input
                id="totp-code"
                placeholder="6-digit code or 8-character backup code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\s/g, ""));
                  setError(null);
                }}
                onKeyDown={handleKeyDown}
                maxLength={8}
                autoComplete="one-time-code"
                inputMode="numeric"
                disabled={verifyMutation.isPending}
                className="font-mono tracking-widest text-center text-lg"
              />
              <p className="text-xs text-muted-foreground">
                Open your authenticator app and enter the 6-digit code, or enter one of
                your 8-character backup codes.
              </p>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription className="text-sm">{error}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {!verified && (
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={verifyMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={code.trim().length < 6 || verifyMutation.isPending}
            >
              {verifyMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Verifying…
                </>
              ) : (
                "Verify"
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
