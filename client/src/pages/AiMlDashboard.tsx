/**
 * NEXCOM Exchange — AI/ML Analytics Dashboard
 * Uses aiMlRouter: health, getRiskScore, getForecast, getForecastModels,
 * getSentiment, getSentimentSummary, getNewsSentiment, getRecentAnomalies,
 * getAnomaliesForSymbol, getAnomalyStats, configureAnomalyDetection, batchRiskScore.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Brain, TrendingUp, AlertTriangle, Activity, RefreshCw, Eye, BarChart2 } from "lucide-react";
import CommodityCorrelationGraph from "@/components/CommodityCorrelationGraph";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ONLINE: "bg-green-500/10 text-green-400 border-green-500/30",
    OFFLINE: "bg-red-500/10 text-red-400 border-red-500/30",
    HIGH: "bg-red-500/10 text-red-400 border-red-500/30",
    MEDIUM: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
    LOW: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    BULLISH: "bg-green-500/10 text-green-400 border-green-500/30",
    BEARISH: "bg-red-500/10 text-red-400 border-red-500/30",
    NEUTRAL: "bg-muted/50 text-muted-foreground border-border",
  };
  return <Badge variant="outline" className={map[status] ?? "bg-muted/50 text-muted-foreground"}>{status}</Badge>;
}

export default function AiMlDashboard() {
  const { user } = useAuth();
  const [forecastSymbol, setForecastSymbol] = useState("MAIZE");
  const [forecastHorizon, setForecastHorizon] = useState(7);
  const [forecastModel, setForecastModel] = useState<"ARIMA" | "LSTM" | "PROPHET" | "ENSEMBLE">("ENSEMBLE");
  const [anomalySymbol, setAnomalySymbol] = useState("MAIZE");
  const [sentimentSymbol, setSentimentSymbol] = useState("MAIZE");

  const { data: health } = trpc.aiMl.health.useQuery(undefined, { refetchInterval: 15000 });
  const { data: forecast, refetch: refetchForecast } = trpc.aiMl.getForecast.useQuery(
    { symbol: forecastSymbol, horizon: forecastHorizon, model: forecastModel },
    { refetchInterval: 300000 }
  );
  const { data: forecastModels } = trpc.aiMl.getForecastModels.useQuery(undefined, { refetchInterval: 600000 });
  const { data: anomalies, refetch: refetchAnomalies } = trpc.aiMl.getAnomaliesForSymbol.useQuery(
    { symbol: anomalySymbol },
    { refetchInterval: 60000 }
  );
  const { data: anomalyStats } = trpc.aiMl.getAnomalyStats.useQuery(undefined, { refetchInterval: 60000 });
  const { data: sentiment } = trpc.aiMl.getSentiment.useQuery({ symbol: sentimentSymbol }, { refetchInterval: 60000 });
  const { data: sentimentSummary } = trpc.aiMl.getSentimentSummary.useQuery(undefined, { refetchInterval: 60000 });
  const { data: riskScore } = trpc.aiMl.getRiskScore.useQuery(
    { accountId: String(user?.id ?? 0) },
    { enabled: !!user, refetchInterval: 60000 }
  );

  const configMutation = trpc.aiMl.configureAnomalyDetection.useMutation({
    onSuccess: () => toast.success("Anomaly detection configuration updated"),
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const forecastData = forecast as { forecasts?: Record<string, unknown>[]; predictions?: Record<string, unknown>[]; error?: string } | undefined;
  const anomaliesArr = Array.isArray((anomalies as { anomalies?: unknown[] })?.anomalies) ? (anomalies as { anomalies: Record<string, unknown>[] }).anomalies : [];
  const statsData = anomalyStats as { total?: number; by_severity?: Record<string, number>; error?: string } | undefined;
  const sentimentData = sentiment as { sentiment?: string; score?: number; symbol?: string; error?: string } | undefined;
  const summaryData = sentimentSummary as { sentiments?: Record<string, unknown>[]; error?: string } | undefined;
  const riskData = riskScore as { risk_score?: number; risk_level?: string; error?: string } | undefined;
  const modelsArr = Array.isArray(forecastModels) ? forecastModels : ["ARIMA", "LSTM", "PROPHET", "ENSEMBLE"];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Brain className="w-6 h-6 text-purple-400" />
            AI/ML Analytics
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Anomaly detection, price forecasting, sentiment analysis, and risk scoring</p>
        </div>
        <StatusBadge status={health?.online ? "ONLINE" : "OFFLINE"} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border"><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Risk Score</p><p className="text-2xl font-bold text-foreground">{riskData?.risk_score != null ? `${(riskData.risk_score * 100).toFixed(0)}%` : "—"}</p></div><Brain className="w-8 h-8 text-purple-400 opacity-60" /></div></CardContent></Card>
        <Card className="bg-card border-border"><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Anomalies (Total)</p><p className="text-2xl font-bold text-red-400">{statsData?.total ?? anomaliesArr.length}</p></div><AlertTriangle className="w-8 h-8 text-red-400 opacity-60" /></div></CardContent></Card>
        <Card className="bg-card border-border"><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Sentiment</p><p className="text-2xl font-bold text-foreground">{sentimentData?.sentiment ?? "—"}</p></div><Eye className="w-8 h-8 text-blue-400 opacity-60" /></div></CardContent></Card>
        <Card className="bg-card border-border"><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Available Models</p><p className="text-2xl font-bold text-foreground">{modelsArr.length}</p></div><Activity className="w-8 h-8 text-green-400 opacity-60" /></div></CardContent></Card>
      </div>

      <Tabs defaultValue="forecast">
        <TabsList className="bg-muted/30">
          <TabsTrigger value="forecast">Price Forecast</TabsTrigger>
          <TabsTrigger value="anomalies">Anomaly Detection</TabsTrigger>
          <TabsTrigger value="sentiment">Market Sentiment</TabsTrigger>
          <TabsTrigger value="risk">Risk Scoring</TabsTrigger>
          <TabsTrigger value="correlation">GNN Correlation</TabsTrigger>
        </TabsList>

        <TabsContent value="forecast" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="bg-card border-border">
              <CardHeader><CardTitle className="text-base">Forecast Parameters</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div><Label className="text-xs text-muted-foreground">Symbol</Label><Input value={forecastSymbol} onChange={(e) => setForecastSymbol(e.target.value.toUpperCase())} className="mt-1" /></div>
                <div>
                  <Label className="text-xs text-muted-foreground">Horizon (days)</Label>
                  <Select value={String(forecastHorizon)} onValueChange={(v) => setForecastHorizon(parseInt(v))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 day</SelectItem>
                      <SelectItem value="7">7 days</SelectItem>
                      <SelectItem value="14">14 days</SelectItem>
                      <SelectItem value="30">30 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Model</Label>
                  <Select value={forecastModel} onValueChange={(v) => setForecastModel(v as typeof forecastModel)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {modelsArr.map((m) => <SelectItem key={String(m)} value={String(m)}>{String(m)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button className="w-full" onClick={() => refetchForecast()}>
                  <TrendingUp className="w-4 h-4 mr-2" /> Generate Forecast
                </Button>
              </CardContent>
            </Card>
            <Card className="bg-card border-border lg:col-span-2">
              <CardHeader><CardTitle className="text-base">{forecastSymbol} — {forecastHorizon}-Day Forecast ({forecastModel})</CardTitle></CardHeader>
              <CardContent>
                {!forecast ? <p className="text-center text-muted-foreground py-8">{health?.online ? "Loading forecast..." : "AI/ML service offline"}</p> : (
                  forecastData?.error ? (
                    <p className="text-center text-muted-foreground py-8">{forecastData.error}</p>
                  ) : Array.isArray(forecastData?.forecasts) && forecastData.forecasts.length > 0 ? (
                    <Table>
                      <TableHeader><TableRow><TableHead>Date</TableHead><TableHead className="text-right">Predicted Price</TableHead><TableHead className="text-right">Lower Bound</TableHead><TableHead className="text-right">Upper Bound</TableHead><TableHead className="text-right">Confidence</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {forecastData.forecasts.map((p, i) => (
                          <TableRow key={i}>
                            <TableCell>{String(p.date ?? "")}</TableCell>
                            <TableCell className="text-right font-semibold">₦{Number(p.price ?? p.predicted ?? 0).toLocaleString()}</TableCell>
                            <TableCell className="text-right text-muted-foreground">₦{Number(p.lower ?? 0).toLocaleString()}</TableCell>
                            <TableCell className="text-right text-muted-foreground">₦{Number(p.upper ?? 0).toLocaleString()}</TableCell>
                            <TableCell className="text-right">{(Number(p.confidence ?? 0) * 100).toFixed(1)}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <pre className="text-xs text-muted-foreground overflow-auto max-h-64 bg-muted/20 p-3 rounded">{JSON.stringify(forecast, null, 2)}</pre>
                  )
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="anomalies" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div><CardTitle className="text-base">Anomaly Detection</CardTitle><CardDescription>Statistical outliers and unusual trading patterns</CardDescription></div>
                <div className="flex items-center gap-2">
                  <Input value={anomalySymbol} onChange={(e) => setAnomalySymbol(e.target.value.toUpperCase())} placeholder="Symbol" className="w-28" />
                  <Button variant="outline" size="sm" onClick={() => refetchAnomalies()}><RefreshCw className="w-4 h-4" /></Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {statsData && (
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {Object.entries(statsData.by_severity ?? {}).map(([sev, count]) => (
                    <div key={sev} className="p-2 rounded bg-muted/20 border border-border text-center">
                      <p className="text-xs text-muted-foreground">{sev}</p>
                      <p className="font-bold text-foreground">{count}</p>
                    </div>
                  ))}
                </div>
              )}
              {anomaliesArr.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">{health?.online ? "No anomalies detected for " + anomalySymbol : "AI/ML service offline"}</p>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Type</TableHead><TableHead className="text-right">Score</TableHead><TableHead>Severity</TableHead><TableHead>Description</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {anomaliesArr.map((a, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-semibold">{String(a.type ?? "")}</TableCell>
                        <TableCell className="text-right font-mono">{Number(a.score ?? 0).toFixed(4)}</TableCell>
                        <TableCell><StatusBadge status={String(a.severity ?? "MEDIUM")} /></TableCell>
                        <TableCell className="text-muted-foreground text-sm">{String(a.description ?? "")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <div className="mt-4 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => configMutation.mutate({ symbol: anomalySymbol, sensitivity: "HIGH" })} disabled={configMutation.isPending}>
                  Set High Sensitivity
                </Button>
                <Button variant="outline" size="sm" onClick={() => configMutation.mutate({ symbol: anomalySymbol, sensitivity: "MEDIUM" })} disabled={configMutation.isPending}>
                  Set Medium Sensitivity
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sentiment" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-card border-border">
              <CardHeader><CardTitle className="text-base">Symbol Sentiment</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div><Label className="text-xs text-muted-foreground">Symbol</Label><Input value={sentimentSymbol} onChange={(e) => setSentimentSymbol(e.target.value.toUpperCase())} className="mt-1" /></div>
                {sentimentData && !sentimentData.error && (
                  <div className="space-y-3 mt-2">
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Sentiment</span><StatusBadge status={String(sentimentData.sentiment ?? "NEUTRAL").toUpperCase()} /></div>
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Score</span><span className="font-semibold">{(Number(sentimentData.score ?? 0.5) * 100).toFixed(1)}%</span></div>
                  </div>
                )}
                {sentimentData?.error && <p className="text-xs text-muted-foreground">{sentimentData.error}</p>}
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardHeader><CardTitle className="text-base">Market-Wide Sentiment</CardTitle></CardHeader>
              <CardContent>
                {!summaryData || summaryData.error ? (
                  <p className="text-center text-muted-foreground py-8">{summaryData?.error ?? "Loading..."}</p>
                ) : Array.isArray(summaryData.sentiments) && summaryData.sentiments.length > 0 ? (
                  <Table>
                    <TableHeader><TableRow><TableHead>Symbol</TableHead><TableHead>Sentiment</TableHead><TableHead className="text-right">Score</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {summaryData.sentiments.map((s: Record<string, unknown>, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono font-semibold">{String(s.symbol ?? "")}</TableCell>
                          <TableCell><StatusBadge status={String(s.sentiment ?? "NEUTRAL").toUpperCase()} /></TableCell>
                          <TableCell className="text-right">{(Number(s.score ?? 0.5) * 100).toFixed(1)}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-center text-muted-foreground py-8">No sentiment data available</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="risk" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader><CardTitle className="text-base">AI Risk Scoring</CardTitle><CardDescription>ML-powered risk assessment for your account</CardDescription></CardHeader>
            <CardContent>
              {!riskData ? <p className="text-center text-muted-foreground py-8">Loading risk score...</p> : riskData.error ? (
                <p className="text-center text-muted-foreground py-8">{riskData.error}</p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 rounded-lg bg-muted/20 border border-border">
                    <div>
                      <p className="text-sm text-muted-foreground">Overall Risk Level</p>
                      <p className="text-3xl font-bold text-foreground mt-1">{riskData.risk_level ?? "—"}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Risk Score</p>
                      <p className="text-3xl font-bold text-foreground mt-1">{riskData.risk_score != null ? `${(riskData.risk_score * 100).toFixed(0)}%` : "—"}</p>
                    </div>
                  </div>
                  <div className="w-full bg-muted/30 rounded-full h-3">
                    <div
                      className="h-3 rounded-full transition-all"
                      style={{
                        width: `${(riskData.risk_score ?? 0) * 100}%`,
                        background: (riskData.risk_score ?? 0) > 0.7 ? "rgb(239,68,68)" : (riskData.risk_score ?? 0) > 0.4 ? "rgb(234,179,8)" : "rgb(34,197,94)",
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    {(riskData.risk_score ?? 0) > 0.7 ? "High risk — consider reducing position sizes" :
                     (riskData.risk_score ?? 0) > 0.4 ? "Medium risk — monitor positions closely" :
                     "Low risk — account within normal parameters"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* GNN Commodity Correlation Graph */}
        <TabsContent value="correlation" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Brain className="w-4 h-4 text-purple-400" />
                GNN Commodity Correlation Graph
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                GraphSAGE(64) correlation matrix from <code className="bg-muted px-1 rounded">gold.market_summary</code> (252-day rolling window).
                Red nodes indicate anomalous commodities. Edge thickness = correlation strength.
              </p>
            </CardHeader>
            <CardContent>
              <CommodityCorrelationGraph />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      {!health?.online && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="p-4 flex items-center gap-3">
            <BarChart2 className="w-5 h-5 text-yellow-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-yellow-400">AI/ML Service Offline</p>
              <p className="text-xs text-muted-foreground">Start: <code className="bg-muted px-1 rounded">cd services/ai-ml && pip install -r requirements.txt && python main.py</code> or <code className="bg-muted px-1 rounded">docker-compose up ai-ml</code></p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
