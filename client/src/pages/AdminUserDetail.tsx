/**
 * AdminUserDetail.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Full admin user detail page at /admin/users/:id
 *
 * Sections:
 *   1. Identity card — name, email, role badge, join date, last sign-in
 *   2. Profile — KYC fields (NIN, BVN, address, bank)
 *   3. Recent Orders — last 20 orders with status badges
 *   4. KYC History — submission + review timeline
 *   5. Recent Notifications — last 10 system notifications
 *   6. Management Actions — change role, suspend, promote to admin
 */
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  ArrowLeft,
  User,
  Mail,
  Calendar,
  Clock,
  ShieldCheck,
  ShieldX,
  TrendingUp,
  FileText,
  Bell,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  user: "bg-muted text-muted-foreground",
  farmer: "bg-green-500/20 text-green-400 border-green-500/30",
  trader: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  broker: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

const ORDER_STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-blue-500/20 text-blue-400",
  PARTIALLY_FILLED: "bg-yellow-500/20 text-yellow-400",
  FILLED: "bg-green-500/20 text-green-400",
  CANCELLED: "bg-muted text-muted-foreground",
  REJECTED: "bg-red-500/20 text-red-400",
  EXPIRED: "bg-orange-500/20 text-orange-400",
};

const KYC_STATUS_ICONS: Record<string, React.ReactNode> = {
  APPROVED: <CheckCircle2 className="w-4 h-4 text-green-400" />,
  REJECTED: <XCircle className="w-4 h-4 text-red-400" />,
  PENDING: <Clock className="w-4 h-4 text-yellow-400" />,
  UNDER_REVIEW: <RefreshCw className="w-4 h-4 text-blue-400" />,
};

