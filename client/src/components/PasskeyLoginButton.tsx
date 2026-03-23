/**
 * PasskeyLoginButton.tsx
 *
 * A "Sign in with passkey" button that:
 *  1. Calls `webauthn.passkeyLoginOptions` to get a challenge
 *  2. Invokes `navigator.credentials.get()` to trigger the browser passkey picker
 *  3. Calls `webauthn.passkeyLoginVerify` to validate the assertion and set the session cookie
 *  4. Reloads the page so the new session cookie is picked up by the tRPC context
 *
 * Usage:
 *   <PasskeyLoginButton />
 *   <PasskeyLoginButton email={emailInputValue} />
 *
 * The button is hidden if the browser does not support WebAuthn.
 */
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function isWebAuthnSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator.credentials?.get === "function"
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
interface PasskeyLoginButtonProps {
  email?: string;
  className?: string;
  onSuccess?: () => void;
}

export function PasskeyLoginButton({ email, className, onSuccess }: PasskeyLoginButtonProps) {
  const [supported, setSupported] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSupported(isWebAuthnSupported());
  }, []);

  const getOptions = trpc.webauthn.passkeyLoginOptions.useMutation();
  const verifyLogin = trpc.webauthn.passkeyLoginVerify.useMutation();

  if (!supported) return null;

  async function handlePasskeyLogin() {
    setLoading(true);
    try {
      // Step 1: get challenge
      const options = await getOptions.mutateAsync({ email: email || undefined });

      // Step 2: browser passkey assertion
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: base64urlToBuffer(options.challenge),
          timeout: options.timeout,
          rpId: options.rpId,
          allowCredentials: options.allowCredentials.map((c) => ({
            type: c.type as PublicKeyCredentialType,
            id: base64urlToBuffer(c.id),
            transports: c.transports as AuthenticatorTransport[],
          })),
          userVerification: options.userVerification as UserVerificationRequirement,
        },
      }) as PublicKeyCredential | null;

      if (!credential) {
        toast.error("Passkey authentication cancelled");
        setLoading(false);
        return;
      }

      const response = credential.response as AuthenticatorAssertionResponse;

      // Step 3: verify on server
      await verifyLogin.mutateAsync({
        credentialId: bufferToBase64url(credential.rawId),
        authenticatorData: bufferToBase64url(response.authenticatorData),
        clientDataJSON: bufferToBase64url(response.clientDataJSON),
        signature: bufferToBase64url(response.signature),
        userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : undefined,
        challenge: options.challenge,
      });

      toast.success("Signed in with passkey!");
      if (onSuccess) {
        onSuccess();
      } else {
        // Reload to pick up the new session cookie
        window.location.reload();
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        // User cancelled or timed out — not an error
        toast.info("Passkey authentication cancelled");
      } else {
        const msg = err instanceof Error ? err.message : "Passkey authentication failed";
        toast.error("Passkey sign-in failed", { description: msg });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handlePasskeyLogin}
      disabled={loading}
      className={`gap-2 ${className ?? ""}`}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <KeyRound className="h-4 w-4" />
      )}
      {loading ? "Authenticating…" : "Sign in with passkey"}
    </Button>
  );
}
