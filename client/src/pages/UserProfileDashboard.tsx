/**
 * UserProfileDashboard — personal account overview
 * Shows: account details, order stats, order history (paginated + filtered),
 * open positions, recent fills, active alerts count, watchlist count.
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Pencil, Save, X as XIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  Bell,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Layers,
  TrendingUp,
  User,
} from "lucide-react";

// ── Profile edit form type ────────────────────────────────────────────────────
type ProfileEditForm = {
  firstName: string;
  lastName: string;
  phone: string;
  address: string;
  state: string;
  country: string;
  companyName: string;
  bankName: string;
  bankAccount: string;
};

// ── Status badge colours ──────────────────────────────────────────────────────
function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "FILLED":           return "default";
    case "OPEN":             return "secondary";
    case "PARTIALLY_FILLED": return "secondary";
    case "CANCELLED":        return "outline";
    case "REJECTED":         return "destructive";
    case "EXPIRED":          return "outline";
    default:                 return "secondary";
  }
}

function fmt(n: number | string | null | undefined) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-NG", { maximumFractionDigits: 4 });
}

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  loading,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  loading?: boolean;
}) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 mt-0.5">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            {loading ? (
              <Skeleton className="h-6 w-16 mt-1" />
            ) : (
              <p className="text-xl font-semibold tabular-nums">{value}</p>
            )}
            {sub && !loading && (
              <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function UserProfileDashboard() {
  // Pagination & filter state
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [assetClassFilter, setAssetClassFilter] = useState<string>("ALL");

  // tRPC queries
  const { data: dash, isLoading: dashLoading } = trpc.profile.dashboard.useQuery();

  const { data: history, isLoading: histLoading } = trpc.profile.orderHistory.useQuery(
    {
      page,
      pageSize,
      status: statusFilter !== "ALL" ? (statusFilter as any) : undefined,
      assetClass: assetClassFilter !== "ALL" ? (assetClassFilter as any) : undefined,
    }
  );

  const totalPages = history ? Math.ceil(history.total / pageSize) : 1;

  const user = dash?.user;
  const profile = dash?.profile;
  const stats = dash?.orderStats;

  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  const utils = trpc.useUtils();

  const form = useForm<ProfileEditForm>({
    values: {
      firstName: profile?.firstName ?? "",
      lastName: profile?.lastName ?? "",
      phone: profile?.phone ?? "",
      address: profile?.address ?? "",
      state: profile?.state ?? "",
      country: profile?.country ?? "",
      companyName: profile?.companyName ?? "",
      bankName: profile?.bankName ?? "",
      bankAccount: profile?.bankAccount ?? "",
    },
  });

  const updateProfile = trpc.profile.update.useMutation({
    onSuccess: () => {
      toast.success("Profile saved — your account details have been updated.");
      setEditMode(false);
      utils.profile.dashboard.invalidate();
    },
    onError: (err) => {
      toast.error(`Save failed: ${err.message}`);
    },
  });

  const handleSave = form.handleSubmit((data) => {
    updateProfile.mutate(data);
  });

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="rounded-full bg-primary/10 p-2">
          <User className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Profile</h1>
          <p className="text-sm text-muted-foreground">
            Account overview and trading history
          </p>
        </div>
      </div>

      {/* ── Account Details ─────────────────────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Account Details</CardTitle>
          {!dashLoading && !editMode && (
            <Button variant="ghost" size="sm" onClick={() => setEditMode(true)} className="gap-1.5">
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          )}
          {editMode && (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setEditMode(false); form.reset(); }} className="gap-1.5">
                <XIcon className="h-3.5 w-3.5" />
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={updateProfile.isPending} className="gap-1.5">
                <Save className="h-3.5 w-3.5" />
                {updateProfile.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {dashLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : editMode ? (
            /* ── Edit form ── */
            <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {([
                ["firstName", "First Name"],
                ["lastName", "Last Name"],
                ["phone", "Phone"],
                ["address", "Address"],
                ["state", "State"],
                ["country", "Country"],
                ["companyName", "Company Name"],
                ["bankName", "Bank Name"],
                ["bankAccount", "Bank Account Number"],
              ] as [keyof ProfileEditForm, string][]).map(([field, label]) => (
                <div key={field} className="space-y-1.5">
                  <Label htmlFor={field} className="text-xs">{label}</Label>
                  <Input
                    id={field}
                    {...form.register(field)}
                    className="h-8 text-sm"
                  />
                </div>
              ))}
            </form>
          ) : (
            /* ── Read-only view ── */
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-3 text-sm">
              <div>
                <span className="text-muted-foreground block text-xs mb-0.5">Name</span>
                <span className="font-medium">
                  {profile?.firstName && profile?.lastName
                    ? `${profile.firstName} ${profile.lastName}`
                    : user?.name ?? "—"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs mb-0.5">Email</span>
                <span className="font-medium truncate block">{user?.email ?? "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs mb-0.5">Account Type</span>
                <Badge variant="secondary" className="text-xs">
                  {profile?.accountType ?? "TRADER"}
                </Badge>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs mb-0.5">Role</span>
                <Badge variant={user?.role === "admin" ? "default" : "outline"} className="text-xs">
                  {user?.role ?? "user"}
                </Badge>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs mb-0.5">Phone</span>
                <span className="font-medium">{profile?.phone ?? "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs mb-0.5">State</span>
                <span className="font-medium">{profile?.state ?? "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs mb-0.5">Company</span>
                <span className="font-medium">{profile?.companyName ?? "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs mb-0.5">Member Since</span>
                <span className="font-medium">{fmtDate(user?.createdAt)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Stats Grid ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <StatCard icon={BookOpen}   label="Total Orders"      value={stats?.total ?? 0}           loading={dashLoading} />
        <StatCard icon={TrendingUp} label="Open Orders"       value={stats?.open ?? 0}            loading={dashLoading} />
        <StatCard icon={TrendingUp} label="Filled Orders"     value={stats?.filled ?? 0}          loading={dashLoading} />
        <StatCard icon={AlertCircle} label="Cancelled"        value={stats?.cancelled ?? 0}       loading={dashLoading} />
        <StatCard icon={Bell}       label="Active Alerts"     value={dash?.activeAlerts ?? 0}     loading={dashLoading} />
        <StatCard icon={Layers}     label="Watchlist Items"   value={dash?.watchlistCount ?? 0}   loading={dashLoading} />
      </div>

      {/* ── Open Positions ──────────────────────────────────────────────────── */}
      {(dashLoading || (dash?.openPositions?.length ?? 0) > 0) && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Open Positions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {dashLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Asset Class</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Avg Cost</TableHead>
                      <TableHead className="text-right">Realised P&L</TableHead>
                      <TableHead>Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dash?.openPositions?.map((pos) => (
                      <TableRow key={pos.id}>
                        <TableCell className="font-mono text-sm font-medium">{pos.symbol}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{pos.assetClass}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(pos.quantity)}</TableCell>
                        <TableCell className="text-right tabular-nums">₦{fmt(pos.avgCost)}</TableCell>
                        <TableCell className={`text-right tabular-nums font-medium ${Number(pos.realizedPnl) >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {Number(pos.realizedPnl) >= 0 ? "+" : ""}₦{fmt(pos.realizedPnl)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDate(pos.updatedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Recent Fills ────────────────────────────────────────────────────── */}
      {(dashLoading || (dash?.recentFills?.length ?? 0) > 0) && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Fills</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {dashLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Fill Price</TableHead>
                      <TableHead className="text-right">Gross Value</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dash?.recentFills?.map((fill) => {
                      const isBuyer = fill.buyerUserId === dash.user?.id;
                      return (
                        <TableRow key={fill.id}>
                          <TableCell className="font-mono text-sm font-medium">{fill.symbol}</TableCell>
                          <TableCell>
                            <Badge
                              variant={isBuyer ? "default" : "secondary"}
                              className={`text-xs ${isBuyer ? "bg-green-600" : "bg-red-600"} text-white`}
                            >
                              {isBuyer ? "BUY" : "SELL"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(fill.filledQty)}</TableCell>
                          <TableCell className="text-right tabular-nums">₦{fmt(fill.fillPrice)}</TableCell>
                          <TableCell className="text-right tabular-nums">₦{fmt(fill.grossValue)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fmtDate(fill.createdAt)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Order History ───────────────────────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="text-base">Order History</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Status filter */}
              <Select
                value={statusFilter}
                onValueChange={(v) => { setStatusFilter(v); setPage(1); }}
              >
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="OPEN">Open</SelectItem>
                  <SelectItem value="PARTIALLY_FILLED">Partially Filled</SelectItem>
                  <SelectItem value="FILLED">Filled</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  <SelectItem value="REJECTED">Rejected</SelectItem>
                  <SelectItem value="EXPIRED">Expired</SelectItem>
                </SelectContent>
              </Select>
              {/* Asset class filter */}
              <Select
                value={assetClassFilter}
                onValueChange={(v) => { setAssetClassFilter(v); setPage(1); }}
              >
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue placeholder="All Classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Classes</SelectItem>
                  <SelectItem value="COMMODITY">Commodity</SelectItem>
                  <SelectItem value="FOREX">Forex</SelectItem>
                  <SelectItem value="EQUITY">Equity</SelectItem>
                  <SelectItem value="DIGITAL_ASSET">Digital Asset</SelectItem>
                  <SelectItem value="INDEX">Index</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {histLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !history?.items?.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <BookOpen className="h-8 w-8 opacity-40" />
              <p className="text-sm">No orders found</p>
              {(statusFilter !== "ALL" || assetClassFilter !== "ALL") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setStatusFilter("ALL"); setAssetClassFilter("ALL"); setPage(1); }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Filled</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.items.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          #{order.id}
                        </TableCell>
                        <TableCell className="font-mono text-sm font-medium">
                          {order.symbol}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={order.side === "BUY" ? "default" : "secondary"}
                            className={`text-xs ${order.side === "BUY" ? "bg-green-600" : "bg-red-600"} text-white`}
                          >
                            {order.side}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{order.orderType}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {fmt(order.quantity)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {order.price ? `₦${fmt(order.price)}` : "MKT"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {fmt(order.filledQty)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(order.status)} className="text-xs">
                            {order.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {fmtDate(order.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, history.total)} of{" "}
                  {history.total} orders
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="text-xs px-2">
                    {page} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