function fmt(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminUserDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user: me } = useAuth();
  const userId = parseInt(id ?? "0", 10);
  const utils = trpc.useUtils();

  const [selectedRole, setSelectedRole] = useState<string>("");

  const { data, isLoading, error, refetch } = trpc.profile.getUserDetail.useQuery(
    { userId },
    { enabled: !!userId && me?.role === "admin" }
  );

  const updateRoleMutation = trpc.profile.updateRole.useMutation({
    onSuccess: () => {
      toast.success("Role updated successfully");
      utils.profile.getUserDetail.invalidate({ userId });
      utils.profile.listUsers.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const suspendMutation = trpc.profile.suspendUser.useMutation({
    onSuccess: () => {
      toast.success("User suspended");
      utils.profile.getUserDetail.invalidate({ userId });
      utils.profile.listUsers.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const promoteMutation = trpc.profile.promoteToAdmin.useMutation({
    onSuccess: () => {
      toast.success("User promoted to admin");
      utils.profile.getUserDetail.invalidate({ userId });
      utils.profile.listUsers.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (me?.role !== "admin") {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          <ShieldX className="w-6 h-6 mr-2" />
          Admin access required
        </div>
      </DashboardLayout>
    );
  }

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          Loading user details...
        </div>
      </DashboardLayout>
    );
  }

  if (error || !data) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4 text-muted-foreground">
          <AlertTriangle className="w-8 h-8 text-destructive" />
          <p>{error?.message ?? "User not found"}</p>
          <Button variant="outline" onClick={() => navigate("/admin")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Admin
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const { user, profile, recentOrders, kycHistory, recentNotifications } = data;

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6 p-4 md:p-6">

        {/* ── Back + Header ───────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
            <ArrowLeft className="w-4 h-4 mr-1" />
            Admin
          </Button>
          <Separator orientation="vertical" className="h-5" />
          <h1 className="text-xl font-semibold text-foreground">User Detail</h1>
        </div>

        {/* ── Identity Card ───────────────────────────────────────────────── */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xl">
                  {(user.name ?? "?").charAt(0).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{user.name ?? "Unknown"}</h2>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Mail className="w-3.5 h-3.5" />
                    {user.email ?? "—"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={`text-xs px-2 py-0.5 border ${ROLE_COLORS[user.role ?? "user"] ?? ROLE_COLORS.user}`}>
                  {user.role ?? "user"}
                </Badge>
                <span className="text-xs text-muted-foreground">ID #{user.id}</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Joined
                </div>
                <div className="font-medium text-foreground">{fmtDate(user.createdAt)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Last Sign-in
                </div>
                <div className="font-medium text-foreground">{fmt(user.lastSignedIn)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Open ID</div>
                <div className="font-mono text-xs text-foreground truncate max-w-[120px]">{user.openId}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Login Method</div>
                <div className="font-medium text-foreground capitalize">{user.loginMethod ?? "—"}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Profile / KYC Fields ────────────────────────────────────────── */}
        {profile && (
          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <User className="w-4 h-4 text-primary" />
                Profile & KYC Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
                {[
                  ["First Name", profile.firstName],
                  ["Last Name", profile.lastName],
                  ["Phone", profile.phone],
                  ["NIN", profile.nin],
                  ["BVN", profile.bvn],
                  ["Address", profile.address],
                  ["State", profile.state],
                  ["Country", profile.country],
                  ["Company", profile.companyName],
                  ["RC Number", profile.rcNumber],
                  ["Tax ID", profile.taxId],
                  ["Bank Name", profile.bankName],
                  ["Bank Account", profile.bankAccount],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="font-medium text-foreground truncate">{value ?? "—"}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Recent Orders ───────────────────────────────────────────────── */}
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Recent Orders ({recentOrders.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recentOrders.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">No orders found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-2 text-left text-xs text-muted-foreground font-medium">Symbol</th>
                      <th className="px-4 py-2 text-left text-xs text-muted-foreground font-medium">Side</th>
                      <th className="px-4 py-2 text-left text-xs text-muted-foreground font-medium">Type</th>
                      <th className="px-4 py-2 text-right text-xs text-muted-foreground font-medium">Qty</th>
                      <th className="px-4 py-2 text-right text-xs text-muted-foreground font-medium">Price</th>
                      <th className="px-4 py-2 text-left text-xs text-muted-foreground font-medium">Status</th>
                      <th className="px-4 py-2 text-left text-xs text-muted-foreground font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {recentOrders.map((o) => (
                      <tr key={o.id} className="hover:bg-secondary/20">
                        <td className="px-4 py-2 font-mono text-xs font-medium text-foreground">{o.symbol}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs font-medium ${o.side === "BUY" ? "text-green-400" : "text-red-400"}`}>
                            {o.side}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{o.orderType}</td>
                        <td className="px-4 py-2 text-right text-xs text-foreground">{Number(o.quantity).toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-xs text-foreground">
                          {o.price ? `₦${Number(o.price).toLocaleString()}` : "Market"}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${ORDER_STATUS_COLORS[o.status ?? "OPEN"] ?? ""}`}>
                            {o.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{fmtDate(o.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── KYC History ─────────────────────────────────────────────────── */}
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              KYC Submission History ({kycHistory.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {kycHistory.length === 0 ? (
              <div className="py-6 text-center text-muted-foreground text-sm">No KYC submissions found.</div>
            ) : (
              <div className="space-y-3">
                {kycHistory.map((k) => (
                  <div key={k.id} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-secondary/10">
                    <div className="mt-0.5">{KYC_STATUS_ICONS[k.status] ?? <Clock className="w-4 h-4" />}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">{k.status}</span>
                        <span className="text-xs text-muted-foreground">Submitted {fmt(k.submittedAt)}</span>
                        {k.reviewedAt && (
                          <span className="text-xs text-muted-foreground">· Reviewed {fmt(k.reviewedAt)}</span>
                        )}
                      </div>
                      {k.reviewNotes && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">{k.reviewNotes}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Recent Notifications ────────────────────────────────────────── */}
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" />
              Recent Notifications ({recentNotifications.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentNotifications.length === 0 ? (
              <div className="py-6 text-center text-muted-foreground text-sm">No notifications found.</div>
            ) : (
              <div className="space-y-2">
                {recentNotifications.map((n) => (
                  <div key={n.id} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-secondary/10">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${n.read ? "bg-muted-foreground" : "bg-primary"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">{n.title}</span>
                        <Badge variant="outline" className="text-[10px] px-1">{n.type}</Badge>
                        <span className="text-xs text-muted-foreground">{fmt(n.createdAt)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Management Actions ──────────────────────────────────────────── */}
        {user.id !== me?.id && (
          <Card className="border-border border-destructive/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-destructive">
                <ShieldCheck className="w-4 h-4" />
                Management Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Change Role */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[160px]">
                  <label className="text-xs text-muted-foreground mb-1 block">Change Role</label>
                  <Select
                    value={selectedRole || user.role || "user"}
                    onValueChange={setSelectedRole}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="farmer">Farmer</SelectItem>
                      <SelectItem value="trader">Trader</SelectItem>
                      <SelectItem value="broker">Broker</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  className="mt-5"
                  disabled={updateRoleMutation.isPending || !selectedRole || selectedRole === user.role}
                  onClick={() => {
                    if (!selectedRole) return;
                    updateRoleMutation.mutate({
                      userId: user.id,
                      role: selectedRole as "user" | "admin" | "farmer" | "trader" | "broker",
                    });
                  }}
                >
                  {updateRoleMutation.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  ) : null}
                  Apply Role
                </Button>
              </div>

              <Separator />

              {/* Danger Zone */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">
                    Suspend this user (resets role to <code className="text-xs">user</code> and logs the action).
                    To reinstate, change their role above.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={suspendMutation.isPending || user.role === "user"}
                  onClick={() => {
                    if (!confirm(`Suspend ${user.name ?? "this user"}? This will reset their role to 'user'.`)) return;
                    suspendMutation.mutate({ userId: user.id, reason: "Admin suspension" });
                  }}
                >
                  {suspendMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <ShieldX className="w-3 h-3 mr-1" />}
                  Suspend User
                </Button>

                {user.role !== "admin" && (
                  <Button
                    size="sm"
                    className="bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30"
                    disabled={promoteMutation.isPending}
                    onClick={() => {
                      if (!confirm(`Promote ${user.name ?? "this user"} to admin?`)) return;
                      promoteMutation.mutate({ userId: user.id });
                    }}
                  >
                    {promoteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <ShieldCheck className="w-3 h-3 mr-1" />}
                    Promote to Admin
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Refresh ─────────────────────────────────────────────────────── */}
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" />
            Refresh
          </Button>
        </div>

      </div>
    </DashboardLayout>
  );
}
