/**
 * FarmerMarketPrices — Live commodity price board for farmers
 * Shows all agricultural commodity prices with a "My Crops" filter
 * and a "List at Market Price" quick-action CTA.
 */
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sprout,
  TrendingUp,
  TrendingDown,
  Minus,
  MapPin,
  Wheat,
  User,
  BarChart3,
  RefreshCw,
  Zap,
  ArrowRight,
} from "lucide-react";
import { usePriceFeed } from "@/hooks/usePriceFeed";
import { COMMODITIES, type CommodityCategory } from "../../../shared/commodities";

// Map farmer crop type strings to commodity symbols
const CROP_TO_SYMBOL: Record<string, string> = {
  MAIZE:       "MAIZE-NG-SPOT",
  SORGHUM:     "SORGHUM-SPOT",
  MILLET:      "MILLET-SPOT",
  RICE:        "RICE-NG-SPOT",
  WHEAT:       "WHEAT-SPOT",
  COWPEA:      "COWPEA-SPOT",
  SOYBEAN:     "SOYBEAN-SPOT",
  GROUNDNUT:   "GROUNDNUT-SPOT",
  SESAME:      "SESAME-SPOT",
  GINGER:      "GINGER-NG-SPOT",
  PEPPER:      "PEPPER-BLK-SPOT",
  TOMATO:      "TOMATO-SPOT",
  CASSAVA:     "CASSAVA-SPOT",
  YAM:         "YAM-SPOT",
  COCOA:       "COCOA-SPOT",
  COTTON:      "COTTON-SPOT",
  PALM_OIL:    "PALMOIL-SPOT",
  CASHEW:      "CASHEW-SPOT",
  SHEA_BUTTER: "SHEA-SPOT",
};

// Agricultural categories to show
const AG_CATEGORIES: CommodityCategory[] = [
  "GRAINS", "OILSEEDS", "SPICES", "PULSES", "SOFT_COMMODITIES", "ROOT_CROPS", "FRUITS", "LIVESTOCK",
];

// Filter to only spot contracts in agricultural categories
const AG_COMMODITIES = COMMODITIES.filter(
  (c) => AG_CATEGORIES.includes(c.category) && !c.isFutures,
);

