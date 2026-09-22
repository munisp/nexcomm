/**
 * CreditPassport.tsx — INNOVATION 4: CREDIT PASSPORT (dashboard + simulator)
 * ─────────────────────────────────────────────────────────────────────────────
 * Route registration (client/src/App.tsx — do NOT edit that file here; add):
 *   const CreditPassport = lazy(() => import("./pages/CreditPassport"));
 *   <Route path="/credit-passport" component={CreditPassport} />
 *   (suggested insertion: after <Route path="/credit" … /> block)
 *
 * All numbers come from trpc.creditPassport.* API calls. The simulator output
 * is a documented server-side heuristic and is labelled ESTIMATE in the UI.
 * Cold-start and service-unavailable states are rendered honestly.
 */
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSkeleton } from "@/components/PageSkeleton";
import { toast } from "sonner";
import {
  Award, BadgeCheck, Copy, RefreshCw, ShieldCheck, Sparkles, TrendingUp, Wallet,
} from "lucide-react";

const SCORE_MIN = 300;
const SCORE_MAX = 900;

function bandClasses(band: string | null | undefined): string {
  switch (band) {
    case "prime": return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "good": return "bg-teal-500/15 text-teal-300 border-teal-500/30";
    case "fair": return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "subprime": return "bg-red-500/15 text-red-300 border-red-500/30";
    default: return "bg-white/5 text-muted-foreground border-white/10";
  }
}

/** Semicircular gauge for the 300–900 score range (SVG, no extra deps). */
function ScoreGauge({ score }: { score: number | null }) {
  const frac = score == null ? 0 : Math.min(1, Math.max(0, (score - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)));
  const angle = Math.PI * (1 - frac); // 180° → 0°
  const r = 80;
  const cx = 100;
  const cy = 95;
  const x = cx + r * Math.cos(angle);
  const y = cy - r * Math.sin(angle);
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const color =
    score == null ? "#6b7280" : score >= 750 ? "#34d399" : score >= 670 ? "#2dd4bf" : score >= 580 ? "#fbbf24" : "#f87171";
  return (
    <div className="flex flex-col items-center">
      <svg width="200" height="110" viewBox="0 0 200 110">
        <path d={arc} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="12" strokeLinecap="round" />
        {score != null && (
          <path
            d={arc}
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={Math.PI * r}
            strokeDashoffset={Math.PI * r * (1 - frac)}
          />
        )}
        {score != null && <circle cx={x} cy={y} r="6" fill={color} />}
        <text x={cx} y={cy - 12} textAnchor="middle" fill={color} fontSize="30" fontWeight="700" fontFamily="monospace">
          {score == null ? "—" : Math.round(score)}
        </text>
        <text x={cx - r} y={cy + 16} textAnchor="middle" fill="#6b7280" fontSize="10">{SCORE_MIN}</text>
        <text x={cx + r} y={cy + 16} textAnchor="middle" fill="#6b7280" fontSize="10">{SCORE_MAX}</text>
      </svg>
    </div>
  );
}

