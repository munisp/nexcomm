import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Download,
  TrendingUp,
  Package,
  DollarSign,
  BarChart3,
  Home,
  Leaf,
  User,
} from "lucide-react";
import { toast } from "sonner";

const PERIOD_OPTIONS = [
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 180 days", days: 180 },
  { label: "Last year", days: 365 },
];

export default function FarmerEarnings() {
  const [, navigate] = useLocation();
  const [days, setDays] = useState(90);

  const { data, isLoading } = trpc.farmer.getFarmerEarnings.useQuery({
    days,
    format: "JSON",
  });

  const earnings = (data as any)?.earnings ?? [];
  const totalRevenue = (data as any)?.totalRevenue ?? 0;
  const totalKg = (data as any)?.totalKg ?? 0;
  const count = (data as any)?.count ?? 0;

  const avgPricePerKg = totalKg > 0 ? totalRevenue / totalKg : 0;

  // Group by crop type for summary
  const byCrop: Record<string, { revenue: number; kg: number; count: number }> = {};
  for (const e of earnings) {
    const ct = e.cropType;
    if (!byCrop[ct]) byCrop[ct] = { revenue: 0, kg: 0, count: 0 };
    byCrop[ct].revenue += parseFloat(String(e.totalAmount));
    byCrop[ct].kg += parseFloat(String(e.quantityKg));
    byCrop[ct].count++;
  }

  const handleDownloadCSV = async () => {
    try {
      const result = await (window as any).__trpc?.farmer?.getFarmerEarnings?.query?.({ days, format: "CSV" });
      // Fallback: build CSV from current data
      const header = "Date,Crop Type,Quantity (kg),Price/kg (NGN),Total (NGN),Buyer,Notes";
      const rows = earnings.map((e: any) =>
        [
          new Date(e.settledAt).toISOString().split("T")[0],
          e.cropType,
          parseFloat(String(e.quantityKg)).toFixed(2),
          parseFloat(String(e.pricePerKg)).toFixed(4),
          parseFloat(String(e.totalAmount)).toFixed(2),
          e.buyerName ?? "",
          (e.notes ?? "").replace(/,/g, ";"),
        ].join(",")
      );
      const csv = [header, ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `farmer-earnings-${days}d.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${count} earnings records exported`);
    } catch {
      toast.error("Download failed");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-950 to-green-900 text-white pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-green-950/90 backdrop-blur border-b border-green-800 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate("/farmer-dashboard")} className="p-1.5 rounded-lg hover:bg-green-800 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="font-bold text-lg">Earnings History</h1>
          <p className="text-xs text-green-300">Track your crop sale revenue</p>
        </div>
        <Button
          onClick={handleDownloadCSV}
          variant="outline"
          size="sm"
          className="border-green-600 text-green-300 hover:bg-green-800 bg-transparent"
          disabled={count === 0}
        >
          <Download className="w-4 h-4 mr-1" />
          CSV
        </Button>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Period selector */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              onClick={() => setDays(opt.days)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                days === opt.days
                  ? "bg-green-500 text-white"
                  : "bg-green-800/50 text-green-300 hover:bg-green-700"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="bg-green-800/40 border-green-700">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-4 h-4 text-green-400" />
                <span className="text-xs text-green-300">Total Revenue</span>
              </div>
              <p className="text-xl font-bold text-white">
                ₦{totalRevenue.toLocaleString("en-NG", { maximumFractionDigits: 0 })}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-green-800/40 border-green-700">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Package className="w-4 h-4 text-green-400" />
                <span className="text-xs text-green-300">Total Sold</span>
              </div>
              <p className="text-xl font-bold text-white">
                {totalKg.toLocaleString("en-NG", { maximumFractionDigits: 0 })} kg
              </p>
            </CardContent>
          </Card>
          <Card className="bg-green-800/40 border-green-700">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-green-400" />
                <span className="text-xs text-green-300">Avg. Price/kg</span>
              </div>
              <p className="text-xl font-bold text-white">
                ₦{avgPricePerKg.toLocaleString("en-NG", { maximumFractionDigits: 2 })}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-green-800/40 border-green-700">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 className="w-4 h-4 text-green-400" />
                <span className="text-xs text-green-300">Transactions</span>
              </div>
              <p className="text-xl font-bold text-white">{count}</p>
            </CardContent>
          </Card>
        </div>

        {/* By Crop Breakdown */}
        {Object.keys(byCrop).length > 0 && (
          <Card className="bg-green-800/30 border-green-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-green-300">Revenue by Crop</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {Object.entries(byCrop)
                .sort((a, b) => b[1].revenue - a[1].revenue)
                .map(([crop, stats]) => (
                  <div key={crop} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">{crop}</p>
                      <p className="text-xs text-green-400">
                        {stats.kg.toLocaleString("en-NG", { maximumFractionDigits: 0 })} kg · {stats.count} sale{stats.count !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <p className="text-sm font-bold text-green-300">
                      ₦{stats.revenue.toLocaleString("en-NG", { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                ))}
            </CardContent>
          </Card>
        )}

        {/* Earnings Timeline */}
        <div>
          <h2 className="text-sm font-semibold text-green-300 mb-3">Transaction History</h2>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 bg-green-800/30 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : earnings.length === 0 ? (
            <Card className="bg-green-800/20 border-green-700 border-dashed">
              <CardContent className="py-10 text-center">
                <DollarSign className="w-10 h-10 text-green-600 mx-auto mb-3" />
                <p className="text-green-300 font-medium">No earnings yet</p>
                <p className="text-green-500 text-sm mt-1">
                  Your settled crop sales will appear here
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {earnings.map((e: any) => (
                <Card key={e.id} className="bg-green-800/30 border-green-700">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className="bg-green-700 text-green-200 text-xs">
                            {e.cropType}
                          </Badge>
                          {e.buyerName && (
                            <span className="text-xs text-green-400">→ {e.buyerName}</span>
                          )}
                        </div>
                        <p className="text-sm text-green-300">
                          {parseFloat(String(e.quantityKg)).toLocaleString("en-NG", { maximumFractionDigits: 0 })} kg
                          {" "}@ ₦{parseFloat(String(e.pricePerKg)).toLocaleString("en-NG", { maximumFractionDigits: 2 })}/kg
                        </p>
                        {e.notes && (
                          <p className="text-xs text-green-500 mt-1">{e.notes}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-base font-bold text-green-300">
                          ₦{parseFloat(String(e.totalAmount)).toLocaleString("en-NG", { maximumFractionDigits: 0 })}
                        </p>
                        <p className="text-xs text-green-500">
                          {new Date(e.settledAt).toLocaleDateString("en-NG", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Nav */}
      <div className="fixed bottom-0 left-0 right-0 bg-green-950 border-t border-green-800 flex">
        {[
          { icon: Home, label: "Home", path: "/farmer-dashboard" },
          { icon: Leaf, label: "Crops", path: "/farmer-crops" },
          { icon: BarChart3, label: "Market", path: "/farmer-market" },
          { icon: DollarSign, label: "Earnings", path: "/farmer-earnings", active: true },
          { icon: User, label: "Profile", path: "/farmer-kyc" },
        ].map(({ icon: Icon, label, path, active }) => (
          <button
            key={path}
            onClick={() => navigate(path)}
            className={`flex-1 flex flex-col items-center py-3 gap-0.5 transition-colors ${
              active ? "text-green-400" : "text-green-600 hover:text-green-400"
            }`}
          >
            <Icon className="w-5 h-5" />
            <span className="text-xs">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
