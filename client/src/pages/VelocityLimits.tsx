import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Gauge, Plus, Pencil, Trash2, TrendingDown, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/_core/hooks/useAuth";

export default function VelocityLimits() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formAmount, setFormAmount] = useState("");
  const [formHours, setFormHours] = useState("24");
  const [formUserId, setFormUserId] = useState("");

  const { data: allLimits, refetch: refetchAll } = trpc.velocityLimit.adminListLimits.useQuery(undefined, { enabled: isAdmin });
  const { data: myUsage } = trpc.velocityLimit.myUsage.useQuery({ currency: "NGN" });

  const setLimitMutation = trpc.velocityLimit.adminSetLimit.useMutation({
    onSuccess: () => {
      toast.success(editingId ? "Velocity limit updated." : "Velocity limit created.");
      setShowCreateDialog(false);
      setEditingId(null);
      setFormAmount("");
      setFormHours("24");
      setFormUserId("");
      refetchAll();
    },
    onError: (err) => toast.error(err.message),
  });

  const deactivateMutation = trpc.velocityLimit.adminDeactivateLimit.useMutation({
    onSuccess: () => {
      toast.success("Velocity limit deactivated.");
      refetchAll();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSave = () => {
    const amount = parseFloat(formAmount);
    const hours = parseInt(formHours);
    if (isNaN(amount) || amount <= 0) return toast.error("Enter a valid limit amount.");
    if (isNaN(hours) || hours < 1 || hours > 168) return toast.error("Window must be 1–168 hours.");
    const userId = formUserId ? parseInt(formUserId) : undefined;
    setLimitMutation.mutate({ maxAmount: amount, windowHours: hours, currency: "NGN", userId });
  };

  const startEdit = (limit: { id: number; maxAmount: string; windowHours: number; userId: number | null }) => {
    setEditingId(limit.id);
    setFormAmount(limit.maxAmount);
    setFormHours(String(limit.windowHours));
    setFormUserId(limit.userId ? String(limit.userId) : "");
    setShowCreateDialog(true);
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Gauge className="w-7 h-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Withdrawal Velocity Limits</h1>
              <p className="text-muted-foreground text-sm">
                {isAdmin
                  ? "Manage rolling withdrawal limits to prevent large-sum social-engineering attacks"
                  : "Your current withdrawal limits and usage"}
              </p>
            </div>
          </div>
          {isAdmin && (
            <Button onClick={() => { setEditingId(null); setFormAmount(""); setFormHours("24"); setFormUserId(""); setShowCreateDialog(true); }}>
              <Plus className="w-4 h-4 mr-2" /> Add Limit
            </Button>
          )}
        </div>

        {/* My Usage Summary */}
        {myUsage && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Used ({myUsage.windowHours}h)</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">₦{Number(myUsage.usedAmount).toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Limit ({myUsage.windowHours}h)</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">₦{Number(myUsage.limitAmount).toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Remaining</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-2xl font-bold ${myUsage.remaining < 50000 ? "text-destructive" : "text-green-500"}`}>
                  ₦{Number(myUsage.remaining).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{myUsage.percentage.toFixed(1)}% used</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Admin: All Limits */}
        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>All Velocity Limits</CardTitle>
              <CardDescription>
                Global and per-user withdrawal limits. Limits apply to all users unless scoped to a specific user ID.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!allLimits || allLimits.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <TrendingDown className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No velocity limits configured.</p>
                  <p className="text-xs mt-1">Add a global limit to protect all users from large-sum attacks.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {allLimits.map((limit) => (
                    <div key={limit.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium">
                            ₦{Number(limit.maxAmount).toLocaleString()} per {limit.windowHours}h
                          </p>
                          <Badge variant={limit.isActive ? "default" : "secondary"}>
                            {limit.isActive ? "Active" : "Inactive"}
                          </Badge>
                          {limit.userId && (
                            <Badge variant="outline" className="text-xs">User #{limit.userId}</Badge>
                          )}
                          <Badge variant="outline" className="text-xs">{limit.currency}</Badge>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(limit)}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                        {limit.isActive && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => deactivateMutation.mutate({ limitId: limit.id })}
                            disabled={deactivateMutation.isPending}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Security context */}
        <Card className="bg-muted/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Why Velocity Limits Matter
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              Deepfake and social-engineering attacks (like the Arup $25M wire fraud) often involve large,
              single-transaction transfers. Velocity limits cap the total amount that can be withdrawn in a
              rolling window, blocking automated attacks even if login credentials are compromised.
            </p>
          </CardContent>
        </Card>

        {/* Create / Edit Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? "Update Velocity Limit" : "Add Velocity Limit"}</DialogTitle>
              <DialogDescription>
                Set a rolling withdrawal cap to protect users from large-sum attacks.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Max Amount (₦)</Label>
                  <Input
                    type="number"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    placeholder="e.g. 500000"
                  />
                </div>
                <div>
                  <Label>Window (hours, 1–168)</Label>
                  <Input
                    type="number"
                    value={formHours}
                    onChange={(e) => setFormHours(e.target.value)}
                    min={1}
                    max={168}
                  />
                </div>
              </div>
              <div>
                <Label>User ID (leave blank for global limit)</Label>
                <Input
                  type="number"
                  value={formUserId}
                  onChange={(e) => setFormUserId(e.target.value)}
                  placeholder="Optional — applies to specific user"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={setLimitMutation.isPending}>
                {setLimitMutation.isPending ? "Saving..." : editingId ? "Update" : "Create Limit"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