export default function CreditPassport() {
  const utils = trpc.useUtils();
  const passportQuery = trpc.creditPassport.getMyPassport.useQuery(undefined, { staleTime: 30_000 });
  const issueMutation = trpc.creditPassport.issuePassport.useMutation({
    onSuccess: () => {
      toast.success("Credit passport issued", { description: "Valid for 180 days. Share the verification code with lenders." });
      void utils.creditPassport.getMyPassport.invalidate();
    },
    onError: (err) => toast.error("Could not issue passport", { description: err.message }),
  });

  // ── simulator state (debounced query) ──────────────────────────────────────
  const [moreTxns, setMoreTxns] = useState(50);
  const [onTimeRate, setOnTimeRate] = useState(0.95);
  const [monthsHistory, setMonthsHistory] = useState(6);
  const [simInput, setSimInput] = useState({ more_txns: 50, on_time_rate: 0.95, months_history: 6 });
  const simTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (simTimer.current) clearTimeout(simTimer.current);
    simTimer.current = setTimeout(
      () => setSimInput({ more_txns: moreTxns, on_time_rate: onTimeRate, months_history: monthsHistory }),
      400
    );
    return () => { if (simTimer.current) clearTimeout(simTimer.current); };
  }, [moreTxns, onTimeRate, monthsHistory]);
  const simulateQuery = trpc.creditPassport.simulate.useQuery(simInput, { staleTime: 10_000 });

  // ── lender verification widget ─────────────────────────────────────────────
  const [verifyCode, setVerifyCode] = useState("");
  const verifyQuery = trpc.creditPassport.verifyPassport.useQuery(
    { code: verifyCode },
    { enabled: /^[0-9a-f]{64}$/.test(verifyCode) }
  );

  if (passportQuery.isLoading) {
    return <PageSkeleton />;
  }
  const data = passportQuery.data;
  const unavailable = !data || data.status !== "ok";
  const coldStart = data?.cold_start === true;
  const sim = simulateQuery.data?.status === "ok" ? simulateQuery.data : null;

  return (
    <>
      <div className="max-w-5xl mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
              <Award className="h-5 w-5 text-emerald-400" /> Credit Passport
            </h1>
            <p className="text-sm text-muted-foreground">
              Your portable, verifiable CreditNet score for lenders and counterparties.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => passportQuery.refetch()}
            className="border-white/10"
          >
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {unavailable && (
          <Card className="bg-white/5 border-white/10">
            <CardContent className="py-6 text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                Credit scoring is currently unavailable{data?.reason ? `: ${data.reason}` : "."}
              </p>
              <p className="text-xs text-muted-foreground">No score is shown — nothing is estimated or fabricated.</p>
            </CardContent>
          </Card>
        )}

        {coldStart && !unavailable && (
          <Card className="bg-amber-500/5 border-amber-500/20">
            <CardContent className="py-6 text-center space-y-2">
              <Sparkles className="h-6 w-6 mx-auto text-amber-300" />
              <p className="text-sm text-amber-200">You're in cold start — not enough platform history yet.</p>
              <p className="text-xs text-muted-foreground">
                Trade, settle on time, and build history; your score improves automatically. Use the simulator
                below to see the estimated impact.
              </p>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Score gauge */}
          <Card className="bg-white/5 border-white/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-foreground flex items-center justify-between">
                Live score
                {data?.band && (
                  <Badge className={`${bandClasses(data.band)} border uppercase text-[11px]`}>{data.band}</Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs">
                {data?.model_version ? `model ${data.model_version}` : ""}
                {data?.feature_source ? ` · basis: ${data.feature_source}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScoreGauge score={data?.score ?? null} />
              {data?.default_probability != null && (
                <p className="text-center text-xs text-muted-foreground mt-1">
                  estimated default probability{" "}
                  <span className="font-mono text-foreground">{(data.default_probability * 100).toFixed(1)}%</span>
                </p>
              )}
            </CardContent>
          </Card>

          {/* Passport card */}
          <Card className="bg-white/5 border-white/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-foreground flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400" /> Issued passport
              </CardTitle>
              <CardDescription className="text-xs">Snapshot shared with lenders via verification code.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data?.passport ? (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Score at issuance</span>
                    <span className="font-mono text-foreground">{data.passport.score}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Band</span>
                    <Badge className={`${bandClasses(data.passport.band)} border uppercase text-[11px]`}>
                      {data.passport.band}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Validity</span>
                    <span className={data.passport_valid ? "text-emerald-300" : "text-red-300"}>
                      {data.passport_valid
                        ? `until ${new Date(data.passport.expiresAt).toLocaleDateString()}`
                        : "expired"}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Verification code</Label>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        value={data.passport.verificationCode}
                        className="bg-white/5 border-white/10 font-mono text-xs text-white"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="border-white/10 shrink-0"
                        onClick={() => {
                          void navigator.clipboard.writeText(data.passport!.verificationCode);
                          toast.success("Verification code copied");
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No passport issued yet.</p>
              )}
              <Button
                onClick={() => issueMutation.mutate()}
                disabled={issueMutation.isPending || unavailable}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                <BadgeCheck className="h-4 w-4 mr-2" />
                {issueMutation.isPending
                  ? "Issuing…"
                  : data?.passport
                    ? "Renew passport (fresh score)"
                    : "Issue my passport"}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Improvement simulator */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-teal-300" /> Improvement simulator
              <Badge className="bg-amber-500/10 text-amber-300 border-amber-500/30 border text-[10px] uppercase">
                Estimate
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              Heuristic projection, not a model re-run. Mirrors the training-target drivers:
              activity, settlement discipline, tenure.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-5">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <Label className="text-muted-foreground">Additional settled trades</Label>
                  <span className="font-mono text-foreground">{moreTxns}</span>
                </div>
                <Slider value={[moreTxns]} onValueChange={([v]) => setMoreTxns(v)} min={0} max={500} step={10} />
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <Label className="text-muted-foreground">On-time settlement rate</Label>
                  <span className="font-mono text-foreground">{(onTimeRate * 100).toFixed(0)}%</span>
                </div>
                <Slider value={[onTimeRate * 100]} onValueChange={([v]) => setOnTimeRate(v / 100)} min={50} max={100} step={1} />
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <Label className="text-muted-foreground">Additional months of history</Label>
                  <span className="font-mono text-foreground">{monthsHistory}</span>
                </div>
                <Slider value={[monthsHistory]} onValueChange={([v]) => setMonthsHistory(v)} min={0} max={36} step={1} />
              </div>
            </div>
            <div className="space-y-3">
              {sim ? (
                <>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-muted-foreground">
                      Base ({sim.base_source === "live" ? "live score" : "issued passport"})
                    </span>
                    <span className="font-mono text-foreground">{Math.round(sim.base_score)}</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-muted-foreground">Projected</span>
                    <span className="font-mono text-2xl text-emerald-300">{Math.round(sim.projected_score)}</span>
                  </div>
                  <div className="space-y-1 text-xs">
                    {(["activity", "settlement", "tenure"] as const).map((k) => (
                      <div key={k} className="flex justify-between">
                        <span className="text-muted-foreground capitalize">{k} contribution</span>
                        <span className={`font-mono ${sim.components[k] >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                          {sim.components[k] >= 0 ? "+" : ""}{sim.components[k].toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground pt-1">{sim.heuristic}</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {simulateQuery.data?.status === "unavailable"
                    ? simulateQuery.data.reason
                    : "Move the sliders to project your score."}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Lender verification */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-foreground flex items-center gap-2">
              <Wallet className="h-4 w-4 text-teal-300" /> Verify a passport (lender view)
            </CardTitle>
            <CardDescription className="text-xs">Paste a 64-character verification code.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value.trim())}
              placeholder="sha256 verification code"
              className="bg-white/5 border-white/10 font-mono text-xs text-white"
            />
            {verifyCode && !/^[0-9a-f]{64}$/.test(verifyCode) && (
              <p className="text-xs text-muted-foreground">Enter the full 64-hex-character code.</p>
            )}
            {verifyQuery.data && (
              <div className="flex items-center gap-2 text-sm">
                {verifyQuery.data.valid ? (
                  <>
                    <BadgeCheck className="h-4 w-4 text-emerald-400" />
                    <span className="text-emerald-300">
                      Valid passport · band{" "}
                      <span className="uppercase font-mono">{verifyQuery.data.band}</span> · issued{" "}
                      {new Date(verifyQuery.data.issuedAt!).toLocaleDateString()}
                    </span>
                  </>
                ) : (
                  <span className="text-red-300">
                    {verifyQuery.data.expired ? "Passport expired." : "No passport matches this code."}
                  </span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
