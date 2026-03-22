/**
 * NEXCOM Exchange — IP Allowlist Management
 * Admin-only page for managing per-scope IP CIDR allowlists.
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
import { Shield, Plus, Trash2, RefreshCw, Search, CheckCircle, XCircle, Lock } from "lucide-react";

type Scope = "GLOBAL_ADMIN" | "BULK_OPERATIONS" | "LIQUIDATION_OVERRIDE" | "WITHDRAWAL_APPROVAL";

const SCOPE_LABELS: Record<Scope, string> = {
  GLOBAL_ADMIN: "Global Admin",
  BULK_OPERATIONS: "Bulk Operations",
  LIQUIDATION_OVERRIDE: "Liquidation Override",
  WITHDRAWAL_APPROVAL: "Withdrawal Approval",
};

const SCOPE_COLORS: Record<Scope, string> = {
  GLOBAL_ADMIN: "bg-red-500/20 text-red-400 border-red-500/30",
  BULK_OPERATIONS: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  LIQUIDATION_OVERRIDE: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  WITHDRAWAL_APPROVAL: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

export default function IpAllowlist() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [scopeFilter, setScopeFilter] = useState<Scope | "ALL">("ALL");
  const [showInactive, setShowInactive] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [checkIp, setCheckIp] = useState("");
  const [checkScope, setCheckScope] = useState<Scope>("GLOBAL_ADMIN");
  const [checkResult, setCheckResult] = useState<{ allowed: boolean; reason: string } | null>(null);

  const [form, setForm] = useState({
    cidr: "",
    label: "",
    scope: "GLOBAL_ADMIN" as Scope,
  });

  const utils = trpc.useUtils();

  const { data: entries = [], isLoading, refetch } = trpc.ipAllowlist.adminList.useQuery(
    { scope: scopeFilter, includeInactive: showInactive },
    { enabled: isAdmin }
  );

  const createMutation = trpc.ipAllowlist.adminCreate.useMutation({
    onSuccess: () => {
      toast.success("IP CIDR entry added");
      utils.ipAllowlist.adminList.invalidate();
      setCreateOpen(false);
      setForm({ cidr: "", label: "", scope: "GLOBAL_ADMIN" });
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleMutation = trpc.ipAllowlist.adminToggle.useMutation({
    onSuccess: () => {
      utils.ipAllowlist.adminList.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.ipAllowlist.adminDelete.useMutation({
    onSuccess: () => {
      toast.success("Entry removed");
      utils.ipAllowlist.adminList.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const checkQuery = trpc.ipAllowlist.adminCheckIp.useQuery(
    { ip: checkIp, scope: checkScope },
    {
      enabled: false,
      retry: false,
    }
  );

  const handleCheckIp = async () => {
    if (!checkIp.match(/^(\d{1,3}\.){3}\d{1,3}$/)) {
      toast.error("Enter a valid IPv4 address");
      return;
    }
    const result = await checkQuery.refetch();
    if (result.data) {
      setCheckResult(result.data as { allowed: boolean; reason: string });
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-64 text-muted-foreground">
        <Lock className="w-12 h-12 mb-4 opacity-30" />
        <p className="text-lg font-medium">Admin access required</p>
        <p className="text-sm mt-1">Only administrators can manage IP allowlists.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            IP Allowlist
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Restrict sensitive admin operations to approved IP ranges (CIDR notation)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch
              checked={showInactive}
              onCheckedChange={setShowInactive}
              id="show-inactive-ip"
            />
            <Label htmlFor="show-inactive-ip">Show inactive</Label>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> Add CIDR
          </Button>
        </div>
      </div>

      {/* IP Check tool */}
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Search className="w-4 h-4" />
            IP Check Tool
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="check-ip-input" className="text-xs">IPv4 Address</Label>
              <Input
                id="check-ip-input"
                placeholder="e.g. 192.168.1.100"
                value={checkIp}
                onChange={e => { setCheckIp(e.target.value); setCheckResult(null); }}
                className="w-48"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Scope</Label>
              <Select value={checkScope} onValueChange={v => { setCheckScope(v as Scope); setCheckResult(null); }}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SCOPE_LABELS) as Scope[]).map(s => (
                    <SelectItem key={s} value={s}>{SCOPE_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={handleCheckIp} disabled={checkQuery.isFetching}>
              {checkQuery.isFetching ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
              Check
            </Button>
            {checkResult && (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm ${
                checkResult.allowed
                  ? "bg-green-500/10 text-green-400 border border-green-500/20"
                  : "bg-red-500/10 text-red-400 border border-red-500/20"
              }`}>
                {checkResult.allowed
                  ? <CheckCircle className="w-4 h-4" />
                  : <XCircle className="w-4 h-4" />}
                {checkResult.reason}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Scope filter */}
      <div className="flex gap-2 flex-wrap">
        {(["ALL", ...Object.keys(SCOPE_LABELS)] as (Scope | "ALL")[]).map(s => (
          <Button
            key={s}
            variant={scopeFilter === s ? "default" : "outline"}
            size="sm"
            onClick={() => setScopeFilter(s)}
          >
            {s === "ALL" ? "All Scopes" : SCOPE_LABELS[s as Scope]}
          </Button>
        ))}
      </div>

      {/* Entries table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            CIDR Entries
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({entries.filter(e => e.isActive).length} active)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading...
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Shield className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">No IP entries configured</p>
              <p className="text-xs mt-1">All IPs are currently allowed. Add CIDR entries to restrict access.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>CIDR</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map(e => (
                    <TableRow key={e.id} className={!e.isActive ? "opacity-50" : ""}>
                      <TableCell className="font-mono text-sm">{e.cidr}</TableCell>
                      <TableCell className="font-medium">{e.label}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${SCOPE_COLORS[e.scope as Scope]}`}>
                          {SCOPE_LABELS[e.scope as Scope]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(e.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={e.isActive}
                          onCheckedChange={(v) => toggleMutation.mutate({ id: e.id, isActive: v })}
                          disabled={toggleMutation.isPending}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm(`Remove CIDR "${e.cidr}" (${e.label})?`)) {
                              deleteMutation.mutate({ id: e.id });
                            }
                          }}
                          className="text-red-400 hover:text-red-300"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Add IP CIDR Entry
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="cidr-input">CIDR Range</Label>
              <Input
                id="cidr-input"
                placeholder="e.g. 192.168.1.0/24 or 10.0.0.1/32"
                value={form.cidr}
                onChange={e => setForm(f => ({ ...f, cidr: e.target.value }))}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Use /32 for a single IP address</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cidr-label">Label</Label>
              <Input
                id="cidr-label"
                placeholder="e.g. Office Network, VPN Gateway"
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <Select
                value={form.scope}
                onValueChange={v => setForm(f => ({ ...f, scope: v as Scope }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SCOPE_LABELS) as Scope[]).map(s => (
                    <SelectItem key={s} value={s}>{SCOPE_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({
                cidr: form.cidr,
                label: form.label,
                scope: form.scope,
              })}
              disabled={createMutation.isPending || !form.cidr || !form.label}
            >
              {createMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              Add Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
