/**
 * Security Audit Log — Phase 31
 * Admin-only page for monitoring and resolving security events.
 * Covers deepfake/social-engineering defences:
 *   - Anomalous order detection alerts
 *   - Rate limit breach alerts
 *   - Large withdrawal flags
 *   - Account takeover attempts
 *   - Manual security event creation
 */
import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ShieldAlert, ShieldCheck, AlertTriangle, Activity,
  Eye, CheckCircle, XCircle, Plus, RefreshCw,
} from "lucide-react";
import { getLoginUrl } from "@/const";

// ─── Types ────────────────────────────────────────────────────────────────────
type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type EventStatus = "OPEN" | "INVESTIGATING" | "RESOLVED" | "FALSE_POSITIVE";
type EventType =
  | "RATE_LIMIT_BREACH" | "ANOMALOUS_ORDER" | "LARGE_WITHDRAWAL"
  | "REPEATED_AUTH_FAILURE" | "ADMIN_BULK_ACTION" | "SUSPICIOUS_IP"
  | "UNUSUAL_TRADE_PATTERN" | "ACCOUNT_TAKEOVER_ATTEMPT";

interface SecurityEvent {
  id: number;
  userId: number | null;
  eventType: EventType;
  severity: Severity;
  status: EventStatus;
  title: string;
  description: string;
  metadata: unknown;
  ipAddress: string | null;
  resolvedBy: number | null;
  resolvedAt: Date | null;
  resolutionNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const SEVERITY_COLORS: Record<Severity, string> = {
  LOW:      "bg-blue-500/10 text-blue-400 border-blue-500/30",
  MEDIUM:   "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  HIGH:     "bg-orange-500/10 text-orange-400 border-orange-500/30",
  CRITICAL: "bg-red-500/10 text-red-400 border-red-500/30",
};

const STATUS_COLORS: Record<EventStatus, string> = {
  OPEN:           "bg-red-500/10 text-red-400 border-red-500/30",
  INVESTIGATING:  "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  RESOLVED:       "bg-green-500/10 text-green-400 border-green-500/30",
  FALSE_POSITIVE: "bg-slate-500/10 text-muted-foreground border-slate-500/30",
};

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  RATE_LIMIT_BREACH:       "Rate Limit Breach",
  ANOMALOUS_ORDER:         "Anomalous Order",
  LARGE_WITHDRAWAL:        "Large Withdrawal",
  REPEATED_AUTH_FAILURE:   "Auth Failure",
  ADMIN_BULK_ACTION:       "Admin Bulk Action",
  SUSPICIOUS_IP:           "Suspicious IP",
  UNUSUAL_TRADE_PATTERN:   "Unusual Trade",
  ACCOUNT_TAKEOVER_ATTEMPT:"Account Takeover",
};

function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${SEVERITY_COLORS[severity]}`}>
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: EventStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${STATUS_COLORS[status]}`}>
      {status.replace("_", " ")}
    </span>
  );
}

