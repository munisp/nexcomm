import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, TrendingUp, TrendingDown, Minus, BarChart3, Calendar, Download, MapPin, Wheat, Globe } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts";

const CROP_OPTIONS = ["ALL", "MAIZE", "SOYBEAN", "SORGHUM", "GINGER", "COCOA", "SESAME", "GROUNDNUT", "CASSAVA"];

const PRODUCTION_TREND = [
  { year: "2020", maize: 8.2, soybean: 3.1, sorghum: 6.8 },
  { year: "2021", maize: 9.1, soybean: 3.4, sorghum: 7.2 },
  { year: "2022", maize: 8.7, soybean: 3.8, sorghum: 6.9 },
  { year: "2023", maize: 10.2, soybean: 4.1, sorghum: 7.8 },
  { year: "2024", maize: 11.4, soybean: 4.6, sorghum: 8.3 },
  { year: "2025E", maize: 12.1, soybean: 5.0, sorghum: 8.9 },
];

const STATE_PRODUCTION = [
  { state: "Kano", volume: 2.8 }, { state: "Kaduna", volume: 2.1 }, { state: "Borno", volume: 1.9 },
  { state: "Adamawa", volume: 1.7 }, { state: "Plateau", volume: 1.4 }, { state: "Niger", volume: 1.2 },
  { state: "Kebbi", volume: 1.1 }, { state: "Sokoto", volume: 0.9 },
];

const SENTIMENT_COLORS: Record<string, string> = {
  BULLISH: "bg-green-500/15 text-green-400 border-green-500/30",
  BEARISH: "bg-red-500/15 text-red-400 border-red-500/30",
  NEUTRAL: "bg-gray-500/15 text-gray-400 border-gray-500/30",
};

type CropIndex = { id: number; indexName: string; cropSymbol: string; indexValue: string; changePercent: string; sentiment: string };
type CropReport = { id: number; reportType: string; cropSymbol: string; cropName: string; reportingPeriod: string; coverageRegion: string; productionMt: string | null; yieldMtPerHa: string | null; areaHarvestedHa: string | null; stocksMt: string | null; exportsMt: string | null; importsMt: string | null; priceNgnPerMt: string | null; priceChangePercent: string | null; outlookSummary: string | null; publishedAt: Date | null; createdAt: Date };
const SENTIMENT_ICONS: Record<string, React.ElementType> = {
  BULLISH: TrendingUp, BEARISH: TrendingDown, NEUTRAL: Minus,
};

