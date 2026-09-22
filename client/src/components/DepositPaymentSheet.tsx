/**
 * DepositPaymentSheet (PAY-RAILS) — fund your wallet via any enabled rail.
 *
 *  - Amount input with ₦ formatting (minor units under the hood)
 *  - Provider + channel picker driven by payments.listProviders (capability-
 *    driven: only rails that support the selected currency/channel are offered)
 *  - Renders whatever the rail returns: authorizationUrl (open), ussdCode
 *    (large mono + copy), qrData (rendered via the `qrcode` package),
 *    transferAccount details for bank_transfer
 *  - Low-bandwidth friendly: no heavy deps, plain controls, single mutation.
 *
 * Usage: <DepositPaymentSheet onCompleted={() => refetchBalances()} />
 */
import { useMemo, useState } from "react";
import QRCode from "qrcode";
import { nanoid } from "nanoid";
import { trpc } from "@/lib/trpc";
import { useConnectionQuality } from "@/lib/connectionQuality";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2 } from "lucide-react";

type Channel = "card" | "bank_transfer" | "ussd" | "qr" | "mobile_money" | "bank_debit";

const CHANNEL_LABELS: Record<Channel, string> = {
  card: "Card",
  bank_transfer: "Bank Transfer",
  ussd: "USSD",
  qr: "QR Code",
  mobile_money: "Mobile Money",
  bank_debit: "Bank Debit",
};

interface InitiatedPayment {
  providerRef: string;
  provider: string;
  authorizationUrl?: string | null;
  ussdCode?: string | null;
  qrData?: string | null;
  transferAccount?: { bankName: string; accountNumber: string; accountName: string } | null;
}

function parseNairaToKobo(raw: string): number | null {
  const cleaned = raw.replace(/[₦,\s]/g, "");
  if (!cleaned || isNaN(Number(cleaned))) return null;
  const kobo = Math.round(Number(cleaned) * 100);
  return kobo >= 100 ? kobo : null;
}

