import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Play, RefreshCw, XCircle, CheckCircle2,
  AlertTriangle, Zap, Activity, List, Send,
} from "lucide-react";

const STATUS_STYLES: Record<string, string> = {
  RUNNING:   "bg-blue-500/10 text-blue-400 border-blue-500/20",
  COMPLETED: "bg-green-500/10 text-green-400 border-green-500/20",
  FAILED:    "bg-red-500/10 text-red-400 border-red-500/20",
  CANCELLED: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  TIMED_OUT: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${STATUS_STYLES[status] ?? "bg-muted text-muted-foreground border-border"}`}>
      {status}
    </span>
  );
}

export default function TemporalWorkflows() {
  const [tab, setTab] = useState("registry");
  const [selectedWorkflowName, setSelectedWorkflowName] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [triggerInput, setTriggerInput] = useState("{}");
  const [statusWorkflowId, setStatusWorkflowId] = useState("");

  const utils = trpc.useUtils();

  // Get workflow registry (public)
  const { data: registry, isLoading: registryLoading } = trpc.temporal.getRegistry.useQuery();

  // List recent workflow runs (admin)
  const { data: listData, isLoading: listLoading } = trpc.temporal.listWorkflows.useQuery(
    {
      workflowName: selectedWorkflowName || undefined,
      limit: 50,
    },
    { refetchInterval: 15000 },
  );

  // Get status of a specific workflow run
  const { data: statusData, isLoading: statusLoading } = trpc.temporal.getStatus.useQuery(
    { workflowId: statusWorkflowId },
    { enabled: !!statusWorkflowId, refetchInterval: 5000 },
  );

  const triggerMut = trpc.temporal.trigger.useMutation({
    onSuccess: (data: { workflowId: string }) => {
      toast.success(`Workflow triggered — ID: ${data.workflowId}`);
      setStatusWorkflowId(data.workflowId);
      setSelectedRunId(data.workflowId);
      setTab("status");
      utils.temporal.listWorkflows.invalidate();
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const cancelMut = trpc.temporal.cancel.useMutation({
    onSuccess: () => { toast.success("Workflow cancelled"); utils.temporal.listWorkflows.invalidate(); },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const handleTrigger = () => {
    if (!selectedWorkflowName) { toast.error("Select a workflow type"); return; }
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(triggerInput); } catch { toast.error("Invalid JSON input"); return; }
    triggerMut.mutate({ workflowName: selectedWorkflowName, payload });
  };

  const workflows = listData ?? [];
  const running   = workflows.filter((w: { recentRuns: { status: string }[] }) =>
    w.recentRuns.some((r) => r.status === "RUNNING")).length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-purple-500/10">
          <Activity className="h-5 w-5 text-purple-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Temporal Workflows</h1>
          <p className="text-sm text-muted-foreground">Monitor, trigger, and cancel long-running business workflows</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Registered Workflows", value: registry?.length ?? 0, icon: <List className="h-4 w-4 text-purple-400" /> },
          { label: "Active Runs", value: running, icon: <RefreshCw className="h-4 w-4 text-blue-400" /> },
          { label: "Total Listed", value: workflows.length, icon: <CheckCircle2 className="h-4 w-4 text-green-400" /> },
          { label: "Status Checks", value: statusData ? 1 : 0, icon: <AlertTriangle className="h-4 w-4 text-yellow-400" /> },
        ].map((s) => (
          <Card key={s.label} className="bg-card/50 border-border/50">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-2xl font-bold text-foreground mt-0.5">{s.value}</p>
                </div>
                {s.icon}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-muted/30">
          <TabsTrigger value="registry"><List className="h-3.5 w-3.5 mr-1.5" />Registry</TabsTrigger>
          <TabsTrigger value="runs"><Activity className="h-3.5 w-3.5 mr-1.5" />Recent Runs</TabsTrigger>
          <TabsTrigger value="trigger"><Play className="h-3.5 w-3.5 mr-1.5" />Trigger</TabsTrigger>
          <TabsTrigger value="status"><Zap className="h-3.5 w-3.5 mr-1.5" />Status</TabsTrigger>
        </TabsList>

        {/* ── Registry ── */}
        <TabsContent value="registry" className="mt-4">
          <Card className="bg-card/50 border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <List className="h-4 w-4 text-purple-400" />
                Workflow Registry
                {registryLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!registry || registry.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No workflows registered</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {registry.map((wf: { name: string; taskQueue: string; description?: string | null }) => (
                    <div key={wf.name} className="p-3 rounded-lg bg-background/30 border border-border/30">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium text-foreground">{wf.name}</p>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs text-purple-400 hover:text-purple-300 px-2"
                          onClick={() => { setSelectedWorkflowName(wf.name); setTab("trigger"); }}
                        >
                          <Play className="h-3 w-3 mr-1" />Trigger
                        </Button>
                      </div>
                      {wf.description && <p className="text-xs text-muted-foreground">{wf.description}</p>}
                      <code className="text-xs text-purple-400 font-mono">queue: {wf.taskQueue}</code>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Recent Runs ── */}
        <TabsContent value="runs" className="mt-4">
          <Card className="bg-card/50 border-border/50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-purple-400" />
                  Recent Runs
                  {listLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </CardTitle>
                <Select value={selectedWorkflowName || "all"} onValueChange={(v) => setSelectedWorkflowName(v === "all" ? "" : v)}>
                  <SelectTrigger className="h-8 w-52 text-xs bg-background/50">
                    <SelectValue placeholder="All workflow types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {registry?.map((wf: { name: string }) => (
                      <SelectItem key={wf.name} value={wf.name}>{wf.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {workflows.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No recent runs</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {workflows.map((wf: {
                    workflowName: string;
                    taskQueue: string;
                    description?: string | null;
                    recentRuns: { workflowId: string; status: string; startedAt: string }[];
                  }) => (
                    <div key={wf.workflowName} className="p-3 rounded-lg bg-background/30 border border-border/30">
                      <p className="text-sm font-semibold text-foreground mb-2">{wf.workflowName}</p>
                      {wf.recentRuns.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No recent runs</p>
                      ) : (
                        <div className="space-y-1.5">
                          {wf.recentRuns.map((run) => (
                            <div
                              key={run.workflowId}
                              className="flex items-center justify-between text-xs cursor-pointer hover:bg-background/50 rounded p-1.5 transition-colors"
                              onClick={() => { setStatusWorkflowId(run.workflowId); setTab("status"); }}
                            >
                              <div className="flex items-center gap-2">
                                <StatusBadge status={run.status} />
                                <code className="text-muted-foreground font-mono">{run.workflowId}</code>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</span>
                                {run.status === "RUNNING" && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-5 text-xs text-red-400 hover:text-red-300 px-1.5"
                                    onClick={(e) => { e.stopPropagation(); cancelMut.mutate({ workflowId: run.workflowId }); }}
                                  >
                                    <XCircle className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Trigger ── */}
        <TabsContent value="trigger" className="mt-4">
          <div className="grid grid-cols-2 gap-6">
            <Card className="bg-card/50 border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Trigger Workflow</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Workflow Type</Label>
                  <Select value={selectedWorkflowName} onValueChange={setSelectedWorkflowName}>
                    <SelectTrigger className="bg-background/50">
                      <SelectValue placeholder="Select workflow…" />
                    </SelectTrigger>
                    <SelectContent>
                      {registry?.map((wf: { name: string }) => (
                        <SelectItem key={wf.name} value={wf.name}>{wf.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Payload (JSON)</Label>
                  <textarea
                    className="w-full h-36 rounded-md border border-input bg-background/50 px-3 py-2 text-sm font-mono text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                    value={triggerInput}
                    onChange={(e) => setTriggerInput(e.target.value)}
                  />
                </div>
                <Button
                  onClick={handleTrigger}
                  disabled={triggerMut.isPending}
                  className="w-full bg-purple-600 hover:bg-purple-700"
                >
                  {triggerMut.isPending ? (
                    <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Triggering…</>
                  ) : (
                    <><Play className="h-4 w-4 mr-2" />Trigger Workflow</>
                  )}
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Workflow Catalogue</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {registry?.map((wf: { name: string; taskQueue: string; description?: string | null }) => (
                    <div
                      key={wf.name}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedWorkflowName === wf.name
                          ? "bg-purple-500/10 border-purple-500/30"
                          : "bg-background/30 border-border/30 hover:bg-background/50"
                      }`}
                      onClick={() => setSelectedWorkflowName(wf.name)}
                    >
                      <p className="text-sm font-medium text-foreground">{wf.name}</p>
                      {wf.description && <p className="text-xs text-muted-foreground mt-0.5">{wf.description}</p>}
                      <code className="text-xs text-purple-400 font-mono">queue: {wf.taskQueue}</code>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Status ── */}
        <TabsContent value="status" className="mt-4">
          <Card className="bg-card/50 border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-400" />
                Workflow Status Lookup
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Enter workflow ID…"
                  value={statusWorkflowId}
                  onChange={(e) => setStatusWorkflowId(e.target.value)}
                  className="bg-background/50 font-mono text-sm"
                />
                <Button
                  variant="outline"
                  onClick={() => utils.temporal.getStatus.invalidate({ workflowId: statusWorkflowId })}
                  disabled={!statusWorkflowId}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>

              {statusLoading && statusWorkflowId && (
                <div className="text-center py-8 text-muted-foreground">
                  <RefreshCw className="h-6 w-6 mx-auto mb-2 animate-spin opacity-40" />
                  <p className="text-sm">Loading…</p>
                </div>
              )}

              {statusData && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">
                      Available: <strong className={statusData.available ? "text-green-400" : "text-red-400"}>
                        {statusData.available ? "Yes" : "No"}
                      </strong>
                    </span>
                  </div>
                  {statusData.result && (
                    <div className="rounded-lg bg-background/30 border border-border/30 p-3">
                      <p className="text-xs text-muted-foreground font-medium mb-1">Query Result</p>
                      <pre className="text-xs text-foreground/80 overflow-auto max-h-48 font-mono">
                        {JSON.stringify(statusData.result, null, 2)}
                      </pre>
                    </div>
                  )}
                  {!statusData.available && (
                    <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-3">
                      <p className="text-sm text-yellow-400">Workflow not found or not running</p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-400 border-red-500/30 hover:bg-red-500/10"
                      onClick={() => cancelMut.mutate({ workflowId: statusWorkflowId })}
                      disabled={cancelMut.isPending || !statusWorkflowId}
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1.5" />Cancel Workflow
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
