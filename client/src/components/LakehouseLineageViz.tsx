/**
 * LakehouseLineageViz.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Interactive data lineage visualizer for the NEXCOM Lakehouse.
 * Uses @xyflow/react to render a Bronze → Silver → Gold DAG.
 *
 * Features:
 *   - Auto-layout: Bronze (left), Silver (center), Gold (right)
 *   - Click a node to fetch its upstream/downstream lineage from tRPC
 *   - Color-coded by layer (amber=bronze, slate=silver, yellow=gold)
 *   - Edge labels show transformation type (Flink/Spark/Ray)
 *   - Mini-map + controls for large graphs
 *   - Graceful offline state when ingestion engine is down
 */
import { useState, useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  MarkerType,
  BackgroundVariant,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { GitBranch, RefreshCw, Layers, Search } from "lucide-react";

// ─── Layer colour tokens ───────────────────────────────────────────────────────
const LAYER_STYLE: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  bronze: {
    bg: "rgba(120,53,15,0.35)",
    border: "#92400e",
    text: "#fbbf24",
    badge: "bg-amber-800/40 text-amber-300 border-amber-700/50",
  },
  silver: {
    bg: "rgba(51,65,85,0.45)",
    border: "#475569",
    text: "#cbd5e1",
    badge: "bg-slate-600/40 text-slate-200 border-slate-500/50",
  },
  gold: {
    bg: "rgba(113,63,18,0.35)",
    border: "#b45309",
    text: "#fde68a",
    badge: "bg-yellow-700/40 text-yellow-300 border-yellow-600/50",
  },
};

// ─── Custom node component ─────────────────────────────────────────────────────
function TableNode({ data }: { data: Record<string, unknown> }) {
  const layer = String(data.layer ?? "bronze");
  const style = LAYER_STYLE[layer] ?? LAYER_STYLE.bronze;
  const isSelected = Boolean(data.selected);
  return (
    <div
      style={{
        background: style.bg,
        border: `1.5px solid ${isSelected ? "#60a5fa" : style.border}`,
        borderRadius: 8,
        padding: "8px 12px",
        minWidth: 160,
        maxWidth: 200,
        boxShadow: isSelected ? "0 0 0 2px rgba(96,165,250,0.4)" : "none",
        cursor: "pointer",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: style.border }} />
      <div style={{ color: style.text, fontSize: 11, fontWeight: 700, fontFamily: "monospace", marginBottom: 2 }}>
        {String(data.label ?? "")}
      </div>
      <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 10 }}>
        {String(data.format ?? "parquet").toUpperCase()}
        {data.rowCount ? ` · ${Number(data.rowCount).toLocaleString()} rows` : ""}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: style.border }} />
    </div>
  );
}

const nodeTypes = { tableNode: TableNode };

// ─── Layout helpers ────────────────────────────────────────────────────────────
const LAYER_X: Record<string, number> = { bronze: 0, silver: 380, gold: 760 };
const LAYER_Y_STEP = 90;