export default function CropReports() {
  const [tab, setTab] = useState("reports");
  const [cropFilter, setCropFilter] = useState("ALL");

  const { data: reports = [], isLoading } = trpc.cropReports.list.useQuery(
    cropFilter === "ALL" ? undefined : { cropSymbol: cropFilter }
  );
  const { data: indices = [] } = trpc.cropReports.indices.useQuery();

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-orange-500/20">
            <FileText className="w-6 h-6 text-orange-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Crop Production Reports</h1>
            <p className="text-sm text-gray-400">Nigeria agricultural production data, forecasts & commodity indices</p>
          </div>
        </div>
        <Badge variant="outline" className="border-orange-500/30 text-orange-400 bg-orange-500/10">
          Powered by Sedona · PostGIS
        </Badge>
      </div>

      {/* Commodity Indices */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {(indices as CropIndex[]).slice(0, 4).map(idx => {
          const SentIcon = SENTIMENT_ICONS[idx.sentiment ?? "NEUTRAL"] ?? Minus;
          const change = parseFloat(idx.changePercent ?? "0");
          return (
            <Card key={idx.id} className="bg-[#111827] border-gray-700/50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-400 font-medium">{idx.indexName}</span>
                  <Badge variant="outline" className={`text-xs ${SENTIMENT_COLORS[idx.sentiment ?? "NEUTRAL"]}`}>
                    <SentIcon className="w-3 h-3 mr-1" />
                    {idx.sentiment}
                  </Badge>
                </div>
                <p className="text-2xl font-bold text-white">{parseFloat(idx.indexValue ?? "0").toFixed(2)}</p>
                <p className={`text-sm mt-1 ${change >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {change >= 0 ? "+" : ""}{change.toFixed(2)}%
                </p>
                <p className="text-xs text-gray-500 mt-1">{idx.cropSymbol}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-[#111827] border border-gray-700/50 mb-6">
          <TabsTrigger value="reports">Research Reports</TabsTrigger>
          <TabsTrigger value="production">Production Data</TabsTrigger>
          <TabsTrigger value="states">State Breakdown</TabsTrigger>
        </TabsList>

        {/* Reports */}
        <TabsContent value="reports">
          <div className="flex items-center gap-3 mb-4">
            <Select value={cropFilter} onValueChange={setCropFilter}>
              <SelectTrigger className="bg-[#111827] border-gray-700 text-white w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#111827] border-gray-700 text-white">
                {CROP_OPTIONS.map(c => <SelectItem key={c} value={c}>{c === "ALL" ? "All Crops" : c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-4">
            {isLoading ? (
              <Card className="bg-[#111827] border-gray-700/50">
                <CardContent className="p-8 text-center text-gray-500">Loading reports…</CardContent>
              </Card>
            ) : reports.length === 0 ? (
              <Card className="bg-[#111827] border-gray-700/50">
                <CardContent className="p-12 text-center">
                  <FileText className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-400">No reports available for this crop</p>
                </CardContent>
              </Card>
            ) : (reports as CropReport[]).map(report => {
              const priceChange = parseFloat(report.priceChangePercent ?? "0");
              const PriceIcon = priceChange >= 0 ? TrendingUp : TrendingDown;
              return (
                <Card key={report.id} className="bg-[#111827] border-gray-700/50 hover:border-orange-500/30 transition-colors">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Badge variant="outline" className="text-xs border-orange-500/30 text-orange-400 bg-orange-500/10">
                            {report.cropSymbol}
                          </Badge>
                          <Badge variant="outline" className={`text-xs ${priceChange >= 0 ? "text-green-400 border-green-500/30 bg-green-500/10" : "text-red-400 border-red-500/30 bg-red-500/10"}`}>
                            <PriceIcon className="w-3 h-3 mr-1" />
                            {priceChange >= 0 ? "+" : ""}{priceChange.toFixed(1)}%
                          </Badge>
                          <span className="text-xs text-gray-500">{report.reportType?.replace(/_/g, " ")}</span>
                        </div>
                        <h3 className="font-bold text-white">{report.cropName}</h3>
                        <p className="text-sm text-gray-400 mt-1 line-clamp-2">{report.outlookSummary}</p>
                      </div>
                      <div className="ml-4 text-right shrink-0">
                        <p className="text-xs text-gray-500">{report.reportingPeriod}</p>
                        <p className="text-xs text-gray-600 mt-1">{report.coverageRegion}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 mt-3">
                      <div className="bg-[#0a0e1a] rounded p-2">
                        <p className="text-xs text-gray-500">Production</p>
                        <p className="text-sm font-bold text-white">{report.productionMt ? `${(parseFloat(report.productionMt)/1e6).toFixed(2)}M MT` : "—"}</p>
                      </div>
                      <div className="bg-[#0a0e1a] rounded p-2">
                        <p className="text-xs text-gray-500">Price/MT</p>
                        <p className="text-sm font-bold text-white">{report.priceNgnPerMt ? `₦${(parseFloat(report.priceNgnPerMt)/1000).toFixed(0)}K` : "—"}</p>
                      </div>
                      <div className="bg-[#0a0e1a] rounded p-2">
                        <p className="text-xs text-gray-500">Published</p>
                        <p className="text-sm font-bold text-white">{new Date(report.publishedAt ?? report.createdAt).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" })}</p>
                      </div>
                    </div>
                    {report.stocksMt && (
                      <div className="mt-3 bg-[#0a0e1a] rounded p-3 flex gap-4 text-xs">
                        <span className="text-gray-400">Stocks: <span className="text-white font-bold">{(parseFloat(report.stocksMt)/1000).toFixed(0)}K MT</span></span>
                        {report.exportsMt && <span className="text-gray-400">Exports: <span className="text-white font-bold">{(parseFloat(report.exportsMt)/1000).toFixed(0)}K MT</span></span>}
                        {report.yieldMtPerHa && <span className="text-gray-400">Yield: <span className="text-white font-bold">{parseFloat(report.yieldMtPerHa).toFixed(2)} MT/ha</span></span>}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* Production Trend */}
        <TabsContent value="production">
          <Card className="bg-[#111827] border-gray-700/50">
            <CardHeader>
              <CardTitle className="text-white text-base">Nigeria Crop Production Trend (Million MT)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={360}>
                <LineChart data={PRODUCTION_TREND}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="year" stroke="#6b7280" tick={{ fill: "#9ca3af", fontSize: 12 }} />
                  <YAxis stroke="#6b7280" tick={{ fill: "#9ca3af", fontSize: 12 }} tickFormatter={v => `${v}M`} />
                  <Tooltip contentStyle={{ background: "#111827", border: "1px solid #374151", color: "#fff" }}
                    formatter={(v: any, name: string) => [`${v}M MT`, name.charAt(0).toUpperCase() + name.slice(1)]} />
                  <Legend />
                  <Line type="monotone" dataKey="maize" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} name="Maize" />
                  <Line type="monotone" dataKey="soybean" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} name="Soybean" />
                  <Line type="monotone" dataKey="sorghum" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} name="Sorghum" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* State Breakdown */}
        <TabsContent value="states">
          <Card className="bg-[#111827] border-gray-700/50">
            <CardHeader>
              <CardTitle className="text-white text-base">Production by State (Million MT)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={STATE_PRODUCTION} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis type="number" stroke="#6b7280" tick={{ fill: "#9ca3af", fontSize: 12 }} tickFormatter={v => `${v}M`} />
                  <YAxis type="category" dataKey="state" stroke="#6b7280" tick={{ fill: "#9ca3af", fontSize: 12 }} width={60} />
                  <Tooltip contentStyle={{ background: "#111827", border: "1px solid #374151", color: "#fff" }}
                    formatter={(v: any) => [`${v}M MT`, "Production"]} />
                  <Bar dataKey="volume" fill="#f97316" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