// ─── Stats Cards ─────────────────────────────────────────────────────────────
function StatsCards() {
  const { data: stats } = trpc.security.adminGetStats.useQuery();

  const bySeverity = (stats?.bySeverity ?? {}) as Record<string, number>;
  const byType = (stats?.byType ?? {}) as Record<string, number>;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <ShieldAlert className="w-4 h-4 text-red-400" />
            <span className="text-xs text-muted-foreground">Open Events</span>
          </div>
          <p className="text-2xl font-bold text-white">{stats?.openCount ?? 0}</p>
        </CardContent>
      </Card>
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <span className="text-xs text-muted-foreground">Critical</span>
          </div>
          <p className="text-2xl font-bold text-red-400">{bySeverity["CRITICAL"] ?? 0}</p>
        </CardContent>
      </Card>
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="w-4 h-4 text-orange-400" />
            <span className="text-xs text-muted-foreground">Anomalous Orders</span>
          </div>
          <p className="text-2xl font-bold text-orange-400">{byType["ANOMALOUS_ORDER"] ?? 0}</p>
        </CardContent>
      </Card>
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-4 h-4 text-green-400" />
            <span className="text-xs text-muted-foreground">Rate Limit Breaches</span>
          </div>
          <p className="text-2xl font-bold text-yellow-400">{byType["RATE_LIMIT_BREACH"] ?? 0}</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Resolve Dialog ───────────────────────────────────────────────────────────
function ResolveDialog({
  event,
  onClose,
}: {
  event: SecurityEvent;
  onClose: () => void;
}) {
  const [newStatus, setNewStatus] = useState<"INVESTIGATING" | "RESOLVED" | "FALSE_POSITIVE">("RESOLVED");
  const [notes, setNotes] = useState("");
  const utils = trpc.useUtils();

  const updateMutation = trpc.security.adminUpdateEventStatus.useMutation({
    onSuccess: () => {
      toast.success("Security event updated");
      utils.security.adminListEvents.invalidate();
      utils.security.adminGetStats.invalidate();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">Update Security Event</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1">{event.title}</p>
            <p className="text-xs text-muted-foreground">{event.description}</p>
          </div>
          <div className="flex gap-2">
            <SeverityBadge severity={event.severity} />
            <StatusBadge status={event.status} />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground">New Status</Label>
            <Select value={newStatus} onValueChange={(v) => setNewStatus(v as typeof newStatus)}>
              <SelectTrigger className="bg-secondary border-border text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-secondary border-border">
                <SelectItem value="INVESTIGATING">Investigating</SelectItem>
                <SelectItem value="RESOLVED">Resolved</SelectItem>
                <SelectItem value="FALSE_POSITIVE">False Positive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground">Resolution Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Describe the investigation findings or resolution steps taken..."
              className="bg-secondary border-border text-white placeholder:text-muted-foreground min-h-[80px]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-border text-muted-foreground">
            Cancel
          </Button>
          <Button
            onClick={() => updateMutation.mutate({ eventId: event.id, status: newStatus, resolutionNotes: notes || undefined })}
            disabled={updateMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {updateMutation.isPending ? "Saving..." : "Update Event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create Event Dialog ──────────────────────────────────────────────────────
function CreateEventDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({
    eventType: "SUSPICIOUS_IP" as EventType,
    severity: "MEDIUM" as Severity,
    title: "",
    description: "",
    ipAddress: "",
    userId: "",
  });
  const utils = trpc.useUtils();

  const createMutation = trpc.security.adminCreateEvent.useMutation({
    onSuccess: () => {
      toast.success("Security event created");
      utils.security.adminListEvents.invalidate();
      utils.security.adminGetStats.invalidate();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSubmit = () => {
    if (!form.title.trim() || !form.description.trim()) {
      toast.error("Title and description are required");
      return;
    }
    createMutation.mutate({
      eventType: form.eventType,
      severity: form.severity,
      title: form.title,
      description: form.description,
      ipAddress: form.ipAddress || undefined,
      userId: form.userId ? parseInt(form.userId) : undefined,
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">Create Security Event</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-xs text-muted-foreground">
            Manually log a security incident, such as a reported deepfake/social-engineering attempt or suspicious account activity.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Event Type</Label>
              <Select value={form.eventType} onValueChange={(v) => setForm(f => ({ ...f, eventType: v as EventType }))}>
                <SelectTrigger className="bg-secondary border-border text-white text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-secondary border-border">
                  {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Severity</Label>
              <Select value={form.severity} onValueChange={(v) => setForm(f => ({ ...f, severity: v as Severity }))}>
                <SelectTrigger className="bg-secondary border-border text-white text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-secondary border-border">
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="CRITICAL">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground text-xs">Title</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Reported deepfake video impersonating CEO"
              className="bg-secondary border-border text-white placeholder:text-muted-foreground text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground text-xs">Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe the incident in detail..."
              className="bg-secondary border-border text-white placeholder:text-muted-foreground min-h-[80px] text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">IP Address (optional)</Label>
              <Input
                value={form.ipAddress}
                onChange={(e) => setForm(f => ({ ...f, ipAddress: e.target.value }))}
                placeholder="192.168.1.1"
                className="bg-secondary border-border text-white placeholder:text-muted-foreground text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">User ID (optional)</Label>
              <Input
                value={form.userId}
                onChange={(e) => setForm(f => ({ ...f, userId: e.target.value }))}
                placeholder="123"
                type="number"
                className="bg-secondary border-border text-white placeholder:text-muted-foreground text-sm"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-border text-muted-foreground">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {createMutation.isPending ? "Creating..." : "Create Event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SecurityAuditLog() {
  const { user, loading, isAuthenticated } = useAuth();
  const [severityFilter, setSeverityFilter] = useState<"ALL" | Severity>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | EventStatus>("ALL");
  const [typeFilter, setTypeFilter] = useState<"ALL" | EventType>("ALL");
  const [selectedEvent, setSelectedEvent] = useState<SecurityEvent | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [offset, setOffset] = useState(0);
  const PAGE_SIZE = 20;

  const { data, isLoading, refetch } = trpc.security.adminListEvents.useQuery({
    severity: severityFilter,
    status: statusFilter,
    eventType: typeFilter,
    limit: PAGE_SIZE,
    offset,
  });

  if (loading) return null;
  if (!isAuthenticated) {
    window.location.href = getLoginUrl();
    return null;
  }
  if (user?.role !== "admin") {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Access restricted to administrators.</p>
        </div>
      </DashboardLayout>
    );
  }

  const events = (data?.events ?? []) as SecurityEvent[];
  const total = data?.total ?? 0;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <ShieldAlert className="w-6 h-6 text-red-400" />
              Security Audit Log
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Monitor anomalous activity, rate limit breaches, and social-engineering attempts
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              <RefreshCw className="w-4 h-4 mr-1" />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => setShowCreate(true)}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <Plus className="w-4 h-4 mr-1" />
              Log Incident
            </Button>
          </div>
        </div>

        {/* Stats */}
        <StatsCards />

        {/* Security Advisory Banner */}
        <div className="mb-6 p-4 rounded-lg bg-amber-900/20 border border-amber-500/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-300">Deepfake & Social-Engineering Advisory</p>
              <p className="text-xs text-amber-200/70 mt-1">
                AI-generated video/audio impersonation of executives has been used to authorise fraudulent wire transfers (BBC, 2024). NEXCOM defences include: anomalous order detection, rate limiting on high-risk actions, large-withdrawal flags, and this audit log. If you receive any unusual instruction to override platform controls, verify through an out-of-band channel before acting.
              </p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <Select value={severityFilter} onValueChange={(v) => { setSeverityFilter(v as typeof severityFilter); setOffset(0); }}>
            <SelectTrigger className="w-36 bg-secondary border-border text-white text-sm">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent className="bg-secondary border-border">
              <SelectItem value="ALL">All Severities</SelectItem>
              <SelectItem value="CRITICAL">Critical</SelectItem>
              <SelectItem value="HIGH">High</SelectItem>
              <SelectItem value="MEDIUM">Medium</SelectItem>
              <SelectItem value="LOW">Low</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as typeof statusFilter); setOffset(0); }}>
            <SelectTrigger className="w-36 bg-secondary border-border text-white text-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="bg-secondary border-border">
              <SelectItem value="ALL">All Statuses</SelectItem>
              <SelectItem value="OPEN">Open</SelectItem>
              <SelectItem value="INVESTIGATING">Investigating</SelectItem>
              <SelectItem value="RESOLVED">Resolved</SelectItem>
              <SelectItem value="FALSE_POSITIVE">False Positive</SelectItem>
            </SelectContent>
          </Select>

          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v as typeof typeFilter); setOffset(0); }}>
            <SelectTrigger className="w-48 bg-secondary border-border text-white text-sm">
              <SelectValue placeholder="Event Type" />
            </SelectTrigger>
            <SelectContent className="bg-secondary border-border">
              <SelectItem value="ALL">All Types</SelectItem>
              {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Events Table */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-base">
              Security Events ({total})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading events...</div>
            ) : events.length === 0 ? (
              <div className="p-8 text-center">
                <ShieldCheck className="w-10 h-10 text-green-400 mx-auto mb-2" />
                <p className="text-muted-foreground">No security events found for the selected filters.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">Event</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">Type</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">Severity</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">Status</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">User</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">Time</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => (
                      <tr key={event.id} className="border-b border-border hover:bg-secondary/40 transition-colors">
                        <td className="py-3 px-4">
                          <p className="text-white font-medium text-sm">{event.title}</p>
                          <p className="text-muted-foreground text-xs mt-0.5 line-clamp-1">{event.description}</p>
                          {event.ipAddress && (
                            <p className="text-muted-foreground text-xs mt-0.5">IP: {event.ipAddress}</p>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-xs text-muted-foreground">{EVENT_TYPE_LABELS[event.eventType]}</span>
                        </td>
                        <td className="py-3 px-4">
                          <SeverityBadge severity={event.severity} />
                        </td>
                        <td className="py-3 px-4">
                          <StatusBadge status={event.status} />
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-muted-foreground text-xs">
                            {event.userId ? `#${event.userId}` : "System"}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-muted-foreground text-xs">
                            {new Date(event.createdAt).toLocaleString()}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {event.status !== "RESOLVED" && event.status !== "FALSE_POSITIVE" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedEvent(event)}
                              className="border-border text-muted-foreground hover:bg-muted text-xs h-7"
                            >
                              <Eye className="w-3 h-3 mr-1" />
                              Review
                            </Button>
                          ) : (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              {event.status === "RESOLVED"
                                ? <><CheckCircle className="w-3 h-3 text-green-400" /> Resolved</>
                                : <><XCircle className="w-3 h-3 text-muted-foreground" /> False Positive</>
                              }
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between p-4 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    className="border-border text-muted-foreground text-xs"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset + PAGE_SIZE >= total}
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                    className="border-border text-muted-foreground text-xs"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Dialogs */}
      {selectedEvent && (
        <ResolveDialog event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
      {showCreate && (
        <CreateEventDialog onClose={() => setShowCreate(false)} />
      )}
    </DashboardLayout>
  );
}
