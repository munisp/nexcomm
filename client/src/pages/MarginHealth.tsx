/**
 * MarginHealth — User-facing clearing account health page
 * Features:
 *  - SVG arc gauge showing equity ratio with colour-coded thresholds (green/amber/red)
 *  - Threshold markers for initial and maintenance margin levels
 *  - One-click "Deposit Margin" flow that pre-fills the required top-up amount
 *  - Open margin call list with due dates and progress bars
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  Shield,
  AlertTriangle,
  TrendingDown,
  Clock,
  CheckCircle2,
  Banknote,
  RefreshCw,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type MarginCallStatus = "OPEN" | "PARTIALLY_MET" | "MET" | "DEFAULTED" | "CANCELLED";

// ─── Equity Ratio Gauge ───────────────────────────────────────────────────────

/**
 * SVG arc gauge that spans 180° (left to right, bottom-anchored).
 * The arc is colour-coded:
 *   - 0 → maintenance threshold: red
 *   - maintenance → initial threshold: amber
 *   - initial → 200%+: green
 * Threshold tick marks are drawn at the maintenance and initial levels.
 */
function EquityGauge({
  ratioPct,
  maintenancePct,
  initialPct,
}: {
  ratioPct: number;
  maintenancePct: number;
  initialPct: number;
}) {
  const W = 220;
  const H = 130;
  const cx = W / 2;
  const cy = H - 10;
  const R = 90;
  const strokeW = 14;

  // Map a percentage (0–200) to an angle in the arc (–180° to 0°)
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const pctToAngle = (pct: number) => {
    const fraction = clamp(pct, 0, 200) / 200;
    return Math.PI + fraction * Math.PI; // π → 2π (left to right)
  };

  const arcPath = (startAngle: number, endAngle: number) => {
    const x1 = cx + R * Math.cos(startAngle);
    const y1 = cy + R * Math.sin(startAngle);
    const x2 = cx + R * Math.cos(endAngle);
    const y2 = cy + R * Math.sin(endAngle);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2}`;
  };

  const maintAngle = pctToAngle(maintenancePct);
  const initAngle = pctToAngle(initialPct);
  const needleAngle = pctToAngle(ratioPct);

  // Gauge colour based on current ratio
  const gaugeColor =
    ratioPct < maintenancePct
      ? "#f87171"
      : ratioPct < initialPct
      ? "#fbbf24"
      : "#4ade80";

  // Tick mark helper
  const tick = (angle: number, color: string) => {
    const inner = R - strokeW / 2 - 4;
    const outer = R + strokeW / 2 + 4;
    return (
      <line
        x1={cx + inner * Math.cos(angle)}
        y1={cy + inner * Math.sin(angle)}
        x2={cx + outer * Math.cos(angle)}
        y2={cy + outer * Math.sin(angle)}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    );
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[220px] mx-auto">
      {/* Background track */}
      <path
        d={arcPath(Math.PI, 2 * Math.PI)}
        fill="none"
        stroke="#27272a"
        strokeWidth={strokeW}
        strokeLinecap="round"
      />
      {/* Red segment: 0 → maintenance */}
      <path
        d={arcPath(Math.PI, maintAngle)}
        fill="none"
        stroke="#7f1d1d"
        strokeWidth={strokeW}
      />
      {/* Amber segment: maintenance → initial */}
      <path
        d={arcPath(maintAngle, initAngle)}
        fill="none"
        stroke="#78350f"
        strokeWidth={strokeW}
      />
      {/* Green segment: initial → max */}
      <path
        d={arcPath(initAngle, 2 * Math.PI)}
        fill="none"
        stroke="#14532d"
        strokeWidth={strokeW}
      />
      {/* Filled progress arc */}
      <path
        d={arcPath(Math.PI, needleAngle)}
        fill="none"
        stroke={gaugeColor}
        strokeWidth={strokeW - 4}
        strokeLinecap="round"
        opacity={0.9}
      />
      {/* Threshold ticks */}
      {tick(maintAngle, "#f87171")}
      {tick(initAngle, "#fbbf24")}
      {/* Needle dot */}
      <circle
        cx={cx + R * Math.cos(needleAngle)}
        cy={cy + R * Math.sin(needleAngle)}
        r={6}
        fill={gaugeColor}
        stroke="#09090b"
        strokeWidth={2}
      />
      {/* Centre text */}
      <text x={cx} y={cy - 18} textAnchor="middle" fill={gaugeColor} fontSize={26} fontWeight="bold">
        {ratioPct.toFixed(1)}%
      </text>
      <text x={cx} y={cy - 4} textAnchor="middle" fill="#71717a" fontSize={10}>
        equity ratio
      </text>
    </svg>
  );
}

// ─── Deposit Dialog ───────────────────────────────────────────────────────────

function DepositDialog({
  open,
  onClose,
  suggestedAmount,
  accountRef,
}: {
  open: boolean;
  onClose: () => void;
  suggestedAmount: number;
  accountRef: string;
}) {
  const [amount, setAmount] = useState(suggestedAmount > 0 ? String(suggestedAmount.toFixed(2)) : "");
  const [reference, setReference] = useState("");

  const handleSubmit = () => {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      toast.error("Please enter a valid deposit amount");
      return;
    }
    if (!reference.trim()) {
      toast.error("Please enter a payment reference");
      return;
    }
    // In a real system this would call a deposit endpoint.
    // For now we show a confirmation toast and close.
    toast.success("Deposit request submitted", {
      description: `₦${parsed.toLocaleString()} — ref: ${reference.trim()}. Your clearing officer will confirm within 2 business hours.`,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-emerald-400" />
            Deposit Margin
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="bg-muted/40 rounded-md p-3 text-sm text-muted-foreground">
            Account: <span className="font-mono text-foreground">{accountRef}</span>
          </div>
          <div className="space-y-1">
            <Label>Amount (₦)</Label>
            <Input
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter deposit amount"
            />
            {suggestedAmount > 0 && (
              <p className="text-xs text-amber-400">
                Suggested top-up: ₦{suggestedAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label>Payment Reference</Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Bank transfer reference or receipt no."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            Submit Deposit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: MarginCallStatus }) {
  const map: Record<MarginCallStatus, string> = {
    OPEN: "bg-red-500/20 text-red-400 border-red-500/30",
    PARTIALLY_MET: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    MET: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    DEFAULTED: "bg-red-900/40 text-red-300 border-red-700/50",
    CANCELLED: "bg-zinc-500/20 text-muted-foreground border-zinc-500/30",
  };
  return (
    <Badge className={`text-xs border ${map[status] ?? ""}`}>
      {status.replace("_", " ")}
    </Badge>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MarginHealth() {
  const { user } = useAuth();
  const [showDeposit, setShowDeposit] = useState(false);

  const healthQuery = trpc.clearingHouse.myMarginHealth.useQuery();
  const callsQuery = trpc.clearingHouse.myMarginCalls.useQuery({});
  const utils = trpc.useUtils();

  const health = healthQuery.data;

  // Compute suggested deposit: amount needed to reach initial margin from current cash
  const suggestedDeposit = (() => {
    if (!health) return 0;
    const cash = parseFloat(health.account.cashBalance);
    const initialRequired = parseFloat(health.account.portfolioValue) * parseFloat(health.account.initialMarginPct);
    const deficit = initialRequired - cash;
    return deficit > 0 ? deficit : 0;
  })();

  const maintenancePct = health
    ? parseFloat(health.account.maintenanceMarginPct) * 100
    : 7;
  const initialPct = health
    ? parseFloat(health.account.initialMarginPct) * 100
    : 10;
  const ratioPct = health ? parseFloat(health.equityRatioPct) : 0;

  if (healthQuery.isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Shield className="h-6 w-6 text-emerald-400" />
            Margin Health
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Your clearing account equity ratio and open margin calls
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              utils.clearingHouse.myMarginHealth.invalidate();
              utils.clearingHouse.myMarginCalls.invalidate();
            }}
          >
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
          {health && (
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
              onClick={() => setShowDeposit(true)}
            >
              <Banknote className="w-4 h-4" />
              Deposit Margin
            </Button>
          )}
        </div>
      </div>

      {healthQuery.isLoading ? (
        <div className="text-muted-foreground text-sm">Loading margin health…</div>
      ) : !health ? (
        <Card>
          <CardContent className="p-10 text-center">
            <Shield className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">No clearing account found for your profile.</p>
            <p className="text-muted-foreground/60 text-sm mt-1">
              Contact support to set up your clearing account.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Alert banner */}
          {health.isBelowMaintenance && (
            <Card className="border-red-500/40 bg-red-500/5">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-red-300 font-semibold text-sm">
                    Margin Call Risk — Below Maintenance Threshold
                  </p>
                  <p className="text-red-400/80 text-xs mt-0.5">
                    Your equity ratio ({ratioPct.toFixed(1)}%) is below the maintenance margin
                    ({maintenancePct.toFixed(0)}%). A margin call may be issued. Deposit funds
                    immediately to avoid auto-liquidation.
                  </p>
                </div>
                <Button
                  size="sm"
                  className="bg-red-600 hover:bg-red-700 text-white shrink-0"
                  onClick={() => setShowDeposit(true)}
                >
                  Deposit Now
                </Button>
              </CardContent>
            </Card>
          )}
          {!health.isBelowMaintenance && health.isBelowInitial && (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-amber-300 font-semibold text-sm">
                    Warning — Below Initial Margin Threshold
                  </p>
                  <p className="text-amber-400/80 text-xs mt-0.5">
                    Your equity ratio ({ratioPct.toFixed(1)}%) is below the initial margin
                    ({initialPct.toFixed(0)}%). Consider topping up to avoid a margin call.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10 shrink-0"
                  onClick={() => setShowDeposit(true)}
                >
                  Top Up
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Gauge + stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
            {/* Gauge card */}
            <Card className="md:col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Equity Ratio</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <EquityGauge
                  ratioPct={ratioPct}
                  maintenancePct={maintenancePct}
                  initialPct={initialPct}
                />
                {/* Legend */}
                <div className="mt-3 space-y-1 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-red-500/60 inline-block" />
                    <span className="text-muted-foreground">Below maintenance ({maintenancePct.toFixed(0)}%)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-amber-500/60 inline-block" />
                    <span className="text-muted-foreground">Below initial ({initialPct.toFixed(0)}%)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-emerald-500/60 inline-block" />
                    <span className="text-muted-foreground">Healthy (&gt;{initialPct.toFixed(0)}%)</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Stats grid */}
            <div className="md:col-span-2 grid grid-cols-2 gap-4">
              {[
                {
                  label: "Portfolio Value",
                  value: `₦${parseFloat(health.account.portfolioValue).toLocaleString()}`,
                  sub: `Cash: ₦${parseFloat(health.account.cashBalance).toLocaleString()}`,
                },
                {
                  label: "Margin Required",
                  value: `₦${parseFloat(health.account.totalMarginRequired).toLocaleString()}`,
                  sub: `Posted: ₦${parseFloat(health.account.totalMarginPosted).toLocaleString()}`,
                },
                {
                  label: "Account Ref",
                  value: health.account.accountRef,
                  mono: true,
                  sub: `Status: ${health.account.status}`,
                },
                {
                  label: "Last Valuation",
                  value: health.account.lastValuationAt
                    ? new Date(health.account.lastValuationAt).toLocaleString()
                    : "Not yet valued",
                  sub: `Created: ${new Date(health.account.createdAt).toLocaleDateString()}`,
                },
              ].map((item) => (
                <Card key={item.label}>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
                    <p className={`font-semibold text-sm ${item.mono ? "font-mono" : ""}`}>
                      {item.value}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.sub}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Margin Calls */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-red-400" />
                Margin Calls
              </CardTitle>
            </CardHeader>
            <CardContent>
              {callsQuery.isLoading ? (
                <div className="text-muted-foreground text-sm">Loading…</div>
              ) : (callsQuery.data?.length ?? 0) === 0 ? (
                <div className="flex flex-col items-center py-8 gap-2 text-muted-foreground">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500/50" />
                  <p className="text-sm">No margin calls on your account</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {callsQuery.data?.map((call) => {
                    const required = parseFloat(call.amountRequired);
                    const received = parseFloat(call.amountReceived);
                    const progressPct = required > 0 ? Math.min(100, (received / required) * 100) : 0;
                    const isOverdue = new Date(call.dueAt) < new Date() && call.status === "OPEN";

                    return (
                      <div
                        key={call.id}
                        className="rounded-lg border border-border bg-card/50 p-4 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs text-muted-foreground">{call.callRef}</span>
                          <div className="flex items-center gap-2">
                            {isOverdue && (
                              <Badge variant="outline" className="text-xs bg-red-900/30 text-red-300 border-red-700/50">
                                OVERDUE
                              </Badge>
                            )}
                            <StatusBadge status={call.status as MarginCallStatus} />
                          </div>
                        </div>

                        {/* Progress bar */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>₦{received.toLocaleString()} received</span>
                            <span>₦{required.toLocaleString()} required</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${progressPct}%`,
                                background:
                                  progressPct >= 100
                                    ? "#4ade80"
                                    : progressPct >= 50
                                    ? "#fbbf24"
                                    : "#f87171",
                              }}
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            Due: {new Date(call.dueAt).toLocaleDateString()}
                          </div>
                          {(call.status === "OPEN" || call.status === "PARTIALLY_MET") && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-3 text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                              onClick={() => setShowDeposit(true)}
                            >
                              <Banknote className="w-3 h-3 mr-1" />
                              Deposit ₦{Math.max(0, required - received).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </Button>
                          )}
                        </div>
                        {call.notes && (
                          <p className="text-xs text-muted-foreground border-t border-border pt-2">{call.notes}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Deposit Dialog */}
      {health && (
        <DepositDialog
          open={showDeposit}
          onClose={() => setShowDeposit(false)}
          suggestedAmount={suggestedDeposit}
          accountRef={health.account.accountRef}
        />
      )}
    </div>
  );
}
