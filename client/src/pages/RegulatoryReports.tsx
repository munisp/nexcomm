import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  FileText,
  Download,
  Plus,
  Trash2,
  RefreshCw,
  BarChart3,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
} from "lucide-react";

const REPORT_TYPES = [
  { value: "POSITION_REPORT", label: "Position Report" },
  { value: "TRADE_CONFIRMATION", label: "Trade Confirmation" },
  { value: "EOD_SUMMARY", label: "End-of-Day Summary" },
  { value: "CAMA_FILING", label: "CAMA Filing" },
  { value: "SEC_FILING", label: "SEC Filing" },
  { value: "CBN_FILING", label: "CBN Filing" },
] as const;

const ASSET_CLASSES = [
  { value: "COMMODITY", label: "Commodity" },
  { value: "EQUITY", label: "Equity" },
  { value: "FX", label: "FX / Forex" },
  { value: "BOND", label: "Bond" },
] as const;

type ReportType = (typeof REPORT_TYPES)[number]["value"];
type AssetClass = (typeof ASSET_CLASSES)[number]["value"];

function statusBadge(status: string) {
  switch (status) {
    case "READY":
      return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30"><CheckCircle2 className="w-3 h-3 mr-1" />Ready</Badge>;
    case "GENERATING":
      return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Generating</Badge>;
    case "FAILED":
      return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><AlertCircle className="w-3 h-3 mr-1" />Failed</Badge>;
    default:
      return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
  }
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function RegulatoryReports() {
  const utils = trpc.useUtils();

  // Generate form state
  const [reportType, setReportType] = useState<ReportType>("EOD_SUMMARY");
  const [assetClass, setAssetClass] = useState<AssetClass | "ALL">("ALL");
  const [format, setFormat] = useState<"CSV" | "JSON">("CSV");
  const [periodStart, setPeriodStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 16);
  });
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 16));
  const [filterType, setFilterType] = useState<ReportType | "ALL">("ALL");
  const [downloadContent, setDownloadContent] = useState<{ content: string; format: string; name: string } | null>(null);

  // Queries
  const { data: stats } = trpc.regulatoryReporting.adminGetReportStats.useQuery();
  const { data: reports = [], refetch: refetchReports } = trpc.regulatoryReporting.adminListReports.useQuery({
    reportType: filterType !== "ALL" ? filterType : undefined,
    limit: 100,
  });

  // Mutations
  const generateMutation = trpc.regulatoryReporting.adminGenerateReport.useMutation({
    onSuccess: () => {
      toast.success("Report generated successfully");
      utils.regulatoryReporting.adminListReports.invalidate();
      utils.regulatoryReporting.adminGetReportStats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.regulatoryReporting.adminDeleteReport.useMutation({
    onSuccess: () => {
      toast.success("Report deleted");
      utils.regulatoryReporting.adminListReports.invalidate();
      utils.regulatoryReporting.adminGetReportStats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const downloadQuery = trpc.regulatoryReporting.adminDownloadReport.useQuery(
    { reportId: -1 },
    { enabled: false }
  );

  const handleGenerate = () => {
    generateMutation.mutate({
      reportType,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      assetClass: assetClass !== "ALL" ? assetClass : undefined,
      format,
    });
  };

  const handleDownload = async (reportId: number, rType: string, rFormat: string) => {
    try {
      const result = await utils.regulatoryReporting.adminDownloadReport.fetch({ reportId });
      const blob = new Blob([result.content], {
        type: rFormat === "JSON" ? "application/json" : "text/csv",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${rType}_${new Date().toISOString().slice(0, 10)}.${rFormat.toLowerCase()}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Download started");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Regulatory Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generate and download CAMA, SEC, CBN, and internal regulatory reports
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetchReports()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Reports", value: stats?.total ?? 0, icon: FileText, color: "text-blue-400" },
          { label: "Ready", value: stats?.ready ?? 0, icon: CheckCircle2, color: "text-emerald-400" },
          { label: "Generating", value: stats?.generating ?? 0, icon: Loader2, color: "text-yellow-400" },
          { label: "Failed", value: stats?.failed ?? 0, icon: AlertCircle, color: "text-red-400" },
        ].map((s) => (
          <Card key={s.label} className="bg-card border-border">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <s.icon className={`w-5 h-5 ${s.color}`} />
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-xl font-bold text-foreground">{s.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Generate Report Form */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="w-4 h-4 text-emerald-400" />
            Generate New Report
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Report Type</Label>
              <Select value={reportType} onValueChange={(v) => setReportType(v as ReportType)}>
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map((rt) => (
                    <SelectItem key={rt.value} value={rt.value}>{rt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Asset Class</Label>
              <Select value={assetClass} onValueChange={(v) => setAssetClass(v as AssetClass | "ALL")}>
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Asset Classes</SelectItem>
                  {ASSET_CLASSES.map((ac) => (
                    <SelectItem key={ac.value} value={ac.value}>{ac.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Format</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as "CSV" | "JSON")}>
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CSV">CSV</SelectItem>
                  <SelectItem value="JSON">JSON</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Period Start</Label>
              <Input
                type="datetime-local"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="bg-background"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Period End</Label>
              <Input
                type="datetime-local"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="bg-background"
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={handleGenerate}
                disabled={generateMutation.isPending}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {generateMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</>
                ) : (
                  <><BarChart3 className="w-4 h-4 mr-2" />Generate Report</>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reports Table */}
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Report History</CardTitle>
            <Select value={filterType} onValueChange={(v) => setFilterType(v as ReportType | "ALL")}>
              <SelectTrigger className="w-48 bg-background text-sm">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Types</SelectItem>
                {REPORT_TYPES.map((rt) => (
                  <SelectItem key={rt.value} value={rt.value}>{rt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Type</TableHead>
                <TableHead className="text-muted-foreground">Period</TableHead>
                <TableHead className="text-muted-foreground">Asset Class</TableHead>
                <TableHead className="text-muted-foreground">Format</TableHead>
                <TableHead className="text-muted-foreground">Rows</TableHead>
                <TableHead className="text-muted-foreground">Size</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-muted-foreground">Generated</TableHead>
                <TableHead className="text-right text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    No reports generated yet. Use the form above to generate your first report.
                  </TableCell>
                </TableRow>
              ) : (
                reports.map((r) => (
                  <TableRow key={r.id} className="border-border hover:bg-muted/30">
                    <TableCell className="font-medium text-sm text-foreground">
                      {REPORT_TYPES.find((t) => t.value === r.reportType)?.label ?? r.reportType}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(r.periodStart).toLocaleDateString()} –{" "}
                      {new Date(r.periodEnd).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.assetClass ?? "All"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{r.format}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-foreground">
                      {r.rowCount?.toLocaleString() ?? 0}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatBytes(r.fileSize)}
                    </TableCell>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {r.status === "READY" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-emerald-400 hover:text-emerald-300"
                            onClick={() => handleDownload(r.id, r.reportType, r.format)}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-400 hover:text-red-300"
                          onClick={() => deleteMutation.mutate({ reportId: r.id })}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
