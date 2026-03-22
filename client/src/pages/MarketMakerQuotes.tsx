/**
 * NEXCOM Exchange — Market Maker Self-Service Quote Snapshot & Performance Page
 * Allows market makers to record bid/ask quotes per obligation and view compliance.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TrendingUp, TrendingDown, CheckCircle2, XCircle, AlertCircle,
  ArrowLeft, RefreshCw, BarChart3, Clock, Activity, DollarSign,
} from "lucide-react";
import { toast } from "sonner";

type Obligation = {
  id: number;
  instrument: string;
  maxSpreadBps: number;
  minBidSize: string | null;
  minAskSize: string | null;
  isActive: boolean;
  createdAt: Date;
};

function ObligationQuoteCard({ obligation, onRecorded }: { obligation: Obligation; onRecorded: () => void }) {
  const [form, setForm] = useState({ bidPrice: "", askPrice: "", bidSize: "", askSize: "" });
  const [lastSnapshot, setLastSnapshot] = useState<{ isCompliant: boolean; spreadBps: number | null; breachType: string | null } | null>(null);

  const recordMutation = trpc.marketMaker.recordQuoteSnapshot.useMutation({
    onSuccess: (data) => {
      setLastSnapshot({
        isCompliant: data.isCompliant ?? false,
        spreadBps: data.spreadBps ? parseFloat(String(data.spreadBps)) : null,
        breachType: data.breachType,
      });
      if (data.isCompliant) {
        toast.success(`Quote recorded — compliant (${data.spreadBps ? parseFloat(String(data.spreadBps)).toFixed(1) : "—"} bps spread)`);
      } else {
        toast.warning(`Quote recorded — BREACH: ${data.breachType ?? "unknown"}`);
      }
      setForm({ bidPrice: "", askPrice: "", bidSize: "", askSize: "" });
      onRecorded();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.bidPrice && !form.askPrice) {
      toast.error("Enter at least a bid or ask price");
      return;
    }
    recordMutation.mutate({
      obligationId: obligation.id,
      bidPrice: form.bidPrice ? parseFloat(form.bidPrice) : undefined,
      askPrice: form.askPrice ? parseFloat(form.askPrice) : undefined,
      bidSize: form.bidSize ? parseFloat(form.bidSize) : undefined,
      askSize: form.askSize ? parseFloat(form.askSize) : undefined,
    });
  };

  const spreadBps = form.bidPrice && form.askPrice
    ? Math.round(((parseFloat(form.askPrice) - parseFloat(form.bidPrice)) / parseFloat(form.bidPrice)) * 10000)
    : null;

  return (
    <Card className="bg-slate-800/40 border-slate-700">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-white">{obligation.instrument}</CardTitle>
          <div className="flex items-center gap-2">
            {spreadBps !== null && (
              <Badge className={`text-xs ${spreadBps <= obligation.maxSpreadBps ? "bg-green-700 text-green-200" : "bg-red-700 text-red-200"}`}>
                {spreadBps} bps
              </Badge>
            )}
            <Badge className="bg-slate-700 text-slate-300 text-xs">
              Max {obligation.maxSpreadBps} bps
            </Badge>
          </div>
        </div>
        <p className="text-xs text-slate-400">
          Min Bid: {obligation.minBidSize ?? "—"} | Min Ask: {obligation.minAskSize ?? "—"}
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-slate-400 mb-1 block">Bid Price</Label>
              <Input
                type="number"
                step="0.0001"
                placeholder="0.0000"
                value={form.bidPrice}
                onChange={e => setForm(f => ({ ...f, bidPrice: e.target.value }))}
                className="bg-slate-900 border-slate-700 text-white h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-400 mb-1 block">Ask Price</Label>
              <Input
                type="number"
                step="0.0001"
                placeholder="0.0000"
                value={form.askPrice}
                onChange={e => setForm(f => ({ ...f, askPrice: e.target.value }))}
                className="bg-slate-900 border-slate-700 text-white h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-400 mb-1 block">Bid Size</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={form.bidSize}
                onChange={e => setForm(f => ({ ...f, bidSize: e.target.value }))}
                className="bg-slate-900 border-slate-700 text-white h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-400 mb-1 block">Ask Size</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={form.askSize}
                onChange={e => setForm(f => ({ ...f, askSize: e.target.value }))}
                className="bg-slate-900 border-slate-700 text-white h-8 text-sm"
              />
            </div>
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={recordMutation.isPending}
            className="w-full bg-blue-600 hover:bg-blue-500 h-8 text-xs"
          >
            {recordMutation.isPending ? (
              <RefreshCw className="w-3 h-3 animate-spin mr-1" />
            ) : (
              <Activity className="w-3 h-3 mr-1" />
            )}
            Record Quote Snapshot
          </Button>
        </form>
        {lastSnapshot && (
          <div className={`mt-3 p-2 rounded-lg flex items-center gap-2 text-xs ${lastSnapshot.isCompliant ? "bg-green-900/30 text-green-300" : "bg-red-900/30 text-red-300"}`}>
            {lastSnapshot.isCompliant
              ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
              : <XCircle className="w-3.5 h-3.5 flex-shrink-0" />}
            {lastSnapshot.isCompliant
              ? `Compliant — ${lastSnapshot.spreadBps?.toFixed(1) ?? "—"} bps spread`
              : `Breach: ${lastSnapshot.breachType ?? "unknown"}`}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function MarketMakerQuotes() {
  const [, navigate] = useLocation();
  const { data: profile, isLoading: profileLoading } = trpc.marketMaker.myProfile.useQuery();
  const { data: obligations, isLoading: oblLoading, refetch: refetchObl } = trpc.marketMaker.myObligations.useQuery(undefined, { enabled: !!profile });
  const { data: reports, isLoading: reportsLoading } = trpc.marketMaker.myPerformanceReports.useQuery({ limit: 10 }, { enabled: !!profile });

  if (profileLoading || oblLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <RefreshCw className="w-6 h-6 animate-spin text-blue-400" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-center px-6">
        <BarChart3 className="w-12 h-12 text-blue-400 mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">No Market Maker Profile</h2>
        <p className="text-slate-400 text-sm mb-6">You need an active market maker profile to record quotes.</p>
        <Button onClick={() => navigate("/market-maker-onboarding")} className="bg-blue-600 hover:bg-blue-500">
          Start Onboarding
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-10">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">Quote Snapshots</h1>
            <p className="text-xs text-slate-400">{profile.firmName} — {profile.status}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
            onClick={() => navigate("/market-maker-onboarding-dashboard")}
          >
            <ArrowLeft className="w-3 h-3 mr-1" />
            Dashboard
          </Button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Profile Status Banner */}
        {profile.status !== "ACTIVE" && (
          <div className="bg-yellow-900/30 border border-yellow-700 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-yellow-200 text-sm font-medium">Profile not active</p>
              <p className="text-yellow-400 text-xs mt-0.5">Your market maker profile status is <strong>{profile.status}</strong>. Quote recording is only available for active profiles.</p>
            </div>
          </div>
        )}

        {/* Active Obligations — Quote Recording */}
        <section>
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">Active Obligations</h2>
          {!obligations || obligations.length === 0 ? (
            <div className="bg-slate-800/30 rounded-xl border border-slate-700/50 p-8 text-center text-slate-500">
              <Activity className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No active obligations assigned.</p>
              <p className="text-xs mt-1">Contact the exchange to have obligations assigned to your profile.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {(obligations as Obligation[]).map(obl => (
                <ObligationQuoteCard
                  key={obl.id}
                  obligation={obl}
                  onRecorded={() => refetchObl()}
                />
              ))}
            </div>
          )}
        </section>

        {/* Performance Reports */}
        <section>
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">Recent Performance Reports</h2>
          {reportsLoading ? (
            <div className="p-6 text-center text-slate-500">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto" />
            </div>
          ) : !reports || reports.length === 0 ? (
            <div className="bg-slate-800/30 rounded-xl border border-slate-700/50 p-8 text-center text-slate-500">
              <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No performance reports yet.</p>
              <p className="text-xs mt-1">Reports are generated daily after market close.</p>
            </div>
          ) : (
            <div className="bg-slate-800/40 rounded-xl border border-slate-700/50 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-700/50">
                  <tr className="text-slate-400 text-xs">
                    <th className="p-3 text-left">Date</th>
                    <th className="p-3 text-left">Instrument</th>
                    <th className="p-3 text-right">Uptime %</th>
                    <th className="p-3 text-right">Avg Spread</th>
                    <th className="p-3 text-right">Breaches</th>
                    <th className="p-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.id} className="border-b border-slate-700/30 hover:bg-slate-700/20">
                      <td className="p-3 text-slate-400 text-xs">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {r.reportDate}
                        </div>
                      </td>
                      <td className="p-3 font-medium text-white">{r.instrument}</td>
                      <td className="p-3 text-right">
                        <span className={`font-medium ${parseFloat(String(r.uptimePct ?? 0)) >= 80 ? "text-green-400" : "text-red-400"}`}>
                          {parseFloat(String(r.uptimePct ?? 0)).toFixed(1)}%
                        </span>
                      </td>
                      <td className="p-3 text-right text-slate-300">
                        {r.avgSpreadBps ? `${parseFloat(String(r.avgSpreadBps)).toFixed(1)} bps` : "—"}
                      </td>
                      <td className="p-3 text-right">
                        <span className={`font-medium ${((r.totalSnapshots ?? 0) - (r.compliantSnapshots ?? 0)) > 0 ? "text-red-400" : "text-slate-400"}`}>
                    {(r.totalSnapshots ?? 0) - (r.compliantSnapshots ?? 0)}
                  </span>
                      </td>
                      <td className="p-3 text-right">
                        <Badge className={`text-xs ${r.penaltyStatus === "NONE" ? "bg-green-800 text-green-300" : r.penaltyStatus === "WARNING" ? "bg-yellow-800 text-yellow-300" : "bg-red-800 text-red-300"}`}>
                          {r.penaltyStatus ?? "NONE"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Compliance Summary */}
        {reports && reports.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">Compliance Summary</h2>
            <div className="grid grid-cols-3 gap-3">
              <Card className="bg-slate-800/40 border-slate-700">
                <CardContent className="p-4 text-center">
                  <TrendingUp className="w-5 h-5 text-green-400 mx-auto mb-1" />
                  <p className="text-xl font-bold text-white">
                    {(reports.filter(r => parseFloat(String(r.uptimePct ?? 0)) >= 80).length / reports.length * 100).toFixed(0)}%
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">Days Compliant</p>
                </CardContent>
              </Card>
              <Card className="bg-slate-800/40 border-slate-700">
                <CardContent className="p-4 text-center">
                  <DollarSign className="w-5 h-5 text-blue-400 mx-auto mb-1" />
                  <p className="text-xl font-bold text-white">
                    {reports.reduce((s, r) => s + parseFloat(String(r.avgSpreadBps ?? 0)), 0) / reports.length > 0
                      ? (reports.reduce((s, r) => s + parseFloat(String(r.avgSpreadBps ?? 0)), 0) / reports.length).toFixed(1)
                      : "—"} bps
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">Avg Spread (30d)</p>
                </CardContent>
              </Card>
              <Card className="bg-slate-800/40 border-slate-700">
                <CardContent className="p-4 text-center">
                  <TrendingDown className="w-5 h-5 text-red-400 mx-auto mb-1" />
                  <p className="text-xl font-bold text-white">
                    {reports.reduce((s, r) => s + ((r.totalSnapshots ?? 0) - (r.compliantSnapshots ?? 0)), 0)}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">Total Breaches</p>
                </CardContent>
              </Card>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