export default function FarmerMarketPrices() {
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<"ALL" | "MY_CROPS">("ALL");
  const [categoryFilter, setCategoryFilter] = useState<CommodityCategory | "ALL">("ALL");

  const myPricesQ = trpc.farmer.getFarmerMarketPrices.useQuery();
  const myCropTypes = myPricesQ.data?.myCropTypes ?? [];
  const myCropSymbols = useMemo(
    () => new Set(myCropTypes.map((ct) => CROP_TO_SYMBOL[ct]).filter(Boolean)),
    [myCropTypes],
  );

  const { prices, connected } = usePriceFeed({ interval: 3000 });

  const displayCommodities = useMemo(() => {
    let list = AG_COMMODITIES;
    if (filter === "MY_CROPS" && myCropSymbols.size > 0) {
      list = list.filter((c) => myCropSymbols.has(c.symbol));
    }
    if (categoryFilter !== "ALL") {
      list = list.filter((c) => c.category === categoryFilter);
    }
    return list;
  }, [filter, myCropSymbols, categoryFilter]);

  const categories = useMemo(
    () => ["ALL", ...new Set(AG_COMMODITIES.map((c) => c.category))] as const,
    [],
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-950 to-slate-950 flex flex-col max-w-md mx-auto">
      {/* Header */}
      <div className="p-4 flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-green-400" />
          <div>
            <p className="text-white font-semibold text-sm">Market Prices</p>
            <div className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-400" : "bg-slate-500"}`} />
              <p className="text-slate-400 text-xs">{connected ? "Live" : "Connecting..."}</p>
            </div>
          </div>
        </div>
        <button
          onClick={() => navigate("/farmer-crops")}
          className="text-green-400 text-xs flex items-center gap-1 bg-green-950/40 border border-green-800/40 px-3 py-1.5 rounded-full"
        >
          <Wheat className="w-3.5 h-3.5" />
          List Crop
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-24">
        {/* Filter Tabs */}
        <div className="p-4 space-y-3">
          <div className="flex gap-1 bg-slate-800/60 rounded-lg p-1">
            <button
              onClick={() => setFilter("ALL")}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                filter === "ALL" ? "bg-green-700 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              All Commodities
            </button>
            <button
              onClick={() => setFilter("MY_CROPS")}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
                filter === "MY_CROPS" ? "bg-green-700 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <Sprout className="w-3 h-3" />
              My Crops
              {myCropSymbols.size > 0 && (
                <span className="bg-green-500/30 text-green-300 text-[10px] px-1.5 rounded-full">
                  {myCropSymbols.size}
                </span>
              )}
            </button>
          </div>

          {/* Category filter chips */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat as CommodityCategory | "ALL")}
                className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  categoryFilter === cat
                    ? "bg-amber-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                }`}
              >
                {cat === "ALL" ? "All" : cat.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </div>

        {/* My Crops Quick-List Banner */}
        {filter === "MY_CROPS" && myCropTypes.length > 0 && (
          <div className="mx-4 mb-4 p-3 bg-green-950/40 border border-green-800/40 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-green-300 text-xs font-semibold">Your listed crops</p>
              <p className="text-slate-400 text-xs mt-0.5">{myCropTypes.join(", ")}</p>
            </div>
            <button
              onClick={() => navigate("/farmer-crops")}
              className="text-green-400 flex items-center gap-1 text-xs"
            >
              Manage <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* No crops message for MY_CROPS filter */}
        {filter === "MY_CROPS" && myCropTypes.length === 0 && !myPricesQ.isLoading && (
          <div className="mx-4 mb-4 p-6 bg-slate-800/50 border border-dashed border-slate-700 rounded-xl text-center">
            <Wheat className="w-8 h-8 text-slate-500 mx-auto mb-2" />
            <p className="text-slate-400 text-sm">No active crop listings</p>
            <p className="text-slate-500 text-xs mt-1">Add a listing to see your crop prices here</p>
            <Button
              size="sm"
              onClick={() => navigate("/farmer-crops")}
              className="mt-3 bg-green-600 hover:bg-green-700 text-white text-xs"
            >
              Add Listing
            </Button>
          </div>
        )}

        {/* Price Table */}
        {myPricesQ.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-6 h-6 text-slate-400 animate-spin" />
          </div>
        ) : (
          <div className="px-4 space-y-2">
            {displayCommodities.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">
                No commodities match the current filter
              </div>
            ) : (
              displayCommodities.map((commodity) => {
                const tick = prices[commodity.symbol];
                const isMyCrop = myCropSymbols.has(commodity.symbol);
                const isUp = tick?.direction === "up";
                const isDown = tick?.direction === "down";

                return (
                  <Card
                    key={commodity.symbol}
                    className={`border transition-colors ${
                      isMyCrop
                        ? "bg-green-950/30 border-green-800/40"
                        : "bg-slate-800/60 border-slate-700/60"
                    }`}
                  >
                    <CardContent className="p-3 flex items-center gap-3">
                      {/* Crop indicator */}
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        isMyCrop ? "bg-green-700/40" : "bg-slate-700/60"
                      }`}>
                        {isMyCrop ? (
                          <Sprout className="w-4 h-4 text-green-400" />
                        ) : (
                          <Wheat className="w-4 h-4 text-slate-400" />
                        )}
                      </div>

                      {/* Name + category */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-white text-sm font-medium truncate">{commodity.name}</p>
                          {isMyCrop && (
                            <Badge className="bg-green-900/60 text-green-300 border-green-700 text-[10px] px-1.5 py-0 shrink-0">
                              Mine
                            </Badge>
                          )}
                        </div>
                        <p className="text-slate-500 text-xs">{commodity.category.replace(/_/g, " ")} · per {commodity.unit}</p>
                      </div>

                      {/* Price + change */}
                      <div className="text-right shrink-0">
                        {tick ? (
                          <>
                            <p className="text-white font-bold text-sm">
                              ${tick.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                            <div className={`flex items-center justify-end gap-0.5 text-xs ${
                              isUp ? "text-green-400" : isDown ? "text-red-400" : "text-slate-400"
                            }`}>
                              {isUp ? <TrendingUp className="w-3 h-3" /> : isDown ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                              {tick.changePct >= 0 ? "+" : ""}{tick.changePct.toFixed(2)}%
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center gap-1 text-slate-500 text-xs">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            Loading
                          </div>
                        )}
                      </div>

                      {/* Quick-list CTA for my crops */}
                      {isMyCrop && tick && (
                        <button
                          onClick={() => navigate("/farmer-crops")}
                          className="shrink-0 bg-green-700/40 hover:bg-green-700/60 border border-green-700/40 text-green-300 text-[10px] px-2 py-1 rounded-lg flex items-center gap-1 transition-colors"
                        >
                          <Zap className="w-3 h-3" />
                          List
                        </button>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        )}

        {/* Market Summary */}
        <div className="mx-4 mt-4 p-3 bg-slate-800/40 border border-slate-700/40 rounded-xl">
          <p className="text-slate-400 text-xs text-center">
            Prices updated every 3 seconds · {displayCommodities.length} instruments shown
          </p>
        </div>
      </div>

      {/* Bottom Nav */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-slate-900 border-t border-slate-800 flex">
        {[
          { icon: Sprout, label: "Home", path: "/farmer-dashboard" },
          { icon: MapPin, label: "Farms", path: "/farmer-farms" },
          { icon: Wheat, label: "Crops", path: "/farmer-crops" },
          { icon: BarChart3, label: "Prices", path: "/farmer-market" },
          { icon: User, label: "Profile", path: "/farmer-kyc" },
        ].map(({ icon: Icon, label, path }) => (
          <button
            key={label}
            onClick={() => navigate(path)}
            className={`flex-1 py-3 flex flex-col items-center gap-1 text-xs transition-colors ${
              path === "/farmer-market" ? "text-green-400" : "text-slate-400 hover:text-white"
            }`}
          >
            <Icon className="w-5 h-5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
