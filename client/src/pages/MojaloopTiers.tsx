/**
 * NEXCOM Exchange — DFSP Tier Management Page
 * Route: /mojaloop/tiers
 *
 * Allows admins to:
 *  - View all DFSP tiers with their fee schedules and limits
 *  - Edit tier limits (daily limit, min/max transfer, settlement window)
 *  - Upsert fee schedules (flat fee + percentage per currency)
 *  - Assign tiers to DFSPs from the registry
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Building2,
  ChevronRight,
  DollarSign,
  Edit,
  Layers,
  RefreshCw,
  Shield,
  Users,
} from "lucide-react";
import { MojaloopHubBanner } from "@/components/MojaloopHubBanner";
import { PageSkeleton } from "@/components/PageSkeleton";

const TIER_NAMES = ["STANDARD", "PREMIUM", "INSTITUTIONAL", "CORRESPONDENT"] as const;
type TierName = (typeof TIER_NAMES)[number];

const TIER_COLORS: Record<TierName, string> = {
  STANDARD: "bg-slate-100 text-slate-700 border-slate-200",
  PREMIUM: "bg-blue-100 text-blue-700 border-blue-200",
  INSTITUTIONAL: "bg-purple-100 text-purple-700 border-purple-200",
  CORRESPONDENT: "bg-amber-100 text-amber-700 border-amber-200",
};

const TIER_ICONS: Record<TierName, React.ElementType> = {
  STANDARD: Users,
  PREMIUM: Shield,
  INSTITUTIONAL: Building2,
  CORRESPONDENT: Layers,
};

// ─── Edit Tier Dialog ─────────────────────────────────────────────────────────
function EditTierDialog({
  tier,
  onSuccess,
}: {
  tier: {
    name: TierName;
    displayName: string;
    description: string | null;
    dailyLimitAmount: string;
    minTransferAmount: string;
    maxTransferAmount: string;
    allowedCurrencies: string;
    settlementWindowHrs: number;
    isActive: boolean;
  };
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    displayName: tier.displayName,
    description: tier.description ?? "",
    dailyLimitAmount: tier.dailyLimitAmount,
    minTransferAmount: tier.minTransferAmount,
    maxTransferAmount: tier.maxTransferAmount,
    allowedCurrencies: tier.allowedCurrencies,
    settlementWindowHrs: tier.settlementWindowHrs,
  });

  const update = trpc.mojaloopTiers.updateTier.useMutation({
    onSuccess: () => {
      toast.success(`Tier ${tier.name} updated`);
      setOpen(false);
      onSuccess();
    },
    onError: (err) => toast.error(`Update failed: ${err.message}`),
  });

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Edit className="w-3 h-3 mr-1" /> Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit {tier.displayName} Tier</DialogTitle>
            <DialogDescription>
              Update transfer limits and settlement window for this tier.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Daily Limit (NGN)</Label>
                <Input
                  type="number"
                  value={form.dailyLimitAmount}
                  onChange={(e) => setForm((f) => ({ ...f, dailyLimitAmount: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Settlement Window (hours)</Label>
                <Input
                  type="number"
                  min={1}
                  max={168}
                  value={form.settlementWindowHrs}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, settlementWindowHrs: parseInt(e.target.value) || 24 }))
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Min Transfer Amount</Label>
                <Input
                  type="number"
                  value={form.minTransferAmount}
                  onChange={(e) => setForm((f) => ({ ...f, minTransferAmount: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Max Transfer Amount</Label>
                <Input
                  type="number"
                  value={form.maxTransferAmount}
                  onChange={(e) => setForm((f) => ({ ...f, maxTransferAmount: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Allowed Currencies (comma-separated)</Label>
              <Input
                value={form.allowedCurrencies}
                onChange={(e) => setForm((f) => ({ ...f, allowedCurrencies: e.target.value }))}
                placeholder="NGN,USD,GHS"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                update.mutate({
                  name: tier.name,
                  dailyLimitAmount: form.dailyLimitAmount,
                  minTransferAmount: form.minTransferAmount,
                  maxTransferAmount: form.maxTransferAmount,
                  allowedCurrencies: form.allowedCurrencies,
                  settlementWindowHrs: form.settlementWindowHrs,
                  description: form.description || undefined,
                })
              }
              disabled={update.isPending}
            >
              {update.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Edit Fee Schedule Dialog ─────────────────────────────────────────────────
function EditFeeScheduleDialog({
  tierName,
  schedule,
  onSuccess,
}: {
  tierName: TierName;
  schedule?: {
    currency: string;
    flatFee: string;
    percentageFee: string;
    minFee: string;
    maxFee: string | null;
    isActive: boolean;
  };
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    currency: schedule?.currency ?? "NGN",
    flatFee: schedule?.flatFee ?? "0",
    percentageFee: schedule?.percentageFee ?? "0.5",
    minFee: schedule?.minFee ?? "0",
    maxFee: schedule?.maxFee ?? "",
    isActive: schedule?.isActive ?? true,
  });

  const upsert = trpc.mojaloopTiers.upsertFeeSchedule.useMutation({
    onSuccess: () => {
      toast.success(`Fee schedule for ${form.currency} saved`);
      setOpen(false);
      onSuccess();
    },
    onError: (err) => toast.error(`Save failed: ${err.message}`),
  });

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {schedule ? <Edit className="w-3 h-3 mr-1" /> : <span className="mr-1">+</span>}
        {schedule ? "Edit" : "Add Schedule"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {schedule ? "Edit" : "Add"} Fee Schedule — {tierName}
            </DialogTitle>
            <DialogDescription>
              Configure flat fee + percentage for a specific currency.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select
                value={form.currency}
                onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}
                disabled={!!schedule}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["NGN", "USD", "EUR", "GBP", "GHS", "KES", "ZAR", "XOF", "XAF"].map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Flat Fee</Label>
                <Input
                  type="number"
                  step="0.000001"
                  value={form.flatFee}
                  onChange={(e) => setForm((f) => ({ ...f, flatFee: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Percentage Fee (%)</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={form.percentageFee}
                  onChange={(e) => setForm((f) => ({ ...f, percentageFee: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Min Fee</Label>
                <Input
                  type="number"
                  step="0.000001"
                  value={form.minFee}
                  onChange={(e) => setForm((f) => ({ ...f, minFee: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Max Fee (blank = no cap)</Label>
                <Input
                  type="number"
                  step="0.000001"
                  value={form.maxFee}
                  onChange={(e) => setForm((f) => ({ ...f, maxFee: e.target.value }))}
                  placeholder="No cap"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isActive"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                className="w-4 h-4"
              />
              <Label htmlFor="isActive">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                upsert.mutate({
                  tierName,
                  currency: form.currency,
                  flatFee: form.flatFee,
                  percentageFee: form.percentageFee,
                  minFee: form.minFee,
                  maxFee: form.maxFee || null,
                  isActive: form.isActive,
                })
              }
              disabled={upsert.isPending}
            >
              {upsert.isPending ? "Saving…" : "Save Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Assign Tier Dialog ───────────────────────────────────────────────────────
function AssignTierDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fspId: "", tierName: "STANDARD" as TierName });

  const { data: dfsps } = trpc.mojaloopTiers.listDfspsWithTiers.useQuery();
  const assign = trpc.mojaloopTiers.assignTier.useMutation({
    onSuccess: () => {
      toast.success(`Tier assigned to ${form.fspId}`);
      setOpen(false);
      onSuccess();
    },
    onError: (err) => toast.error(`Assignment failed: ${err.message}`),
  });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <ChevronRight className="w-4 h-4 mr-2" />
        Assign Tier to DFSP
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Tier to DFSP</DialogTitle>
            <DialogDescription>
              Change the fee tier for a registered DFSP.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>DFSP</Label>
              <Select value={form.fspId} onValueChange={(v) => setForm((f) => ({ ...f, fspId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select DFSP" />
                </SelectTrigger>
                <SelectContent>
                  {dfsps?.map((d) => (
                    <SelectItem key={d.fspId} value={d.fspId}>
                      {d.name} ({d.fspId}) — {d.tier ?? "STANDARD"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>New Tier</Label>
              <Select
                value={form.tierName}
                onValueChange={(v) => setForm((f) => ({ ...f, tierName: v as TierName }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIER_NAMES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => assign.mutate({ fspId: form.fspId, tierName: form.tierName })}
              disabled={assign.isPending || !form.fspId}
            >
              {assign.isPending ? "Assigning…" : "Assign Tier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MojaloopTiers() {
  const utils = trpc.useUtils();
  const refresh = () => {
    utils.mojaloopTiers.listTiers.invalidate();
    utils.mojaloopTiers.listDfspsWithTiers.invalidate();
  };

  const { data: tiers, isLoading } = trpc.mojaloopTiers.listTiers.useQuery();
  const { data: dfsps } = trpc.mojaloopTiers.listDfspsWithTiers.useQuery();

  const [selectedTier, setSelectedTier] = useState<TierName>("STANDARD");
  const activeTier = tiers?.find((t) => t.name === selectedTier);

  return (
    <div className="flex flex-col">
      <MojaloopHubBanner />
      <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="w-6 h-6 text-primary" />
            DFSP Tier Management
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure fee schedules, transfer limits, and tier assignments for DFSPs.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <AssignTierDialog onSuccess={refresh} />
        </div>
      </div>

      <Tabs value={selectedTier} onValueChange={(v) => setSelectedTier(v as TierName)}>
        {/* Tier selector tabs */}
        <TabsList className="grid grid-cols-4 w-full">
          {TIER_NAMES.map((tier) => {
            const Icon = TIER_ICONS[tier];
            const count = dfsps?.filter((d) => (d.tier ?? "STANDARD") === tier).length ?? 0;
            return (
              <TabsTrigger key={tier} value={tier} className="flex items-center gap-2">
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tier}</span>
                {count > 0 && (
                  <Badge variant="secondary" className="text-xs px-1.5 py-0">
                    {count}
                  </Badge>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {TIER_NAMES.map((tierName) => {
          const tier = tiers?.find((t) => t.name === tierName);
          const tierDfsps = dfsps?.filter((d) => (d.tier ?? "STANDARD") === tierName) ?? [];

  if (isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
          return (
            <TabsContent key={tierName} value={tierName} className="space-y-4 mt-4">
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading tier data…</div>
              ) : tier ? (
                <>
                  {/* Tier Overview Card */}
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`px-3 py-1 rounded-full text-sm font-semibold border ${TIER_COLORS[tierName]}`}>
                            {tier.displayName}
                          </div>
                          <Badge variant={tier.isActive ? "default" : "secondary"}>
                            {tier.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        <EditTierDialog
                          tier={{
                            name: tierName,
                            displayName: tier.displayName,
                            description: tier.description,
                            dailyLimitAmount: tier.dailyLimitAmount,
                            minTransferAmount: tier.minTransferAmount,
                            maxTransferAmount: tier.maxTransferAmount,
                            allowedCurrencies: tier.allowedCurrencies,
                            settlementWindowHrs: tier.settlementWindowHrs,
                            isActive: tier.isActive,
                          }}
                          onSuccess={refresh}
                        />
                      </div>
                      {tier.description && (
                        <CardDescription className="mt-2">{tier.description}</CardDescription>
                      )}
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground uppercase tracking-wide">Daily Limit</p>
                          <p className="font-semibold">
                            {parseFloat(tier.dailyLimitAmount).toLocaleString()} {tier.dailyLimitCurrency}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground uppercase tracking-wide">Min Transfer</p>
                          <p className="font-semibold">{parseFloat(tier.minTransferAmount).toLocaleString()}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground uppercase tracking-wide">Max Transfer</p>
                          <p className="font-semibold">{parseFloat(tier.maxTransferAmount).toLocaleString()}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground uppercase tracking-wide">Settlement Window</p>
                          <p className="font-semibold">
                            {tier.settlementWindowHrs}h
                            {tier.settlementWindowHrs <= 4
                              ? " (T+0)"
                              : tier.settlementWindowHrs <= 12
                              ? " (Same-day)"
                              : " (T+1)"}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                          Allowed Currencies
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {tier.allowedCurrencies.split(",").map((c) => (
                            <Badge key={c} variant="outline" className="text-xs">
                              {c.trim()}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Fee Schedules */}
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base flex items-center gap-2">
                          <DollarSign className="w-4 h-4" />
                          Fee Schedules
                        </CardTitle>
                        <EditFeeScheduleDialog tierName={tierName} onSuccess={refresh} />
                      </div>
                      <CardDescription>
                        Flat fee + percentage per currency. Formula: max(minFee, flatFee + amount × %/100)
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {tier.feeSchedules.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                          No fee schedules configured. Add one above.
                        </p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Currency</TableHead>
                              <TableHead className="text-right">Flat Fee</TableHead>
                              <TableHead className="text-right">% Fee</TableHead>
                              <TableHead className="text-right">Min Fee</TableHead>
                              <TableHead className="text-right">Max Fee</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {tier.feeSchedules.map((s) => (
                              <TableRow key={s.id}>
                                <TableCell>
                                  <Badge variant="outline">{s.currency}</Badge>
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {parseFloat(s.flatFee).toFixed(4)}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {parseFloat(s.percentageFee).toFixed(4)}%
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {parseFloat(s.minFee).toFixed(4)}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {s.maxFee ? parseFloat(s.maxFee).toFixed(4) : "—"}
                                </TableCell>
                                <TableCell>
                                  <Badge variant={s.isActive ? "default" : "secondary"}>
                                    {s.isActive ? "Active" : "Inactive"}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                  <EditFeeScheduleDialog
                                    tierName={tierName}
                                    schedule={{
                                      currency: s.currency,
                                      flatFee: s.flatFee,
                                      percentageFee: s.percentageFee,
                                      minFee: s.minFee,
                                      maxFee: s.maxFee,
                                      isActive: s.isActive,
                                    }}
                                    onSuccess={refresh}
                                  />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>

                  {/* DFSPs in this tier */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Building2 className="w-4 h-4" />
                        DFSPs on this Tier ({tierDfsps.length})
                      </CardTitle>
                      <CardDescription>
                        Financial service providers currently assigned to the {tier.displayName} tier.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {tierDfsps.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                          No DFSPs assigned to this tier yet.
                        </p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>FSP ID</TableHead>
                              <TableHead>Name</TableHead>
                              <TableHead>Currency</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Joined</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {tierDfsps.map((d) => (
                              <TableRow key={d.fspId}>
                                <TableCell className="font-mono text-sm">{d.fspId}</TableCell>
                                <TableCell className="font-medium">{d.name}</TableCell>
                                <TableCell>
                                  <Badge variant="outline">{d.currency ?? "NGN"}</Badge>
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={d.status === "ACTIVE" ? "default" : "secondary"}
                                  >
                                    {d.status ?? "ACTIVE"}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-muted-foreground text-sm">
                                  {d.createdAt
                                    ? new Date(d.createdAt).toLocaleDateString()
                                    : "—"}
                                </TableCell>
                                <TableCell className="text-right">
                                  <AssignTierDialog onSuccess={refresh} />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  Tier data not available.
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
      </div>
    </div>
  );
}
