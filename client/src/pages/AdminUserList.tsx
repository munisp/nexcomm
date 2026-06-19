/**
 * AdminUserList.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin User Management — full list with search, filter, suspend, promote,
 * and navigation to individual user detail pages.
 *
 * Wired to:
 *   trpc.userManagement.adminListUsers   — paginated user list with search
 *   trpc.userManagement.adminUpdateUserStatus — suspend / deactivate
 *   trpc.profile.updateRole              — promote / demote admin
 */
import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Users, Search, Shield, ShieldOff, UserCheck, UserX,
  RefreshCw, ChevronLeft, ChevronRight, Eye, Crown,
  AlertTriangle, CheckCircle2, Clock, Ban, MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { PageSkeleton } from "@/components/PageSkeleton";

// ── Types ─────────────────────────────────────────────────────────────────────

type UserStatus = "active" | "suspended" | "deactivated" | "pending" | "all";

interface UserRow {
  id: number;
  name?: string | null;
  email?: string | null;
  role: "admin" | "user";
  loginMethod?: string | null;
  createdAt: string | Date;
  lastSignedIn?: string | Date | null;
  status?: string;
}

// ── Status badge config ───────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  active:      { label: "Active",      className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  suspended:   { label: "Suspended",   className: "bg-amber-500/10 text-amber-400 border-amber-500/30",       icon: AlertTriangle },
  deactivated: { label: "Deactivated", className: "bg-red-500/10 text-red-400 border-red-500/30",             icon: Ban },
  pending:     { label: "Pending",     className: "bg-blue-500/10 text-blue-400 border-blue-500/30",          icon: Clock },
};

const ROLE_CONFIG: Record<string, { label: string; className: string }> = {
  admin: { label: "Admin", className: "bg-purple-500/10 text-purple-400 border-purple-500/30" },
  user:  { label: "User",  className: "bg-slate-500/10 text-muted-foreground border-slate-500/30" },
};

// ── Helper ────────────────────────────────────────────────────────────────────

function formatDate(d?: string | Date | null): string {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return "—"; }
}

