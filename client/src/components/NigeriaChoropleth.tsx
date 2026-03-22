/**
 * NigeriaChoropleth — Renders a choropleth map of Nigeria's 36 states + FCT
 * colored by farm density (farm count per state) using Sedona spatial data.
 * Uses @react-map/nigeria for SVG rendering with cityColors prop for coloring.
 */
import { useMemo, useState } from "react";
import Nigeria from "@react-map/nigeria";

interface StateData {
  state: string;
  farmCount: number;
  totalHectares: number;
  avgSize: number;
}

interface NigeriaChoroplethProps {
  data: StateData[];
  /** Height of the map in px (default 260) */
  height?: number;
}

// Normalize state names to match @react-map/nigeria's expected keys
// The package uses title-case state names
function normalizeStateName(name: string): string {
  return name
    .split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
    // Handle common variations
    .replace("Fct", "FCT")
    .replace("Abuja", "FCT")
    .replace("Federal Capital Territory", "FCT");
}

// Generate a green color scale from light to dark based on intensity (0–1)
function greenScale(intensity: number): string {
  // From #d1fae5 (very light green) to #065f46 (deep green)
  const r = Math.round(209 - intensity * (209 - 6));
  const g = Math.round(250 - intensity * (250 - 95));
  const b = Math.round(229 - intensity * (229 - 70));
  return `rgb(${r},${g},${b})`;
}

export default function NigeriaChoropleth({ data, height = 260 }: NigeriaChoroplethProps) {
  const [selectedState, setSelectedState] = useState<string | null>(null);

  const { cityColors, maxCount, stateMap } = useMemo(() => {
    if (!data || data.length === 0) return { cityColors: {}, maxCount: 0, stateMap: {} };

    const stateMap: Record<string, StateData> = {};
    for (const row of data) {
      const normalized = normalizeStateName(row.state);
      stateMap[normalized] = row;
    }

    const maxCount = Math.max(...data.map(d => d.farmCount), 1);
    const cityColors: Record<string, string> = {};

    for (const [stateName, row] of Object.entries(stateMap)) {
      const intensity = row.farmCount / maxCount;
      cityColors[stateName] = greenScale(intensity);
    }

    return { cityColors, maxCount, stateMap };
  }, [data]);

  const selectedData = selectedState ? stateMap[selectedState] : null;

  return (
    <div className="flex flex-col gap-2">
      {/* Map */}
      <div className="relative" style={{ height }}>
        <Nigeria
          type="select-single"
          size={height}
          mapColor="#1e293b"
          strokeColor="#334155"
          strokeWidth={0.8}
          hoverColor="#22c55e"
          selectColor="#16a34a"
          hints={true}
          hintTextColor="#f8fafc"
          hintBackgroundColor="#0f172a"
          hintBorderRadius={4}
          cityColors={cityColors}
          onSelect={(state) => setSelectedState(state)}
        />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 px-1">
        <span className="text-xs text-slate-500">0 farms</span>
        <div
          className="flex-1 h-2 rounded-full"
          style={{
            background: "linear-gradient(to right, #d1fae5, #065f46)",
          }}
        />
        <span className="text-xs text-slate-500">{maxCount} farms</span>
      </div>

      {/* Selected state detail */}
      {selectedState && (
        <div className="bg-slate-700/60 rounded-lg px-3 py-2 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-white">{selectedState}</p>
            {selectedData ? (
              <p className="text-xs text-slate-400">
                {selectedData.farmCount} farms · {selectedData.totalHectares.toFixed(0)} ha total · avg {selectedData.avgSize.toFixed(1)} ha
              </p>
            ) : (
              <p className="text-xs text-slate-500">No farm data recorded</p>
            )}
          </div>
          <button
            onClick={() => setSelectedState(null)}
            className="text-slate-500 hover:text-slate-300 text-xs ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top states summary */}
      {data.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 mt-1">
          {data
            .sort((a, b) => b.farmCount - a.farmCount)
            .slice(0, 3)
            .map((row, i) => (
              <div key={row.state} className="bg-slate-700/40 rounded px-2 py-1.5 text-center">
                <div className="flex items-center justify-center gap-1 mb-0.5">
                  <span className="text-xs font-bold text-green-400">#{i + 1}</span>
                </div>
                <p className="text-xs text-white font-semibold truncate">{normalizeStateName(row.state)}</p>
                <p className="text-xs text-slate-400">{row.farmCount} farms</p>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
