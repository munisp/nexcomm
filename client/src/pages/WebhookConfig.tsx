/**
 * NEXCOM Exchange — Webhook Configuration
 * Admin-only page for managing outbound security event webhook endpoints.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Webhook, Plus, Trash2, TestTube2, RefreshCw, Eye, EyeOff, Shield, CheckCircle, XCircle } from "lucide-react";

type EventFilter = "ALL" | "HIGH_AND_CRITICAL" | "CRITICAL_ONLY";

const EVENT_FILTER_LABELS: Record<EventFilter, string> = {
  ALL: "All Events",
  HIGH_AND_CRITICAL: "High & Critical",
  CRITICAL_ONLY: "Critical Only",
};

const EVENT_FILTER_COLORS: Record<EventFilter, string> = {
  ALL: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  HIGH_AND_CRITICAL: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  CRITICAL_ONLY: "bg-red-500/20 text-red-400 border-red-500/30",
};

export default function WebhookConfig() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [showInactive, setShowInactive] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);

  const [form, setForm] = useState({
    name: "",
    url: "",
    secret: "",
    eventFilter: "HIGH_AND_CRITICAL" as EventFilter,
  });

  const utils = trpc.useUtils();

  const { data: webhooks = [], isLoading, refetch } = trpc.webhook.adminList.useQuery(
    { includeInactive: showInactive },
    { enabled: isAdmin }
  );

  const createMutation = trpc.webhook.adminCreate.useMutation({
    onSuccess: () => {
      toast.success("Webhook endpoint created");
      utils.webhook.adminList.invalidate();
      setCreateOpen(false);
      setForm({ name: "", url: "", secret: "", eventFilter: "HIGH_AND_CRITICAL" });
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.webhook.adminUpdate.useMutation({
    onSuccess: () => {
      toast.success("Webhook updated");
      utils.webhook.adminList.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.webhook.adminDelete.useMutation({
    onSuccess: () => {
      toast.success("Webhook deleted");
      utils.webhook.adminList.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const testMutation = trpc.webhook.adminTest.useMutation({
    onSuccess: (data) => {
      if ((data as any).success) {
        toast.success("Test payload delivered successfully");
      } else {
        toast.error(`Test failed: ${(data as any).error ?? "Unknown error"}`);
      }
      setTestingId(null);
    },
    onError: (e) => {
      toast.error(`Test failed: ${e.message}`);
      setTestingId(null);
    },
  });

  const handleTest = (id: number) => {
    setTestingId(id);
    testMutation.mutate({ id });
  };

  const handleToggleActive = (id: number, isActive: boolean) => {
    updateMutation.mutate({ id, isActive });
  };

  if (!isAdmin) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-64 text-muted-foreground">
        <Shield className="w-12 h-12 mb-4 opacity-30" />
        <p className="text-lg font-medium">Admin access required</p>
        <p className="text-sm mt-1">Only administrators can manage webhook configurations.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Webhook className="w-6 h-6 text-primary" />
            Webhook Configuration
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage outbound HTTP endpoints for security event notifications
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch
              checked={showInactive}
              onCheckedChange={setShowInactive}
              id="show-inactive"
            />
            <Label htmlFor="show-inactive">Show inactive</Label>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> Add Webhook
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-card/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Total Endpoints</p>
            <p className="text-2xl font-bold">{webhooks.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Active</p>
            <p className="text-2xl font-bold text-green-400">{webhooks.filter(w => w.isActive).length}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Failed Deliveries</p>
            <p className="text-2xl font-bold text-red-400">{webhooks.reduce((sum, w) => sum + (w.failureCount ?? 0), 0)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Webhook list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Registered Endpoints</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading...
            </div>
          ) : webhooks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Webhook className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">No webhook endpoints configured</p>
              <p className="text-xs mt-1">Add an endpoint to receive security event notifications</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead>Event Filter</TableHead>
                    <TableHead>Secret</TableHead>
                    <TableHead>Failures</TableHead>
                    <TableHead>Last Delivery</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {webhooks.map(w => (
                    <TableRow key={w.id} className={!w.isActive ? "opacity-50" : ""}>
                      <TableCell className="font-medium">{w.name}</TableCell>
                      <TableCell className="font-mono text-xs max-w-[200px] truncate" title={w.url}>
                        {w.url}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${EVENT_FILTER_COLORS[w.eventFilter as EventFilter]}`}>
                          {EVENT_FILTER_LABELS[w.eventFilter as EventFilter]}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {w.secret ? "••••••••" : <span className="italic">none</span>}
                      </TableCell>
                      <TableCell>
                        <span className={`text-sm font-medium ${(w.failureCount ?? 0) > 0 ? "text-red-400" : "text-muted-foreground"}`}>
                          {w.failureCount ?? 0}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {w.lastTriggeredAt ? new Date(w.lastTriggeredAt).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={w.isActive}
                          onCheckedChange={(v) => handleToggleActive(w.id, v)}
                          disabled={updateMutation.isPending}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleTest(w.id)}
                            disabled={!w.isActive || testingId === w.id}
                            title="Send test payload"
                          >
                            {testingId === w.id
                              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              : <TestTube2 className="w-3.5 h-3.5" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (confirm(`Delete webhook "${w.name}"?`)) {
                                deleteMutation.mutate({ id: w.id });
                              }
                            }}
                            className="text-red-400 hover:text-red-300"
                            title="Delete webhook"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create webhook dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Webhook className="w-4 h-4" />
              Add Webhook Endpoint
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="wh-name">Name</Label>
              <Input
                id="wh-name"
                placeholder="e.g. Slack Security Alerts"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wh-url">Endpoint URL</Label>
              <Input
                id="wh-url"
                type="url"
                placeholder="https://hooks.example.com/nexcom"
                value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wh-secret">Signing Secret (optional)</Label>
              <div className="relative">
                <Input
                  id="wh-secret"
                  type={showSecret ? "text" : "password"}
                  placeholder="HMAC-SHA256 signing secret"
                  value={form.secret}
                  onChange={e => setForm(f => ({ ...f, secret: e.target.value }))}
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowSecret(s => !s)}
                >
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">Sent as X-NEXCOM-Signature header for payload verification</p>
            </div>
            <div className="space-y-1.5">
              <Label>Event Filter</Label>
              <Select
                value={form.eventFilter}
                onValueChange={v => setForm(f => ({ ...f, eventFilter: v as EventFilter }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Events</SelectItem>
                  <SelectItem value="HIGH_AND_CRITICAL">High &amp; Critical only</SelectItem>
                  <SelectItem value="CRITICAL_ONLY">Critical only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({
                name: form.name,
                url: form.url,
                secret: form.secret || undefined,
                eventFilter: form.eventFilter,
              })}
              disabled={createMutation.isPending || !form.name || !form.url}
            >
              {createMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              Create Webhook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
