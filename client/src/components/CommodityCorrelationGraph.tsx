/**
 * CommodityCorrelationGraph.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * GNN Commodity Correlation Graph panel for the AI/ML Dashboard.
 * Visualises which commodities move together using @xyflow/react.
 *
 * Data source: trpc.aiMl.getCommodityCorrelationGraph
 * Backend: GNN-GraphSAGE correlation matrix from gold.market_summary
 *
 * Features:
 *   - Circular layout with sector colour-coding
 *   - Edge thickness = correlation strength
 *   - Red nodes = anomalous commodities (GNN anomaly score > threshold)
 *   - Threshold slider to filter weak correlations
 *   - Stats panel: avg correlation, strong edges, anomalous pairs
 */
import { useState, useMemo, useCallback, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  MarkerType,
  BackgroundVariant,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { RefreshCw, AlertTriangle, Network, TrendingUp, Bell } from "lucide-react";
import { toast } from "sonner";

// ─── Pulsing animation for co-anomalous edges ─────────────────────────────────
const PULSE_STYLE = `
  @keyframes edgePulse {
    0%   { stroke-opacity: 0.3; stroke-width: 2; }
    50%  { stroke-opacity: 1;   stroke-width: 4; }
    100% { stroke-opacity: 0.3; stroke-width: 2; }
  }
  .react-flow__edge.co-anomalous path {
    animation: edgePulse 1.4s ease-in-out infinite;
    stroke: #ef4444 !important;
  }
`;

// ─── Sector colours ────────────────────────────────────────────────────────────
const SECTOR_COLOR: Record<string, { bg: string; border: string; text: string }> = {
  grains:   { bg: "rgba(120,53,15,0.5)",  border: "#d97706", text: "#fde68a" },
  oilseeds: { bg: "rgba(5,78,22,0.5)",    border: "#16a34a", text: "#86efac" },
  softs:    { bg: "rgba(76,29,149,0.5)",  border: "#7c3aed", text: "#c4b5fd" },
  roots:    { bg: "rgba(30,58,138,0.5)",  border: "#2563eb", text: "#93c5fd" },
  other:    { bg: "rgba(51,65,85,0.5)",   border: "#475569", text: "#cbd5e1" },
};

// ─── Custom node ───────────────────────────────────────────────────────────────
function CommodityNode({ data }: { data: Record<string, unknown> }) {
  const sector = String(data.sector ?? "other");
  const style = SECTOR_COLOR[sector] ?? SECTOR_COLOR.other;
  const isAnomalous = Boolean(data.is_anomalous);
  const anomalyScore = Number(data.anomaly_score ?? 0);
  return (
    <div style={{
      background: isAnomalous ? "rgba(127,29,29,0.6)" : style.bg,
      border: `2px solid ${isAnomalous ? "#ef4444" : style.border}`,
      borderRadius: "50%",
      width: 72,
      height: 72,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      boxShadow: isAnomalous ? "0 0 12px rgba(239,68,68,0.5)" : "none",
    }}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div style={{ color: isAnomalous ? "#fca5a5" : style.text, fontSize: 9, fontWeight: 700, textAlign: "center", lineHeight: 1.2 }}>
        {String(data.label ?? "").split(" ").map((w: string, i: number) => <div key={i}>{w}</div>)}
      </div>
      {isAnomalous && (
        <div style={{ color: "#ef4444", fontSize: 8, marginTop: 2 }}>⚠ {(anomalyScore * 100).toFixed(0)}%</div>
      )}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { commodityNode: CommodityNode };

// ─── Circular layout ───────────────────────────────────────────────────────────
function circularLayout(nodes: Node[], radius = 220): Node[] {
  const n = nodes.length;
  return nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    return {
      ...node,
      position: {
        x: radius * Math.cos(angle) + radius,
        y: radius * Math.sin(angle) + radius,
      },
    };
  });
}

// ─── Edge colour by strength ───────────────────────────────────────────────────
function edgeStyle(strength: string, isAnomalous: boolean): { stroke: string; strokeWidth: number } {
  if (isAnomalous) return { stroke: "rgba(239,68,68,0.7)", strokeWidth: 3 };
  if (strength === "strong") return { stroke: "rgba(250,204,21,0.6)", strokeWidth: 2.5 };
  if (strength === "moderate") return { stroke: "rgba(148,163,184,0.45)", strokeWidth: 1.5 };
  return { stroke: "rgba(100,116,139,0.3)", strokeWidth: 1 };
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function CommodityCorrelationGraph() {
  const [threshold, setThreshold] = useState(0.4);
  const [debouncedThreshold, setDebouncedThreshold] = useState(0.4);
  const [coAnomalousPairIds, setCoAnomalousPairIds] = useState<Set<string>>(new Set());
  const [lastAlertCount, setLastAlertCount] = useState(0);

  const checkCoAnomalies = trpc.aiMl.checkCoAnomalies.useMutation({
    onSuccess: (result) => {
      const r = result as { coAnomalousPairs?: Array<{ source: string; target: string }>; alertFired?: boolean; error?: string };
      if (r.error) { toast.error("AI/ML service offline"); return; }
      const pairs = r.coAnomalousPairs ?? [];
      const ids = new Set(pairs.map((p) => `${p.source}-${p.target}`));
      setCoAnomalousPairIds(ids);
      setLastAlertCount(pairs.length);
      if (r.alertFired) {
        toast.warning(`⚠ ${pairs.length} co-anomalous pair(s) detected — owner notified`, { duration: 6000 });
      } else {
        toast.success("No co-anomalies detected above threshold");
      }
    },
    onError: () => toast.error("Failed to check co-anomalies"),
  });

  const { data, isLoading, refetch } = trpc.aiMl.getCommodityCorrelationGraph.useQuery(
    { threshold: debouncedThreshold },
    { refetchInterval: 60000 }
  );

  type GraphData = {
    nodes?: Array<{ id: string; label: string; sector: string; anomaly_score: number; is_anomalous: boolean }>;
    edges?: Array<{ source: string; target: string; correlation: number; strength: string; is_anomalous: boolean }>;
    stats?: { node_count: number; edge_count: number; avg_correlation: number; strong_edge_count: number; anomalous_edge_count: number };
    model?: { type: string; embedding_dim: number; training_source: string };
    error?: string;
  };

  const graphData = data as GraphData | undefined;

  const rawNodes: Node[] = useMemo(() => {
    if (!graphData?.nodes?.length) return [];
    return (graphData.nodes).map((n) => ({
      id: n.id,
      type: "commodityNode",
      position: { x: 0, y: 0 },
      data: {
        label: n.label,
        sector: n.sector,
        anomaly_score: n.anomaly_score,
        is_anomalous: n.is_anomalous,
      },
    }));
  }, [graphData?.nodes]);

  const layoutNodes = useMemo(() => circularLayout(rawNodes), [rawNodes]);

  const rawEdges: Edge[] = useMemo(() => {
    if (!graphData?.edges?.length) return [];
    return (graphData.edges).map((e, i) => {
      const isPulse = coAnomalousPairIds.has(`${e.source}-${e.target}`) || coAnomalousPairIds.has(`${e.target}-${e.source}`);
      const es = edgeStyle(e.strength, e.is_anomalous || isPulse);
      return {
        id: `e-${i}`,
        source: e.source,
        target: e.target,
        label: e.correlation.toFixed(2),
        labelStyle: { fill: isPulse ? "rgba(239,68,68,0.8)" : "rgba(255,255,255,0.35)", fontSize: 8 },
        style: { stroke: es.stroke, strokeWidth: es.strokeWidth },
        className: isPulse ? "co-anomalous" : "",
        markerEnd: { type: MarkerType.ArrowClosed, color: es.stroke },
        animated: isPulse,
      };
    });
  }, [graphData?.edges, coAnomalousPairIds]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rawEdges);

  // Sync when data changes
  useMemo(() => {
    if (layoutNodes.length > 0) setNodes(layoutNodes);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutNodes.length]);

  useMemo(() => {
    if (rawEdges.length > 0) setEdges(rawEdges);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawEdges.length]);

  const handleThresholdChange = useCallback((val: number[]) => {
    setThreshold(val[0]);
    // Debounce: only query when user stops dragging
    clearTimeout((window as Window & { _corrTimer?: ReturnType<typeof setTimeout> })._corrTimer);
    (window as Window & { _corrTimer?: ReturnType<typeof setTimeout> })._corrTimer = setTimeout(() => setDebouncedThreshold(val[0]), 400);
  }, []);

  // Re-sync edges when co-anomaly pairs change (to apply pulsing)
  useEffect(() => {
    if (rawEdges.length > 0) setEdges(rawEdges);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coAnomalousPairIds]);

  const stats = graphData?.stats;
  const model = graphData?.model;
  const isOffline = !!(graphData as GraphData | undefined)?.error;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Computing GNN correlation graph…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Inject pulsing keyframe CSS */}
      <style>{PULSE_STYLE}</style>

      {/* Co-anomaly alert banner */}
      {lastAlertCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-red-950/40 border border-red-700/50 text-red-300 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-red-400" />
          <span>
            <strong>{lastAlertCount} co-anomalous pair(s)</strong> detected — pulsing edges highlight affected correlations. Owner has been notified.
          </span>
          <button
            className="ml-auto text-xs text-red-400/70 hover:text-red-300 underline"
            onClick={() => { setCoAnomalousPairIds(new Set()); setLastAlertCount(0); }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-48">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Min correlation:</span>
          <Slider
            min={0.1} max={0.9} step={0.05}
            value={[threshold]}
            onValueChange={handleThresholdChange}
            className="w-32"
          />
          <Badge variant="outline" className="text-xs font-mono">{threshold.toFixed(2)}</Badge>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {/* Legend */}
          {Object.entries(SECTOR_COLOR).filter(([k]) => k !== "other").map(([sector, s]) => (
            <div key={sector} className="flex items-center gap-1">
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: s.border }} />
              <span className="text-xs text-muted-foreground capitalize">{sector}</span>
            </div>
          ))}
          <div className="flex items-center gap-1 ml-1">
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444" }} />
            <span className="text-xs text-red-400">anomalous</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => checkCoAnomalies.mutate({ threshold: 0.5, correlationThreshold: debouncedThreshold })}
            disabled={checkCoAnomalies.isPending || isOffline}
            className="border-amber-700/50 text-amber-300 hover:bg-amber-950/30"
          >
            {checkCoAnomalies.isPending
              ? <RefreshCw className="w-3 h-3 animate-spin mr-1" />
              : <Bell className="w-3 h-3 mr-1" />}
            Check Co-Anomalies
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {isOffline ? (
        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
            <Network className="w-10 h-10 text-muted-foreground/40" />
            <p className="text-muted-foreground text-sm">AI/ML service offline — correlation graph unavailable</p>
          </CardContent>
        </Card>
      ) : (
        <div style={{ height: 520, borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.1 }}
            colorMode="dark"
            minZoom={0.4}
            maxZoom={2}
            nodesDraggable
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.05)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      )}

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Commodities", value: stats.node_count, icon: <Network className="w-3 h-3" /> },
            { label: "Correlated Pairs", value: stats.edge_count, icon: <TrendingUp className="w-3 h-3" /> },
            { label: "Strong Edges (≥0.7)", value: stats.strong_edge_count, icon: <TrendingUp className="w-3 h-3 text-yellow-400" /> },
            { label: "Anomalous Pairs", value: stats.anomalous_edge_count, icon: <AlertTriangle className="w-3 h-3 text-red-400" /> },
          ].map(({ label, value, icon }) => (
            <Card key={label} className="bg-muted/10 border-border">
              <CardContent className="p-3">
                <div className="flex items-center gap-1 text-muted-foreground text-xs mb-1">{icon}{label}</div>
                <div className="text-lg font-bold text-foreground">{value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Model info */}
      {model && (
        <div className="text-xs text-muted-foreground/60 flex flex-wrap gap-3">
          <span>Model: <span className="font-mono text-cyan-400/70">{model.type}</span></span>
          <span>Embedding dim: <span className="font-mono">{model.embedding_dim}</span></span>
          <span>Training source: <span className="font-mono">{model.training_source}</span></span>
          <span>Avg correlation: <span className="font-mono">{stats?.avg_correlation?.toFixed(3) ?? "—"}</span></span>
        </div>
      )}
    </div>
  );
}
