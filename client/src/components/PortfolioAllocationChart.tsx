/**
 * NEXCOM Exchange — PortfolioAllocationChart
 *
 * Renders a donut chart showing the user's open position value
 * broken down by asset class (Commodity, Forex, Equity, Digital Asset, Index).
 * Uses Recharts PieChart (already bundled with the template via recharts).
 *
 * Data source: trpc.portfolio.summary — positions array with assetClass + quantity + avgCost.
 */
import { useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

const ASSET_CLASS_COLORS: Record<string, string> = {
  COMMODITY:     "#f59e0b",  // amber
  FOREX:         "#3b82f6",  // blue
  EQUITY:        "#a855f7",  // purple
  DIGITAL_ASSET: "#06b6d4",  // cyan
  INDEX:         "#10b981",  // emerald
};

const ASSET_CLASS_LABELS: Record<string, string> = {
  COMMODITY:     "Commodities",
  FOREX:         "Forex",
  EQUITY:        "Equities",
  DIGITAL_ASSET: "Digital Assets",
  INDEX:         "Indices",
};

interface AllocationSlice {
  name: string;
  value: number;
  color: string;
  pct: number;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: AllocationSlice }[] }) {
  if (!active || !payload?.length) return null;
  const slice = payload[0].payload;
  return (
    <div className="bg-popover border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-foreground">{slice.name}</p>
      <p className="text-muted-foreground">
        ${slice.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        <span className="ml-1 text-foreground font-medium">({slice.pct.toFixed(1)}%)</span>
      </p>
    </div>
  );
}

function CustomLegend({ data }: { data: AllocationSlice[] }) {
  return (
    <div className="flex flex-col gap-1 mt-2">
      {data.map(slice => (
        <div key={slice.name} className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: slice.color }} />
            <span className="text-muted-foreground">{slice.name}</span>
          </div>
          <span className="font-mono text-foreground font-medium">{slice.pct.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

export default function PortfolioAllocationChart() {
  const { isAuthenticated } = useAuth();
  const { data, isLoading } = trpc.portfolio.summary.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 30_000,
  });

  const allocationData = useMemo<AllocationSlice[]>(() => {
    if (!data?.positions || data.positions.length === 0) return [];

    // Aggregate position value by asset class
    const byClass: Record<string, number> = {};
    for (const pos of data.positions) {
      const cls = pos.assetClass ?? "COMMODITY";
      const value = Number(pos.quantity) * Number(pos.avgCost);
      byClass[cls] = (byClass[cls] ?? 0) + value;
    }

    const total = Object.values(byClass).reduce((s, v) => s + v, 0);
    if (total === 0) return [];

    return Object.entries(byClass)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([cls, value]) => ({
        name: ASSET_CLASS_LABELS[cls] ?? cls,
        value,
        color: ASSET_CLASS_COLORS[cls] ?? "#6b7280",
        pct: (value / total) * 100,
      }));
  }, [data]);

  if (!isAuthenticated) return null;

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card/60 p-4">
        <div className="h-4 w-32 bg-muted/40 rounded animate-pulse mb-3" />
        <div className="h-32 bg-muted/20 rounded animate-pulse" />
      </div>
    );
  }

  if (allocationData.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card/60 p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Portfolio Allocation
        </p>
        <div className="flex flex-col items-center justify-center h-28 gap-2">
          <div className="w-10 h-10 rounded-full border-2 border-dashed border-border flex items-center justify-center">
            <span className="text-muted-foreground text-lg">%</span>
          </div>
          <p className="text-xs text-muted-foreground text-center">No open positions yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        Portfolio Allocation
      </p>
      <div className="flex items-center gap-4">
        {/* Donut */}
        <div style={{ width: 110, height: 110, flexShrink: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={allocationData}
                cx="50%"
                cy="50%"
                innerRadius={30}
                outerRadius={50}
                paddingAngle={2}
                dataKey="value"
                stroke="none"
              >
                {allocationData.map((slice, i) => (
                  <Cell key={i} fill={slice.color} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        {/* Legend */}
        <div className="flex-1 min-w-0">
          <CustomLegend data={allocationData} />
        </div>
      </div>
    </div>
  );
}
