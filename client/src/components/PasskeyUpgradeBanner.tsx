/**
 * PasskeyUpgradeBanner.tsx
 *
 * Shown once per browser session (persisted in localStorage) to authenticated
 * users who have no FIDO2 passkeys registered.  Clicking "Set up a passkey"
 * navigates to the Security Settings page.  Clicking "Maybe later" or the ×
 * button dismisses the banner for 30 days.
 *
 * Usage: mount inside DashboardLayout (or any authenticated layout) — it
 * self-hides when the user has passkeys or has dismissed it recently.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { ShieldCheck, X, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "nexcom_passkey_banner_dismissed_until";
const DISMISS_DAYS = 30;

function isDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    return Date.now() < Number(raw);
  } catch {
    return false;
  }
}

function dismiss() {
  try {
    const until = Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000;
    localStorage.setItem(DISMISS_KEY, String(until));
  } catch {
    // ignore storage errors
  }
}

export function PasskeyUpgradeBanner() {
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [visible, setVisible] = useState(false);

  // Only query when the user is logged in
  const { data, isLoading } = trpc.webauthn.getMfaStatus.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000, // 5 min — don't hammer the server
  });

  useEffect(() => {
    if (isLoading || !data) return;
    // Show banner if: no passkeys registered AND not dismissed recently
    const hasPasskeys = data.credentials.length > 0;
    if (!hasPasskeys && !isDismissed()) {
      setVisible(true);
    }
  }, [data, isLoading]);

  if (!visible) return null;

  function handleDismiss() {
    dismiss();
    setVisible(false);
  }

  function handleSetUp() {
    dismiss(); // also dismiss so it doesn't reappear immediately
    setVisible(false);
    setLocation("/security-settings");
  }

  return (
    <div
      role="banner"
      aria-live="polite"
      className="relative flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm shadow-sm mx-4 mt-3"
    >
      {/* Icon */}
      <div className="mt-0.5 shrink-0 rounded-full bg-primary/10 p-1.5">
        <KeyRound className="h-4 w-4 text-primary" />
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-foreground leading-snug">
          Upgrade to a passkey for phishing-proof login
        </p>
        <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
          Passkeys replace passwords with a cryptographic key stored on your device — no
          phishing, no credential theft, no shared secrets. Takes under 30 seconds to set up.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            variant="default"
            className="h-7 px-3 text-xs gap-1.5"
            onClick={handleSetUp}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Set up a passkey
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-3 text-xs text-muted-foreground hover:text-foreground"
            onClick={handleDismiss}
          >
            Maybe later
          </Button>
        </div>
      </div>

      {/* Dismiss × */}
      <button
        onClick={handleDismiss}
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        aria-label="Dismiss passkey upgrade prompt"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default PasskeyUpgradeBanner;
