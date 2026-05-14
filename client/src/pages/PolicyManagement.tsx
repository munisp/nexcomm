import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Shield, Plus, Trash2, ToggleLeft, ToggleRight, Search, CheckCircle, XCircle, Activity, RefreshCw, Database } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";

export default function PolicyManagement() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [searchQuery, setSearchQuery] = useState("");
  const [effectFilter, setEffectFilter] = useState<"all" | "allow" | "deny">("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEvalDialog, setShowEvalDialog] = useState(false);
  const [newPolicy, setNewPolicy] = useState({
    id: "",
    name: "",
    description: "",
    effect: "allow" as "allow" | "deny",
    principals: "",
    resources: "",
    actions: "",
    priority: 500,
  });
  const [evalRequest, setEvalRequest] = useState({
    principalId: "",
    principalRole: "user",
    resourceType: "",
    resourceId: "",
    action: "",
  });

  const { data: policiesData, isLoading } = trpc.pbac.listPolicies.useQuery(
    effectFilter !== "all" ? { effect: effectFilter } : undefined
  );
  const { data: stats } = trpc.pbac.getStats.useQuery();
  const { data: auditLog } = trpc.pbac.getAuditLog.useQuery({ limit: 50 });

  const toggleMutation = trpc.pbac.togglePolicy.useMutation({
    onSuccess: () => {
      utils.pbac.listPolicies.invalidate();
      utils.pbac.getStats.invalidate();
      toast.success("Policy updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.pbac.deletePolicy.useMutation({
    onSuccess: () => {
      utils.pbac.listPolicies.invalidate();
      utils.pbac.getStats.invalidate();
      toast.success("Policy deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const createMutation = trpc.pbac.createPolicy.useMutation({
    onSuccess: () => {
      utils.pbac.listPolicies.invalidate();
      utils.pbac.getStats.invalidate();
      setShowCreateDialog(false);
      setNewPolicy({ id: "", name: "", description: "", effect: "allow", principals: "", resources: "", actions: "", priority: 500 });
      toast.success("Policy created");
    },
    onError: (e) => toast.error(e.message),
  });

  const evalMutation = trpc.pbac.evaluateAccess.useMutation({
    onError: (e) => toast.error(e.message),
  });

  const reloadMutation = trpc.pbac.reloadFromDb.useMutation({
    onSuccess: (data) => {
      utils.pbac.listPolicies.invalidate();
      utils.pbac.getStats.invalidate();
      toast.success(`Reloaded ${data.loadedCount} policies from database`);
    },
    onError: (e) => toast.error(e.message),
  });

  const { data: dbPolicies } = trpc.pbac.listDbPolicies.useQuery();

  if (isLoading) return <PageSkeleton title="Policy Management" subtitle="PBAC Policy Engine" />;

  const policies = policiesData?.policies ?? [];
  const filtered = policies.filter(p =>
    !searchQuery ||
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.principals.some(pr => pr.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleCreate = () => {
    if (!newPolicy.id || !newPolicy.name || !newPolicy.principals || !newPolicy.resources || !newPolicy.actions) {
      toast.error("Please fill in all required fields");
      return;
    }
    createMutation.mutate({
      id: newPolicy.id,
      name: newPolicy.name,
      description: newPolicy.description || undefined,
      effect: newPolicy.effect,
      principals: newPolicy.principals.split(",").map(s => s.trim()).filter(Boolean),
      resources: newPolicy.resources.split(",").map(s => s.trim()).filter(Boolean),
      actions: newPolicy.actions.split(",").map(s => s.trim()).filter(Boolean),
      priority: newPolicy.priority,
    });
  };

  const handleEval = () => {
    if (!evalRequest.principalId || !evalRequest.resourceType || !evalRequest.action) {
      toast.error("Please fill in principal ID, resource type, and action");
      return;
    }
    evalMutation.mutate({
      principal: { id: evalRequest.principalId, role: evalRequest.principalRole },
      resource: { type: evalRequest.resourceType, id: evalRequest.resourceId || undefined },
      action: evalRequest.action,
    });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Policy Management</h1>
            <p className="text-muted-foreground">Policy-Based Access Control (PBAC) Engine</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => reloadMutation.mutate()}
            disabled={reloadMutation.isPending}
            title={`${dbPolicies?.dbAvailable ? dbPolicies.policies.length + ' policies in DB' : 'DB unavailable'}`}
          >
            {reloadMutation.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Database className="h-4 w-4 mr-2" />}
            Reload from DB
          </Button>
          <Button variant="outline" onClick={() => setShowEvalDialog(true)}>
            <Activity className="h-4 w-4 mr-2" /> Evaluate Access
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Policy
          </Button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats.totalPolicies}</div>
              <div className="text-sm text-muted-foreground">Total Policies</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-green-600">{stats.allowPolicies}</div>
              <div className="text-sm text-muted-foreground">Allow Policies</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-red-600">{stats.denyPolicies}</div>
              <div className="text-sm text-muted-foreground">Deny Policies</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats.recentDecisions.allowRate}%</div>
              <div className="text-sm text-muted-foreground">Allow Rate (recent)</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="policies">
        <TabsList>
          <TabsTrigger value="policies">Policies ({filtered.length})</TabsTrigger>
          <TabsTrigger value="audit">Audit Log ({auditLog?.total ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="policies" className="space-y-4">
          {/* Filters */}
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search policies by name, ID, or principal..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={effectFilter} onValueChange={(v) => setEffectFilter(v as typeof effectFilter)}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Effects</SelectItem>
                <SelectItem value="allow">Allow Only</SelectItem>
                <SelectItem value="deny">Deny Only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Policy</TableHead>
                  <TableHead>Effect</TableHead>
                  <TableHead>Principals</TableHead>
                  <TableHead>Resources</TableHead>
                  <TableHead>Actions</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Controls</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No policies found
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map(policy => (
                  <TableRow key={policy.id} className={!policy.enabled ? "opacity-50" : ""}>
                    <TableCell>
                      <div className="font-medium">{policy.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{policy.id}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={policy.effect === "allow" ? "default" : "destructive"}>
                        {policy.effect === "allow" ? (
                          <CheckCircle className="h-3 w-3 mr-1" />
                        ) : (
                          <XCircle className="h-3 w-3 mr-1" />
                        )}
                        {policy.effect}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {policy.principals.slice(0, 2).map(p => (
                          <Badge key={p} variant="outline" className="text-xs">{p}</Badge>
                        ))}
                        {policy.principals.length > 2 && (
                          <Badge variant="outline" className="text-xs">+{policy.principals.length - 2}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {policy.resources.slice(0, 2).map(r => (
                          <Badge key={r} variant="secondary" className="text-xs font-mono">{r}</Badge>
                        ))}
                        {policy.resources.length > 2 && (
                          <Badge variant="secondary" className="text-xs">+{policy.resources.length - 2}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {policy.actions.slice(0, 3).map(a => (
                          <Badge key={a} variant="outline" className="text-xs">{a}</Badge>
                        ))}
                        {policy.actions.length > 3 && (
                          <Badge variant="outline" className="text-xs">+{policy.actions.length - 3}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{policy.priority}</Badge>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={policy.enabled}
                        onCheckedChange={(enabled) => toggleMutation.mutate({ id: policy.id, enabled })}
                        disabled={toggleMutation.isPending}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          if (confirm(`Delete policy "${policy.name}"?`)) {
                            deleteMutation.mutate({ id: policy.id });
                          }
                        }}
                        disabled={deleteMutation.isPending || policy.id.startsWith("policy-owner-") || policy.id.startsWith("policy-deny-suspended")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle>Access Decision Audit Log</CardTitle>
              <CardDescription>Recent PBAC evaluation decisions (last 50)</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Principal</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead>Matched Policy</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(auditLog?.entries ?? []).map(entry => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(entry.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{entry.request.principal.id}</div>
                        <div className="text-xs text-muted-foreground">{entry.request.principal.role}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-mono">{entry.request.resource.type}</div>
                        {entry.request.resource.id && (
                          <div className="text-xs text-muted-foreground">:{entry.request.resource.id}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{entry.request.action}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={entry.decision.allowed ? "default" : "destructive"}>
                          {entry.decision.allowed ? "ALLOW" : "DENY"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {entry.decision.matchedPolicyName ?? entry.decision.effect}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Policy Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create New Policy</DialogTitle>
            <DialogDescription>
              Define a new PBAC policy. Use comma-separated values for principals, resources, and actions.
              Use wildcards (*) for broad matching (e.g., "order:*", "role:admin").
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Policy ID *</Label>
              <Input placeholder="policy-my-custom-rule" value={newPolicy.id} onChange={e => setNewPolicy(p => ({ ...p, id: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input placeholder="My Custom Rule" value={newPolicy.name} onChange={e => setNewPolicy(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Description</Label>
              <Input placeholder="What this policy does..." value={newPolicy.description} onChange={e => setNewPolicy(p => ({ ...p, description: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Effect *</Label>
              <Select value={newPolicy.effect} onValueChange={(v) => setNewPolicy(p => ({ ...p, effect: v as "allow" | "deny" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow">Allow</SelectItem>
                  <SelectItem value="deny">Deny</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Priority (0-1000)</Label>
              <Input type="number" min={0} max={1000} value={newPolicy.priority} onChange={e => setNewPolicy(p => ({ ...p, priority: parseInt(e.target.value) || 500 }))} />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Principals * (comma-separated: user IDs, "role:admin", "role:user", "*")</Label>
              <Input placeholder="role:user, role:admin" value={newPolicy.principals} onChange={e => setNewPolicy(p => ({ ...p, principals: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Resources * (comma-separated: "order:*", "user:123", "*")</Label>
              <Input placeholder="order:*, portfolio:*" value={newPolicy.resources} onChange={e => setNewPolicy(p => ({ ...p, resources: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Actions * (comma-separated: "read", "write", "delete", "*")</Label>
              <Input placeholder="read, create, cancel" value={newPolicy.actions} onChange={e => setNewPolicy(p => ({ ...p, actions: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create Policy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Evaluate Access Dialog */}
      <Dialog open={showEvalDialog} onOpenChange={setShowEvalDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Evaluate Access Request</DialogTitle>
            <DialogDescription>Test what decision the PBAC engine would make for a given access request.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Principal ID *</Label>
                <Input placeholder="123" value={evalRequest.principalId} onChange={e => setEvalRequest(r => ({ ...r, principalId: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Principal Role *</Label>
                <Select value={evalRequest.principalRole} onValueChange={(v) => setEvalRequest(r => ({ ...r, principalRole: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">user</SelectItem>
                    <SelectItem value="admin">admin</SelectItem>
                    <SelectItem value="owner">owner</SelectItem>
                    <SelectItem value="farmer">farmer</SelectItem>
                    <SelectItem value="broker">broker</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Resource Type *</Label>
                <Input placeholder="order" value={evalRequest.resourceType} onChange={e => setEvalRequest(r => ({ ...r, resourceType: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Resource ID (optional)</Label>
                <Input placeholder="456" value={evalRequest.resourceId} onChange={e => setEvalRequest(r => ({ ...r, resourceId: e.target.value }))} />
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Action *</Label>
                <Input placeholder="cancel" value={evalRequest.action} onChange={e => setEvalRequest(r => ({ ...r, action: e.target.value }))} />
              </div>
            </div>

            {evalMutation.data && (
              <Card className={evalMutation.data.allowed ? "border-green-500" : "border-red-500"}>
                <CardContent className="pt-4 space-y-2">
                  <div className="flex items-center gap-2">
                    {evalMutation.data.allowed ? (
                      <CheckCircle className="h-5 w-5 text-green-600" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-600" />
                    )}
                    <span className="font-semibold text-lg">
                      {evalMutation.data.allowed ? "ACCESS ALLOWED" : "ACCESS DENIED"}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">{evalMutation.data.reason}</div>
                  {evalMutation.data.matchedPolicyName && (
                    <div className="text-xs">
                      Matched policy: <span className="font-mono">{evalMutation.data.matchedPolicyName}</span>
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    Evaluated {evalMutation.data.evaluatedPolicies} policies
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEvalDialog(false)}>Close</Button>
            <Button onClick={handleEval} disabled={evalMutation.isPending}>
              {evalMutation.isPending ? "Evaluating..." : "Evaluate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