function buildInitialGraph(tables: Record<string, unknown>[]): { nodes: Node[]; edges: Edge[] } {
  const layerCounts: Record<string, number> = {};
  const nodes: Node[] = tables.map((t) => {
    const layer = String(t.layer ?? "bronze");
    const idx = layerCounts[layer] ?? 0;
    layerCounts[layer] = idx + 1;
    const name = String(t.table_name ?? t.name ?? "");
    const shortName = name.split(".").slice(1).join(".");
    return {
      id: name,
      type: "tableNode",
      position: { x: LAYER_X[layer] ?? 0, y: idx * LAYER_Y_STEP },
      data: {
        label: shortName || name,
        layer,
        format: String(t.format ?? "parquet"),
        rowCount: t.row_count ?? t.rowCount,
        selected: false,
      },
    };
  });

  // Build edges from source_feeds relationships
  const edges: Edge[] = [];
  const edgeSet = new Set<string>();
  tables.forEach((t) => {
    const target = String(t.table_name ?? t.name ?? "");
    const sources = Array.isArray(t.source_feeds) ? (t.source_feeds as string[]) : [];
    sources.forEach((src) => {
      const edgeId = `${src}->${target}`;
      if (!edgeSet.has(edgeId) && tables.some((x) => String(x.table_name ?? x.name ?? "") === src)) {
        edgeSet.add(edgeId);
        const srcLayer = String(tables.find((x) => String(x.table_name ?? x.name ?? "") === src)?.layer ?? "bronze");
        const processor = srcLayer === "bronze" ? "Flink" : srcLayer === "silver" ? "Spark" : "Ray";
        edges.push({
          id: edgeId,
          source: src,
          target,
          label: processor,
          labelStyle: { fill: "rgba(255,255,255,0.45)", fontSize: 9 },
          labelBgStyle: { fill: "rgba(0,0,0,0.4)", fillOpacity: 0.8 },
          style: { stroke: "rgba(148,163,184,0.4)", strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(148,163,184,0.6)" },
          animated: srcLayer === "bronze",
        });
      }
    });
  });

  return { nodes, edges };
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function LakehouseLineageViz() {
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [focusedLineage, setFocusedLineage] = useState<Record<string, unknown> | null>(null);

  const { data: catalog, isLoading, refetch } = trpc.lakehouse.getCatalog.useQuery(undefined, {
    refetchInterval: 120000,
  });

  const lineageQuery = trpc.lakehouse.getLineage.useQuery(
    { table: selectedTable },
    { enabled: !!selectedTable }
  );

  const catalogData = catalog as { tables?: Record<string, unknown>[] } | undefined;
  const tables = useMemo(() => Array.isArray(catalogData?.tables) ? catalogData!.tables : [], [catalogData]);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => (tables.length > 0 ? buildInitialGraph(tables) : { nodes: [], edges: [] }),
    [tables]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync nodes when catalog loads
  useMemo(() => {
    if (initialNodes.length > 0) {
      setNodes(initialNodes);
      setEdges(initialEdges);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNodes.length]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const tableName = node.id;
      setSelectedTable(tableName);
      // Highlight selected node
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          data: { ...n.data, selected: n.id === tableName },
        }))
      );
      toast.info(`Loading lineage for ${tableName}…`);
    },
    [setNodes]
  );

  // Update focused lineage when query resolves
  useMemo(() => {
    if (lineageQuery.data) {
      setFocusedLineage(lineageQuery.data as Record<string, unknown>);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineageQuery.data]);

  const layerCounts = useMemo(() => {
    const counts: Record<string, number> = { bronze: 0, silver: 0, gold: 0 };
    tables.forEach((t) => {
      const l = String(t.layer ?? "bronze");
      counts[l] = (counts[l] ?? 0) + 1;
    });
    return counts;
  }, [tables]);

  const tableOptions = useMemo(
    () => tables.map((t) => String(t.table_name ?? t.name ?? "")),
    [tables]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading catalog…
      </div>
    );
  }

  if (tables.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
          <GitBranch className="w-10 h-10 text-muted-foreground/40" />
          <p className="text-muted-foreground text-sm">Ingestion engine offline — lineage unavailable</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-3 h-3 mr-1" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          {(["bronze", "silver", "gold"] as const).map((l) => (
            <Badge key={l} variant="outline" className={`text-xs ${LAYER_STYLE[l].badge}`}>
              {l.toUpperCase()} ({layerCounts[l] ?? 0})
            </Badge>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Search className="w-4 h-4 text-muted-foreground" />
          <Select value={selectedTable} onValueChange={(v) => { setSelectedTable(v); }}>
            <SelectTrigger className="w-64 h-8 text-xs bg-muted/20 border-border">
              <SelectValue placeholder="Jump to table…" />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {tableOptions.map((t) => (
                <SelectItem key={t} value={t} className="text-xs font-mono">{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Flow canvas */}
      <div style={{ height: 520, borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={handleNodeClick}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          colorMode="dark"
          minZoom={0.3}
          maxZoom={2}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="rgba(255,255,255,0.06)" />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={(n) => {
              const l = String((n.data as Record<string, unknown>).layer ?? "bronze");
              return l === "bronze" ? "#92400e" : l === "silver" ? "#475569" : "#b45309";
            }}
            style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
        </ReactFlow>
      </div>

      {/* Focused lineage panel */}
      {focusedLineage && !focusedLineage.error && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="w-4 h-4 text-yellow-400" />
              Lineage: <span className="font-mono text-yellow-300">{String(focusedLineage.table ?? selectedTable)}</span>
              <Badge variant="outline" className={`text-xs ml-1 ${LAYER_STYLE[String(focusedLineage.layer ?? "bronze")].badge}`}>
                {String(focusedLineage.layer ?? "bronze").toUpperCase()}
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              Source feeds → upstream tables → this table → downstream consumers
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <p className="text-muted-foreground font-medium mb-1">Source Feeds</p>
              {(Array.isArray(focusedLineage.source_feeds) ? focusedLineage.source_feeds as string[] : []).length === 0
                ? <p className="text-muted-foreground/50 italic">None</p>
                : (focusedLineage.source_feeds as string[]).map((f) => (
                  <div key={f} className="font-mono text-cyan-400 truncate">{f}</div>
                ))}
            </div>
            <div>
              <p className="text-muted-foreground font-medium mb-1">Upstream Tables</p>
              {(Array.isArray(focusedLineage.upstream_tables) ? focusedLineage.upstream_tables as string[] : []).length === 0
                ? <p className="text-muted-foreground/50 italic">None (source table)</p>
                : (focusedLineage.upstream_tables as string[]).map((t) => (
                  <div key={t} className="font-mono text-amber-400 truncate cursor-pointer hover:underline"
                    onClick={() => setSelectedTable(t)}>{t}</div>
                ))}
            </div>
            <div>
              <p className="text-muted-foreground font-medium mb-1">Downstream Tables</p>
              {(Array.isArray(focusedLineage.downstream_tables) ? focusedLineage.downstream_tables as string[] : []).length === 0
                ? <p className="text-muted-foreground/50 italic">None (terminal table)</p>
                : (focusedLineage.downstream_tables as string[]).map((t) => (
                  <div key={t} className="font-mono text-yellow-400 truncate cursor-pointer hover:underline"
                    onClick={() => setSelectedTable(t)}>{t}</div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
