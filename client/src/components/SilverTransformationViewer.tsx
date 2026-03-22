/**
 * SilverTransformationViewer.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Displays the full Bronze → Silver transformation pipeline for a selected
 * Silver layer table:
 *   - Bronze source tables
 *   - Deduplication rule (merge key, strategy, partition)
 *   - Data quality rules with pass rates
 *   - Enrichment joins with reference tables
 *   - Schema diff (columns added / removed / renamed)
 *   - Spark ETL job configuration and last run stats
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ArrowRight,
  Database,
  GitMerge,
  ShieldCheck,
  Layers,
  Zap,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SilverTableSummary {
  table_name: string;
  description: string;
  bronze_sources_count: number;
  quality_rules_count: number;
  enrichment_joins_count: number;
  row_count: number;
  last_updated: string;
  quality_pass_rate_pct: number;
}

interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  description: string;
}

interface QualityRule {
  rule: string;
  columns?: string[];
  column?: string;
  values?: string[];
  min?: number;
  max?: number;
  with_table?: string;
  description?: string;
}

interface EnrichmentJoin {
  table: string;
  on: string;
  fields: string[];
}

interface SparkJob {
  job_id: string;
  name: string;
  description: string;
  source_layer: string;
  target_layer: string;
  schedule: string;
  last_run: string;
  last_duration_sec: number;
  records_processed: number;
  status: string;
  runs_total: number;
  runs_failed: number;
}

interface SilverTransformation {
  table_name: string;
  description: string;
  bronze_sources: string[];
  dedup_rule: {
    merge_key: string[];
    strategy: string;
    partition_by: string[];
    primary_key: string[];
  };
  quality_rules: QualityRule[];
  quality_pass_rate_pct: number;
  enrichment_joins: EnrichmentJoin[];
  schema_diff: {
    bronze_columns: SchemaColumn[];
    silver_columns: SchemaColumn[];
    added_columns: string[];
    removed_columns: string[];
  };
  spark_job: SparkJob | null;
  row_count: number;
  last_updated: string;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SchemaTable({ columns, addedNames }: { columns: SchemaColumn[]; addedNames?: string[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[180px]">Column</TableHead>
          <TableHead className="w-[140px]">Type</TableHead>
          <TableHead className="w-[80px]">Nullable</TableHead>
          <TableHead>Description</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {columns.map((col) => {
          const isAdded = addedNames?.includes(col.name);
          return (
            <TableRow key={col.name} className={isAdded ? "bg-emerald-950/30" : ""}>
              <TableCell className="font-mono text-xs font-medium">
                {col.name}
                {isAdded && (
                  <Badge variant="outline" className="ml-2 text-emerald-400 border-emerald-700 text-[10px] py-0">
                    +added
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-amber-400">
                  {col.type}
                </code>
              </TableCell>
              <TableCell>
                <span className={col.nullable ? "text-muted-foreground text-xs" : "text-xs font-semibold text-red-400"}>
                  {col.nullable ? "YES" : "NO"}
                </span>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{col.description}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function QualityRuleBadge({ rule }: { rule: string }) {
  const colors: Record<string, string> = {
    NOT_NULL: "bg-blue-900/40 text-blue-300 border-blue-700",
    POSITIVE: "bg-green-900/40 text-green-300 border-green-700",
    RANGE: "bg-purple-900/40 text-purple-300 border-purple-700",
    IN_SET: "bg-amber-900/40 text-amber-300 border-amber-700",
    RECONCILE: "bg-cyan-900/40 text-cyan-300 border-cyan-700",
    BALANCE: "bg-rose-900/40 text-rose-300 border-rose-700",
    UNIQUE: "bg-indigo-900/40 text-indigo-300 border-indigo-700",
  };
  const cls = colors[rule] ?? "bg-muted text-muted-foreground border-border";
  return (
    <Badge variant="outline" className={`text-[11px] font-mono ${cls}`}>
      {rule}
    </Badge>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function SilverTransformationViewer() {
  const [selectedTable, setSelectedTable] = useState<string>("");

  const { data: listData, isLoading: listLoading } = trpc.lakehouse.listSilverTables.useQuery();
  const tables: SilverTableSummary[] = (listData as any)?.tables ?? [];

  const { data: transformData, isLoading: transformLoading, refetch } =
    trpc.lakehouse.getSilverTransformation.useQuery(
      { tableName: selectedTable },
      { enabled: !!selectedTable }
    );

  const transform = (transformData as any)?.data as SilverTransformation | null;

  return (
    <div className="space-y-6">
      {/* Table Selector */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <Select value={selectedTable} onValueChange={setSelectedTable}>
            <SelectTrigger className="bg-card border-border">
              <SelectValue placeholder={listLoading ? "Loading tables…" : "Select a Silver table to inspect"} />
            </SelectTrigger>
            <SelectContent>
              {tables.map((t) => (
                <SelectItem key={t.table_name} value={t.table_name}>
                  <span className="font-mono text-sm">{t.table_name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">— {t.description}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedTable && (
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={transformLoading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${transformLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        )}
      </div>

      {/* Table Summary Grid */}
      {tables.length > 0 && !selectedTable && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {tables.map((t) => (
            <Card
              key={t.table_name}
              className="cursor-pointer hover:border-primary/50 transition-colors bg-card/60"
              onClick={() => setSelectedTable(t.table_name)}
            >
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-mono">{t.table_name}</CardTitle>
                <CardDescription className="text-xs">{t.description}</CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="text-muted-foreground">Bronze sources</div>
                  <div className="font-medium text-right">{t.bronze_sources_count}</div>
                  <div className="text-muted-foreground">Quality rules</div>
                  <div className="font-medium text-right">{t.quality_rules_count}</div>
                  <div className="text-muted-foreground">Enrichment joins</div>
                  <div className="font-medium text-right">{t.enrichment_joins_count}</div>
                  <div className="text-muted-foreground">DQ pass rate</div>
                  <div className={`font-semibold text-right ${t.quality_pass_rate_pct >= 99 ? "text-emerald-400" : "text-amber-400"}`}>
                    {t.quality_pass_rate_pct.toFixed(2)}%
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Transformation Detail */}
      {selectedTable && transformLoading && (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          Loading transformation details…
        </div>
      )}

      {selectedTable && !transformLoading && !transform && (
        <Card className="border-amber-700/40 bg-amber-950/20">
          <CardContent className="py-6 text-center text-amber-400 text-sm">
            <AlertTriangle className="h-5 w-5 mx-auto mb-2" />
            Ingestion engine offline — transformation details unavailable.
          </CardContent>
        </Card>
      )}

      {transform && (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-mono text-lg font-semibold">{transform.table_name}</h3>
              <p className="text-sm text-muted-foreground mt-0.5">{transform.description}</p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span className="text-emerald-400 font-semibold">{transform.quality_pass_rate_pct.toFixed(2)}%</span>
              <span className="text-muted-foreground">DQ pass rate</span>
            </div>
          </div>

          {/* Pipeline Flow */}
          <Card className="bg-card/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ArrowRight className="h-4 w-4 text-primary" />
                Bronze → Silver Pipeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-2">
                {transform.bronze_sources.map((src, i) => (
                  <div key={src} className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs bg-amber-950/30 text-amber-300 border-amber-700">
                      <Database className="h-3 w-3 mr-1" />
                      {src}
                    </Badge>
                    {i < transform.bronze_sources.length - 1 && (
                      <span className="text-muted-foreground text-xs">+</span>
                    )}
                  </div>
                ))}
                <ArrowRight className="h-4 w-4 text-muted-foreground mx-1" />
                <Badge variant="outline" className="font-mono text-xs bg-blue-950/30 text-blue-300 border-blue-700">
                  <Layers className="h-3 w-3 mr-1" />
                  {transform.table_name}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Accordion type="multiple" defaultValue={["dedup", "quality", "schema"]} className="space-y-2">
            {/* Deduplication Rule */}
            <AccordionItem value="dedup" className="border rounded-lg bg-card/60 px-4">
              <AccordionTrigger className="text-sm font-medium hover:no-underline">
                <div className="flex items-center gap-2">
                  <GitMerge className="h-4 w-4 text-purple-400" />
                  Deduplication Rule
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-2 gap-4 pt-2 pb-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Strategy</div>
                    <Badge variant="outline" className="font-mono text-xs bg-purple-950/30 text-purple-300 border-purple-700">
                      {transform.dedup_rule.strategy}
                    </Badge>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Merge Key</div>
                    <div className="flex flex-wrap gap-1">
                      {transform.dedup_rule.merge_key.map((k) => (
                        <code key={k} className="text-xs bg-muted px-1.5 py-0.5 rounded">{k}</code>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Primary Key</div>
                    <div className="flex flex-wrap gap-1">
                      {transform.dedup_rule.primary_key.map((k) => (
                        <code key={k} className="text-xs bg-muted px-1.5 py-0.5 rounded">{k}</code>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Partition By</div>
                    <div className="flex flex-wrap gap-1">
                      {transform.dedup_rule.partition_by.map((k) => (
                        <code key={k} className="text-xs bg-muted px-1.5 py-0.5 rounded">{k}</code>
                      ))}
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Data Quality Rules */}
            <AccordionItem value="quality" className="border rounded-lg bg-card/60 px-4">
              <AccordionTrigger className="text-sm font-medium hover:no-underline">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  Data Quality Rules ({transform.quality_rules.length})
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2 pt-2 pb-3">
                  {transform.quality_rules.map((qr, i) => (
                    <div key={i} className="flex items-start gap-3 p-2 rounded bg-muted/30">
                      <QualityRuleBadge rule={qr.rule} />
                      <div className="text-xs text-muted-foreground flex-1">
                        {qr.columns && <span>columns: <code className="text-foreground">{qr.columns.join(", ")}</code></span>}
                        {qr.column && <span>column: <code className="text-foreground">{qr.column}</code></span>}
                        {qr.values && <span className="ml-2">∈ [{qr.values.join(", ")}]</span>}
                        {qr.min !== undefined && qr.max !== undefined && (
                          <span className="ml-2">range [{qr.min}, {qr.max}]</span>
                        )}
                        {qr.with_table && <span className="ml-2">reconcile with <code className="text-foreground">{qr.with_table}</code></span>}
                        {qr.description && <span className="ml-2 italic">{qr.description}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Enrichment Joins */}
            {transform.enrichment_joins.length > 0 && (
              <AccordionItem value="enrichment" className="border rounded-lg bg-card/60 px-4">
                <AccordionTrigger className="text-sm font-medium hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Plus className="h-4 w-4 text-cyan-400" />
                    Enrichment Joins ({transform.enrichment_joins.length})
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2 pt-2 pb-3">
                    {transform.enrichment_joins.map((ej, i) => (
                      <div key={i} className="flex items-start gap-3 p-2 rounded bg-muted/30 text-xs">
                        <Badge variant="outline" className="font-mono text-[11px] bg-cyan-950/30 text-cyan-300 border-cyan-700 whitespace-nowrap">
                          {ej.table}
                        </Badge>
                        <div className="text-muted-foreground">
                          <span>on <code className="text-foreground">{ej.on}</code></span>
                          <span className="ml-2">→ fields: <code className="text-foreground">{ej.fields.join(", ")}</code></span>
                        </div>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Schema Diff */}
            <AccordionItem value="schema" className="border rounded-lg bg-card/60 px-4">
              <AccordionTrigger className="text-sm font-medium hover:no-underline">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-amber-400" />
                  Schema Diff
                  {transform.schema_diff.added_columns.length > 0 && (
                    <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-700 ml-1">
                      +{transform.schema_diff.added_columns.length} added
                    </Badge>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-2 pb-3">
                  <div>
                    <div className="text-xs font-semibold text-amber-400 mb-2 flex items-center gap-1">
                      <Database className="h-3 w-3" /> Bronze Schema
                    </div>
                    <SchemaTable columns={transform.schema_diff.bronze_columns} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-blue-400 mb-2 flex items-center gap-1">
                      <Layers className="h-3 w-3" /> Silver Schema
                      <span className="text-muted-foreground font-normal ml-1">(enriched columns highlighted)</span>
                    </div>
                    <SchemaTable
                      columns={transform.schema_diff.silver_columns}
                      addedNames={transform.schema_diff.added_columns}
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Spark Job */}
            {transform.spark_job && (
              <AccordionItem value="spark" className="border rounded-lg bg-card/60 px-4">
                <AccordionTrigger className="text-sm font-medium hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-yellow-400" />
                    Spark ETL Job — {transform.spark_job.name}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="grid grid-cols-2 gap-3 pt-2 pb-3 text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Schedule</div>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{transform.spark_job.schedule}</code>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Last Status</div>
                      <Badge variant="outline" className={`text-xs ${transform.spark_job.status === "COMPLETED" ? "text-emerald-400 border-emerald-700" : "text-amber-400 border-amber-700"}`}>
                        {transform.spark_job.status}
                      </Badge>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Last Run</div>
                      <span className="text-xs">{new Date(transform.spark_job.last_run).toLocaleString()}</span>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Duration</div>
                      <span className="text-xs">{transform.spark_job.last_duration_sec.toFixed(1)}s</span>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Records Processed</div>
                      <span className="text-xs font-medium">{transform.spark_job.records_processed.toLocaleString()}</span>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Run History</div>
                      <span className="text-xs">
                        {transform.spark_job.runs_total} total,{" "}
                        <span className={transform.spark_job.runs_failed > 0 ? "text-red-400" : "text-emerald-400"}>
                          {transform.spark_job.runs_failed} failed
                        </span>
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{transform.spark_job.description}</p>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        </div>
      )}
    </div>
  );
}