export function DepositPaymentSheet({ onCompleted }: { onCompleted?: () => void }) {
  const { isOnline } = useConnectionQuality();
  const [amountInput, setAmountInput] = useState("");
  const [provider, setProvider] = useState<string>("auto");
  const [channel, setChannel] = useState<string>("any");
  const [initiated, setInitiated] = useState<InitiatedPayment | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);

  const { data: providersData, isLoading: providersLoading } = trpc.payments.listProviders.useQuery();
  const initializeMutation = trpc.payments.initializeDeposit.useMutation();

  const providers = providersData?.providers ?? [];

  /** Channels available for the currently-selected provider (or union for auto). */
  const availableChannels = useMemo(() => {
    const usable = providers.filter((p) => p.configured && (provider === "auto" || p.name === provider));
    const set = new Set<Channel>();
    usable.forEach((p) => p.channels.forEach((c) => set.add(c as Channel)));
    return [...set];
  }, [providers, provider]);

  const amountMinor = parseNairaToKobo(amountInput);

  const handleSubmit = async () => {
    if (!isOnline) {
      toast.error("You're offline — connect to the internet to fund your wallet.");
      return;
    }
    if (!amountMinor) {
      toast.error("Enter a valid amount (minimum ₦1.00)");
      return;
    }
    try {
      const res = await initializeMutation.mutateAsync({
        amountMinor,
        currency: "NGN",
        channel: channel === "any" ? undefined : (channel as Channel),
        provider: provider === "auto" ? undefined : provider,
        idempotencyKey: nanoid(24),
        purpose: "deposit",
        origin: window.location.origin,
      });
      const meta = (res.payment.metadata ?? {}) as {
        qrData?: string | null;
        transferAccount?: { bankName: string; accountNumber: string; accountName: string } | null;
      };
      const next: InitiatedPayment = {
        providerRef: res.payment.providerRef,
        provider: res.payment.provider,
        authorizationUrl: res.payment.authorizationUrl,
        ussdCode: res.payment.ussdCode,
        qrData: meta.qrData ?? null,
        transferAccount: meta.transferAccount ?? null,
      };
      setInitiated(next);
      if (next.qrData) {
        // Render locally — no external QR image service (works offline-ish).
        QRCode.toDataURL(next.qrData, { width: 220, margin: 1 })
          .then(setQrImage)
          .catch(() => setQrImage(null));
      }
      if (res.duplicate) toast.info("This payment was already started — resuming it.");
      else toast.success("Payment initialized");
      onCompleted?.();
    } catch (e) {
      toast.error((e as Error).message || "Could not initialize payment");
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed — long-press to copy manually");
    }
  };

  // ── Post-initialization instructions ──────────────────────────────────────
  if (initiated) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Complete Your Payment</CardTitle>
          <CardDescription>
            via {providers.find((p) => p.name === initiated.provider)?.displayName ?? initiated.provider} · Ref:{" "}
            <span className="font-mono text-xs break-all">{initiated.providerRef}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {initiated.authorizationUrl && (
            <Button className="w-full" onClick={() => window.open(initiated.authorizationUrl!, "_blank", "noopener")}>
              <ExternalLink className="mr-2 h-4 w-4" /> Open Secure Payment Page
            </Button>
          )}

          {initiated.ussdCode && (
            <div className="rounded-md border p-4 text-center">
              <p className="text-sm text-muted-foreground mb-2">Dial this code on your phone:</p>
              <p className="font-mono text-3xl font-bold tracking-wider">{initiated.ussdCode}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => copy(initiated.ussdCode!, "USSD code")}>
                <Copy className="mr-2 h-4 w-4" /> Copy Code
              </Button>
            </div>
          )}

          {qrImage && (
            <div className="rounded-md border p-4 text-center">
              <p className="text-sm text-muted-foreground mb-2">Scan with your banking app:</p>
              <img src={qrImage} alt="Payment QR code" className="mx-auto" width={220} height={220} />
            </div>
          )}

          {initiated.transferAccount && (
            <div className="rounded-md border p-4 space-y-1">
              <p className="text-sm text-muted-foreground mb-2">Transfer to this account:</p>
              <p className="font-medium">{initiated.transferAccount.bankName}</p>
              <p className="font-mono text-2xl font-bold tracking-wider">{initiated.transferAccount.accountNumber}</p>
              <p className="text-sm">{initiated.transferAccount.accountName}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => copy(initiated.transferAccount!.accountNumber, "Account number")}
              >
                <Copy className="mr-2 h-4 w-4" /> Copy Account Number
              </Button>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            After paying, you'll be redirected back automatically — or check{" "}
            <a className="underline" href={`/payment/callback?reference=${encodeURIComponent(initiated.providerRef)}&provider=${initiated.provider}`}>
              payment status
            </a>.
          </p>
          <Button variant="ghost" onClick={() => { setInitiated(null); setQrImage(null); }}>
            Start a New Payment
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Amount + rail picker ──────────────────────────────────────────────────
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fund Your Wallet</CardTitle>
        <CardDescription>Choose an amount and how you'd like to pay.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="deposit-amount">Amount (₦)</Label>
          <Input
            id="deposit-amount"
            inputMode="decimal"
            placeholder="e.g. 5,000.00"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
          />
          {amountMinor != null && (
            <p className="text-sm text-muted-foreground">₦{(amountMinor / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Payment Provider</Label>
          <Select value={provider} onValueChange={setProvider} disabled={providersLoading}>
            <SelectTrigger><SelectValue placeholder={providersLoading ? "Loading…" : "Best available"} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Best available</SelectItem>
              {providers.map((p) => (
                <SelectItem key={p.name} value={p.name} disabled={!p.configured}>
                  {p.displayName}
                  {p.sandbox ? " (TEST)" : ""}
                  {!p.configured ? " — not configured" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {providers.some((p) => p.sandbox && p.configured) && (
            <Badge variant="secondary">Sandbox mode available — no real money moves</Badge>
          )}
        </div>

        <div className="space-y-2">
          <Label>Channel</Label>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              {availableChannels.map((c) => (
                <SelectItem key={c} value={c}>{CHANNEL_LABELS[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!isOnline && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm">
            You're offline. Funding requires an internet connection.
          </p>
        )}

        <Button
          className="w-full"
          disabled={!amountMinor || !isOnline || initializeMutation.isPending}
          onClick={handleSubmit}
        >
          {initializeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Continue to Payment
        </Button>
      </CardContent>
    </Card>
  );
}

export default DepositPaymentSheet;
