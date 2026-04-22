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
import { PageSkeleton } from "@/components/PageSkeleton";
  Calendar,
  Plus,
  Play,
  PowerOff,
  RefreshCw,
  Clock,
  CheckCircle2,
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

const FREQUENCIES = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
] as const;

type ReportType = (typeof REPORT_TYPES)[number]["value"];
type AssetClass = (typeof ASSET_CLASSES)[number]["value"];
type Frequency = (typeof FREQUENCIES)[number]["value"];

export default function ReportSchedules() {
  const utils = trpc.useUtils();

  const [reportType, setReportType] = useState<ReportType>("EOD_SUMMARY");
  const [assetClass, setAssetClass] = useState<AssetClass | "ALL">("ALL");
  const [format, setFormat] = useState<"CSV" | "JSON">("CSV");
  const [frequency, setFrequency] = useState<Frequency>("DAILY");
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [timeUtc, setTimeUtc] = useState("15:00");
  const [runningId, setRunningId] = useState<number | null>(null);

  const { data: schedules = [], refetch, isLoading: schedulesLoading } = trpc.regulatoryReporting.adminListSchedules.useQuery();

  const createMutation = trpc.regulatoryReporting.adminCreateSchedule.useMutation({
    onSuccess: () => {
      toast.success("Schedule created");
      utils.regulatoryReporting.adminListSchedules.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const deactivateMutation = trpc.regulatoryReporting.adminDeactivateSchedule.useMutation({
    onSuccess: () => {
      toast.success("Schedule deactivated");
      utils.regulatoryReporting.adminListSchedules.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const runMutation = trpc.regulatoryReporting.adminRunSchedule.useMutation({
    onSuccess: (data) => {
      toast.success(`Report generated: ${data.rowCount} rows`);
      utils.regulatoryReporting.adminListSchedules.invalidate();
      utils.regulatoryReporting.adminListReports.invalidate();
      setRunningId(null);
    },
    onError: (err) => {
      toast.error(err.message);
      setRunningId(null);
    },
  });

  const handleCreate = () => {
    createMutation.mutate({
      reportType,
      assetClass: assetClass !== "ALL" ? assetClass : undefined,
      format,
      frequency,
      dayOfWeek: frequency === "WEEKLY" ? parseInt(dayOfWeek) : undefined,
      dayOfMonth: frequency === "MONTHLY" || frequency === "QUARTERLY" ? parseInt(dayOfMonth) : undefined,
      timeUtc,
    });
  };

  const handleRun = (scheduleId: number) => {
    setRunningId(scheduleId);
    runMutation.mutate({ scheduleId });
  };

  if (schedulesLoading) return <PageSkeleton cards={2} tableRows={10} tableCols={5} />;
  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Report Schedules</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Automate regulatory report generation on a recurring schedule
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Create Schedule Form */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="w-4 h-4 text-emerald-400" />
            Create New Schedule
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
              <Label className="text-xs text-muted-foreground">Frequency</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as Frequency)}>
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {frequency === "WEEKLY" && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Day of Week</Label>
                <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                  <SelectTrigger className="bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((d, i) => (
                      <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {(frequency === "MONTHLY" || frequency === "QUARTERLY") && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Day of Month</Label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(e.target.value)}
                  className="bg-background"
                />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Time (UTC)</Label>
              <Input
                type="time"
                value={timeUtc}
                onChange={(e) => setTimeUtc(e.target.value)}
                className="bg-background"
              />
            </div>
          </div>
          <Button
            onClick={handleCreate}
            disabled={createMutation.isPending}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {createMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</>
            ) : (
              <><Calendar className="w-4 h-4 mr-2" />Create Schedule</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Schedules Table */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base">Active Schedules</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Report Type</TableHead>
                <TableHead className="text-muted-foreground">Asset Class</TableHead>
                <TableHead className="text-muted-foreground">Format</TableHead>
                <TableHead className="text-muted-foreground">Frequency</TableHead>
                <TableHead className="text-muted-foreground">Time (UTC)</TableHead>
                <TableHead className="text-muted-foreground">Last Run</TableHead>
                <TableHead className="text-muted-foreground">Next Run</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-right text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    No schedules configured. Create one above to automate report generation.
                  </TableCell>
                </TableRow>
              ) : (
                schedules.map((s) => (
                  <TableRow key={s.id} className="border-border hover:bg-muted/30">
                    <TableCell className="font-medium text-sm text-foreground">
                      {REPORT_TYPES.find((t) => t.value === s.reportType)?.label ?? s.reportType}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.assetClass ?? "All"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{s.format}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-foreground">{s.frequency}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {s.timeUtc}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : "Never"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell>
                      {s.isActive ? (
                        <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                          <CheckCircle2 className="w-3 h-3 mr-1" />Active
                        </Badge>
                      ) : (
                        <Badge className="bg-muted text-muted-foreground">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {s.isActive && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-blue-400 hover:text-blue-300"
                              onClick={() => handleRun(s.id)}
                              disabled={runningId === s.id}
                              title="Run now"
                            >
                              {runningId === s.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Play className="w-4 h-4" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-red-400 hover:text-red-300"
                              onClick={() => deactivateMutation.mutate({ scheduleId: s.id })}
                              disabled={deactivateMutation.isPending}
                              title="Deactivate"
                            >
                              <PowerOff className="w-4 h-4" />
                            </Button>
                          </>
                        )}
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
