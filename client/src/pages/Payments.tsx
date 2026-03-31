/**
 * Payments.tsx — Stripe fiat on-ramp for NEXCOM Exchange
 *
 * Features:
 *  - Deposit via Stripe Checkout (card)
 *  - Payment history table
 *  - Success / canceled redirect handling
 */
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  CreditCard,
  DollarSign,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  ArrowDownCircle,
} from "lucide-react";

const DEPOSIT_AMOUNTS = [50, 100, 250, 500, 1000, 2500, 5000];

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
  PENDING:   { label: "Pending",   variant: "secondary",    icon: <Clock className="w-3 h-3" /> },
  SUCCEEDED: { label: "Succeeded", variant: "default",      icon: <CheckCircle2 className="w-3 h-3" /> },
  FAILED:    { label: "Failed",    variant: "destructive",  icon: <XCircle className="w-3 h-3" /> },
  CANCELED:  { label: "Canceled",  variant: "outline",      icon: <XCircle className="w-3 h-3" /> },
  REFUNDED:  { label: "Refunded",  variant: "secondary",    icon: <RefreshCw className="w-3 h-3" /> },
};

export default function Payments() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedAmount, setSelectedAmount] = useState<number>(100);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Handle redirect back from Stripe Checkout
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    if (status === "success") {
      toast.success("Payment successful! Your wallet will be credited shortly.");
      // Clean up URL
      window.history.replaceState({}, "", "/payments");
    } else if (status === "canceled") {
      toast.info("Payment canceled. No charge was made.");
      window.history.replaceState({}, "", "/payments");
    }
  }, []);

  const { data: paymentsData, isLoading: paymentsLoading, refetch } =
    trpc.stripe.listPayments.useQuery({ limit: 20, offset: 0 });

  const createSessionMutation = trpc.stripe.createDepositSession.useMutation({
    onSuccess: (data) => {
      toast.info("Redirecting to Stripe Checkout...");
      window.open(data.checkoutUrl, "_blank");
      setIsRedirecting(false);
    },
    onError: (err) => {
      toast.error(`Payment failed: ${err.message}`);
      setIsRedirecting(false);
    },
  });

  const handleDeposit = () => {
    if (!user) {
      toast.error("Please log in to make a deposit.");
      return;
    }
    const amount = customAmount ? parseFloat(customAmount) : selectedAmount;
    if (!amount || amount < 0.5) {
      toast.error("Minimum deposit is $0.50 USD.");
      return;
    }
    setIsRedirecting(true);
    createSessionMutation.mutate({
      amountUsd: amount,
      origin: window.location.origin,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container max-w-2xl py-16 text-center">
        <CreditCard className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
        <h2 className="text-2xl font-semibold mb-2">Sign in to access Payments</h2>
        <p className="text-muted-foreground mb-6">
          Fund your NEXCOM trading wallet with a card payment via Stripe.
        </p>
        <Button onClick={() => setLocation("/")}>Go to Home</Button>
      </div>
    );
  }

  const finalAmount = customAmount ? parseFloat(customAmount) : selectedAmount;

  return (
    <div className="container max-w-4xl py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Payments</h1>
        <p className="text-muted-foreground mt-1">
          Fund your NEXCOM wallet via Stripe. Deposits are credited in NGN at the prevailing exchange rate.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Deposit Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowDownCircle className="w-5 h-5 text-green-500" />
              Deposit Funds
            </CardTitle>
            <CardDescription>
              Select an amount and pay securely via Stripe. Test card: 4242 4242 4242 4242
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Preset amounts */}
            <div>
              <label className="text-sm font-medium mb-2 block">Select Amount (USD)</label>
              <div className="grid grid-cols-4 gap-2">
                {DEPOSIT_AMOUNTS.map((amt) => (
                  <button
                    key={amt}
                    onClick={() => { setSelectedAmount(amt); setCustomAmount(""); }}
                    className={`rounded-md border px-2 py-2 text-sm font-medium transition-colors ${
                      selectedAmount === amt && !customAmount
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    ${amt}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom amount */}
            <div>
              <label className="text-sm font-medium mb-1 block">Or enter custom amount</label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="number"
                  min="0.50"
                  step="0.01"
                  placeholder="0.00"
                  value={customAmount}
                  onChange={(e) => { setCustomAmount(e.target.value); setSelectedAmount(0); }}
                  className="w-full pl-9 pr-4 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                />
              </div>
            </div>

            <Separator />

            {/* Summary */}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">You pay</span>
              <span className="font-semibold">
                ${(finalAmount || 0).toFixed(2)} USD
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">You receive (est.)</span>
              <span className="font-semibold text-green-600">
                ₦{((finalAmount || 0) * 1600).toLocaleString()} NGN
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Rate: $1 USD ≈ ₦1,600 NGN (indicative, subject to change)
            </p>

            <Button
              className="w-full"
              onClick={handleDeposit}
              disabled={isRedirecting || createSessionMutation.isPending || !finalAmount || finalAmount < 0.5}
            >
              {isRedirecting || createSessionMutation.isPending ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Redirecting...</>
              ) : (
                <><CreditCard className="w-4 h-4 mr-2" /> Pay with Stripe</>
              )}
            </Button>

            <p className="text-xs text-center text-muted-foreground">
              Secured by{" "}
              <a
                href="https://stripe.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Stripe
              </a>
              . Your card details are never stored on our servers.
            </p>
          </CardContent>
        </Card>

        {/* Info Card */}
        <Card>
          <CardHeader>
            <CardTitle>How it works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">1</span>
              <p>Select your deposit amount in USD and click <strong className="text-foreground">Pay with Stripe</strong>.</p>
            </div>
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">2</span>
              <p>A secure Stripe Checkout page opens in a new tab. Enter your card details there.</p>
            </div>
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">3</span>
              <p>After successful payment, your NEXCOM wallet is credited in NGN within seconds via our webhook.</p>
            </div>
            <Separator />
            <div className="space-y-1">
              <p className="font-medium text-foreground">Test card details</p>
              <p>Card number: <code className="bg-muted px-1 rounded">4242 4242 4242 4242</code></p>
              <p>Expiry: any future date &nbsp;|&nbsp; CVC: any 3 digits</p>
            </div>
            <Separator />
            <div className="space-y-1">
              <p className="font-medium text-foreground">Supported methods</p>
              <p>Visa, Mastercard, American Express, and all Stripe-supported cards.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Payment History */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Payment History</CardTitle>
            <CardDescription>Your recent Stripe deposits</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {paymentsLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !paymentsData?.payments?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <CreditCard className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>No payments yet. Make your first deposit above.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Date</th>
                    <th className="text-left py-2 pr-4 font-medium">Type</th>
                    <th className="text-right py-2 pr-4 font-medium">Amount (USD)</th>
                    <th className="text-right py-2 pr-4 font-medium">Amount (NGN)</th>
                    <th className="text-left py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentsData.payments.map((p) => {
                    const cfg = statusConfig[p.status] ?? statusConfig.PENDING;
                    const usd = (p.amountCents / 100).toFixed(2);
                    const ngn = (p.amountCents * 16).toLocaleString(); // cents * 16 = kobo / 100 * 1600
                    return (
                      <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="py-3 pr-4 text-muted-foreground">
                          {new Date(p.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-3 pr-4 capitalize">{p.type.toLowerCase()}</td>
                        <td className="py-3 pr-4 text-right font-mono">${usd}</td>
                        <td className="py-3 pr-4 text-right font-mono text-green-600">₦{ngn}</td>
                        <td className="py-3">
                          <Badge variant={cfg.variant} className="flex items-center gap-1 w-fit">
                            {cfg.icon}
                            {cfg.label}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