function initials(name?: string | null, email?: string | null): string {
  if (name) return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  if (email) return email[0].toUpperCase();
  return "?";
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function AdminUserList() {
  const { user: me } = useAuth();
  const [, navigate] = useLocation();

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<UserStatus>("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  // Action state
  const [actionUser, setActionUser] = useState<UserRow | null>(null);
  const [actionType, setActionType] = useState<"suspend" | "deactivate" | "activate" | "promote" | "demote" | null>(null);
  const [actionReason, setActionReason] = useState("");

  const utils = trpc.useUtils();

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data, isLoading, refetch } = trpc.userManagement.adminListUsers.useQuery(
    { page, pageSize: PAGE_SIZE, search: search || undefined, status: statusFilter },
    { enabled: me?.role === "admin" }
  );

  // Normalise response — service returns {users, total} or DB fallback same shape
  const users: UserRow[] = (data as any)?.users ?? [];
  const total: number = (data as any)?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const updateStatus = trpc.userManagement.adminUpdateUserStatus.useMutation({
    onSuccess: () => {
      toast.success(`User ${actionType}d successfully`);
      setActionUser(null);
      setActionType(null);
      setActionReason("");
      utils.userManagement.adminListUsers.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateRole = trpc.profile.updateRole.useMutation({
    onSuccess: () => {
      toast.success(`Role updated successfully`);
      setActionUser(null);
      setActionType(null);
      utils.userManagement.adminListUsers.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const handleAction = useCallback(() => {
    if (!actionUser || !actionType) return;
    if (actionType === "promote") {
      updateRole.mutate({ userId: actionUser.id, role: "admin" });
    } else if (actionType === "demote") {
      updateRole.mutate({ userId: actionUser.id, role: "user" });
    } else {
      const statusMap = { suspend: "suspended", deactivate: "deactivated", activate: "active" } as const;
      updateStatus.mutate({
        userId: actionUser.id,
        status: statusMap[actionType as keyof typeof statusMap],
        reason: actionReason || undefined,
      });
    }
  }, [actionUser, actionType, actionReason, updateRole, updateStatus]);

  const handleSearch = useCallback((v: string) => {
    setSearch(v);
    setPage(1);
  }, []);

  const handleStatusFilter = useCallback((v: string) => {
    setStatusFilter(v as UserStatus);
    setPage(1);
  }, []);

  // ── Guard ─────────────────────────────────────────────────────────────────────

  if (me && me.role !== "admin") {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center space-y-3">
            <Shield className="w-12 h-12 text-muted-foreground mx-auto" />
            <h2 className="text-xl font-bold">Access Restricted</h2>
            <p className="text-muted-foreground text-sm">Admin access required.</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 bg-background min-h-screen">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Users className="h-6 w-6 text-blue-400" />
              User Management
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {total > 0 ? `${total.toLocaleString()} registered users` : "Loading…"}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}
            className="border-border text-muted-foreground hover:bg-secondary">
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email…" value={search} onChange={e => handleSearch(e.target.value)}
                  className="pl-9 bg-secondary border-border text-white placeholder:text-muted-foreground"
                />
              </div>
              <Select value={statusFilter} onValueChange={handleStatusFilter}>
                <SelectTrigger className="w-40 bg-secondary border-border text-white">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className="bg-secondary border-border">
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                  <SelectItem value="deactivated">Deactivated</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* User Table */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-sm">
              {isLoading ? "Loading…" : `Showing ${users.length} of ${total} users`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : users.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p>No users found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                      <th className="text-left px-4 py-3">User</th>
                      <th className="text-left px-4 py-3 hidden md:table-cell">Email</th>
                      <th className="text-left px-4 py-3">Role</th>
                      <th className="text-left px-4 py-3 hidden lg:table-cell">Status</th>
                      <th className="text-left px-4 py-3 hidden lg:table-cell">Joined</th>
                      <th className="text-left px-4 py-3 hidden xl:table-cell">Last Sign-in</th>
                      <th className="text-right px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => {
                      const statusKey = (u.status ?? "active") as string;
                      const statusCfg = STATUS_CONFIG[statusKey] ?? STATUS_CONFIG.active;
                      const roleCfg = ROLE_CONFIG[u.role] ?? ROLE_CONFIG.user;
                      const StatusIcon = statusCfg.icon;
                      const isSelf = u.id === me?.id;

  if (isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={5} />;
                      return (
                        <tr key={u.id}
                          className="border-b border-border hover:bg-secondary/50 transition-colors">
                          {/* Avatar + Name */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center
                                text-xs font-bold text-muted-foreground flex-shrink-0">
                                {initials(u.name, u.email)}
                              </div>
                              <div>
                                <p className="text-white font-medium leading-tight">
                                  {u.name ?? "—"}
                                  {isSelf && <span className="ml-1 text-xs text-blue-400">(you)</span>}
                                </p>
                                <p className="text-muted-foreground text-xs">ID #{u.id}</p>
                              </div>
                            </div>
                          </td>
                          {/* Email */}
                          <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">
                            {u.email ?? "—"}
                          </td>
                          {/* Role */}
                          <td className="px-4 py-3">
                            <Badge variant="outline" className={`text-xs ${roleCfg.className}`}>
                              {u.role === "admin" && <Crown className="h-3 w-3 mr-1" />}
                              {roleCfg.label}
                            </Badge>
                          </td>
                          {/* Status */}
                          <td className="px-4 py-3 hidden lg:table-cell">
                            <Badge variant="outline" className={`text-xs ${statusCfg.className}`}>
                              <StatusIcon className="h-3 w-3 mr-1" />
                              {statusCfg.label}
                            </Badge>
                          </td>
                          {/* Joined */}
                          <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs">
                            {formatDate(u.createdAt)}
                          </td>
                          {/* Last sign-in */}
                          <td className="px-4 py-3 hidden xl:table-cell text-muted-foreground text-xs">
                            {formatDate(u.lastSignedIn)}
                          </td>
                          {/* Actions */}
                          <td className="px-4 py-3 text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-white hover:bg-muted">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end"
                                className="bg-secondary border-border text-foreground">
                                <DropdownMenuItem
                                  onClick={() => navigate(`/admin/users/${u.id}`)}
                                  className="cursor-pointer hover:bg-muted">
                                  <Eye className="h-4 w-4 mr-2 text-blue-400" />
                                  View Detail
                                </DropdownMenuItem>
                                <DropdownMenuSeparator className="bg-muted" />
                                {/* Role actions */}
                                {!isSelf && u.role !== "admin" && (
                                  <DropdownMenuItem
                                    onClick={() => { setActionUser(u); setActionType("promote"); }}
                                    className="cursor-pointer hover:bg-muted">
                                    <Crown className="h-4 w-4 mr-2 text-purple-400" />
                                    Promote to Admin
                                  </DropdownMenuItem>
                                )}
                                {!isSelf && u.role === "admin" && (
                                  <DropdownMenuItem
                                    onClick={() => { setActionUser(u); setActionType("demote"); }}
                                    className="cursor-pointer hover:bg-muted text-amber-400">
                                    <ShieldOff className="h-4 w-4 mr-2" />
                                    Remove Admin Role
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator className="bg-muted" />
                                {/* Status actions */}
                                {!isSelf && statusKey !== "active" && (
                                  <DropdownMenuItem
                                    onClick={() => { setActionUser(u); setActionType("activate"); }}
                                    className="cursor-pointer hover:bg-muted text-emerald-400">
                                    <UserCheck className="h-4 w-4 mr-2" />
                                    Activate Account
                                  </DropdownMenuItem>
                                )}
                                {!isSelf && statusKey === "active" && (
                                  <DropdownMenuItem
                                    onClick={() => { setActionUser(u); setActionType("suspend"); }}
                                    className="cursor-pointer hover:bg-muted text-amber-400">
                                    <AlertTriangle className="h-4 w-4 mr-2" />
                                    Suspend Account
                                  </DropdownMenuItem>
                                )}
                                {!isSelf && statusKey !== "deactivated" && (
                                  <DropdownMenuItem
                                    onClick={() => { setActionUser(u); setActionType("deactivate"); }}
                                    className="cursor-pointer hover:bg-muted text-red-400">
                                    <UserX className="h-4 w-4 mr-2" />
                                    Deactivate Account
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-sm">
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="border-border text-muted-foreground hover:bg-secondary">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="border-border text-muted-foreground hover:bg-secondary">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={!!actionUser && !!actionType} onOpenChange={() => { setActionUser(null); setActionType(null); setActionReason(""); }}>
        <DialogContent className="bg-card border-border text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {actionType === "promote" && <><Crown className="h-5 w-5 text-purple-400" /> Promote to Admin</>}
              {actionType === "demote" && <><ShieldOff className="h-5 w-5 text-amber-400" /> Remove Admin Role</>}
              {actionType === "suspend" && <><AlertTriangle className="h-5 w-5 text-amber-400" /> Suspend Account</>}
              {actionType === "activate" && <><UserCheck className="h-5 w-5 text-emerald-400" /> Activate Account</>}
              {actionType === "deactivate" && <><UserX className="h-5 w-5 text-red-400" /> Deactivate Account</>}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {actionType === "promote" && `Grant admin privileges to ${actionUser?.name ?? actionUser?.email}?`}
              {actionType === "demote" && `Remove admin privileges from ${actionUser?.name ?? actionUser?.email}?`}
              {actionType === "suspend" && `Temporarily suspend ${actionUser?.name ?? actionUser?.email}?`}
              {actionType === "activate" && `Reactivate ${actionUser?.name ?? actionUser?.email}?`}
              {actionType === "deactivate" && `Permanently deactivate ${actionUser?.name ?? actionUser?.email}? This cannot be undone without manual intervention.`}
            </DialogDescription>
          </DialogHeader>
          {(actionType === "suspend" || actionType === "deactivate") && (
            <div className="mt-2">
              <label className="text-xs text-muted-foreground mb-1 block">Reason (optional)</label>
              <Input
                value={actionReason}
                onChange={e => setActionReason(e.target.value)}
                placeholder="Enter reason for this action…"
                className="bg-secondary border-border text-white placeholder:text-muted-foreground"
              />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setActionUser(null); setActionType(null); setActionReason(""); }}
              className="border-border text-muted-foreground hover:bg-secondary">
              Cancel
            </Button>
            <Button
              onClick={handleAction}
              disabled={updateStatus.isPending || updateRole.isPending}
              className={
                actionType === "deactivate" ? "bg-red-600 hover:bg-red-700 text-white" :
                actionType === "suspend" ? "bg-amber-600 hover:bg-amber-700 text-white" :
                actionType === "promote" ? "bg-purple-600 hover:bg-purple-700 text-white" :
                "bg-emerald-600 hover:bg-emerald-700 text-white"
              }>
              {(updateStatus.isPending || updateRole.isPending) ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
