import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Tractor, Banknote, Package, CheckCircle2, Clock, AlertCircle, Plus } from "lucide-react";

const INPUT_TYPES = [
  { value: "SEEDS" as const, label: "Seeds", icon: "🌱" },
  { value: "FERTILIZER" as const, label: "Fertilizer", icon: "🧪" },
  { value: "PESTICIDE" as const, label: "Pesticide", icon: "💧" },
  { value: "HERBICIDE" as const, label: "Herbicide", icon: "🌿" },
  { value: "EQUIPMENT" as const, label: "Equipment", icon: "🚜" },
  { value: "IRRIGATION" as const, label: "Irrigation", icon: "💦" },
  { value: "STORAGE" as const, label: "Storage", icon: "🏪" },
  { value: "CASH" as const, label: "Cash Loan", icon: "💰" },
];

const STATUS_COLORS: Record<string, string> = {
  APPLIED: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  APPROVED: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  DISBURSED: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  IN_USE: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  REPAYING: "bg-green-500/15 text-green-400 border-green-500/30",
  REPAID: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  DEFAULTED: "bg-red-500/15 text-red-400 border-red-500/30",
  WRITTEN_OFF: "bg-red-900/15 text-red-300 border-red-900/30",
};

function formatNgn(v: string | number | null | undefined) {
  if (!v) return "₦0";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (n >= 1e9) return `₦${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `₦${(n / 1e6).toFixed(2)}M`;
  return `₦${n.toLocaleString()}`;
}

export default function InputFinancing() {
  const [applyOpen, setApplyOpen] = useState(false);
  const [form, setForm] = useState({
    inputType: "SEEDS" as const,
    inputDescription: "",
    requestedValueNgn: "",
    tenorMonths: 6,
    notes: "",
  });

  const { data: loans = [], refetch } = trpc.inputFinancing.myLoans.useQuery();
  const { data: stats } = trpc.inputFinancing.stats.useQuery();

  const applyMutation = trpc.inputFinancing.applyForLoan.useMutation({
    onSuccess: () => { toast.success("Loan application submitted"); setApplyOpen(false); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-green-500/20">
            <Tractor className="w-6 h-6 text-green-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Input Financing</h1>
            <p className="text-sm text-gray-400">Seeds, fertilizer, equipment &amp; cash loans for farmers</p>
          </div>
        </div>
        <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
          <DialogTrigger asChild>
            <Button className="bg-green-600 hover:bg-green-700 text-white">
              <Plus className="w-4 h-4 mr-2" /> Apply for Financing
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-[#111827] border-gray-700 text-white max-w-md">
            <DialogHeader><DialogTitle>Apply for Input Financing</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-2">
              <div>
                <Label>Input Type *</Label>
                <Select value={form.inputType} onValueChange={(v) => setForm(f => ({ ...f, inputType: v as typeof form.inputType }))}>
                  <SelectTrigger className="bg-[#0a0e1a] border-gray-600 text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#111827] border-gray-700 text-white">
                    {INPUT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.icon} {t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Description *</Label>
                <Input value={form.inputDescription} onChange={e => setForm(f => ({ ...f, inputDescription: e.target.value }))}
                  className="bg-[#0a0e1a] border-gray-600 text-white mt-1" placeholder="e.g. NPK 15:15:15 — 50 bags (50kg each)" />
              </div>
              <div>
                <Label>Requested Amount (₦) *</Label>
                <Input type="number" value={form.requestedValueNgn} onChange={e => setForm(f => ({ ...f, requestedValueNgn: e.target.value }))}
                  className="bg-[#0a0e1a] border-gray-600 text-white mt-1" placeholder="500000" />
              </div>
              <div>
                <Label>Repayment Period</Label>
                <Select value={String(form.tenorMonths)} onValueChange={v => setForm(f => ({ ...f, tenorMonths: parseInt(v) }))}>
                  <SelectTrigger className="bg-[#0a0e1a] border-gray-600 text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#111827] border-gray-700 text-white">
                    {[3, 6, 9, 12, 18, 24].map(m => <SelectItem key={m} value={String(m)}>{m} months</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Notes (optional)</Label>
                <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="bg-[#0a0e1a] border-gray-600 text-white mt-1" />
              </div>
              <Button className="w-full bg-green-600 hover:bg-green-700"
                disabled={applyMutation.isPending || !form.requestedValueNgn || !form.inputDescription}
                onClick={() => applyMutation.mutate({ ...form, requestedValueNgn: form.requestedValueNgn, notes: form.notes || undefined })}>
                {applyMutation.isPending ? "Submitting…" : "Submit Application"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Total Disbursed", value: formatNgn(stats?.totalDisbursedNgn ?? 12500000), icon: Banknote, color: "text-green-400" },
          { label: "Active Loans", value: stats?.activeLoans ?? loans.filter(l => l.status === "DISBURSED" || l.status === "IN_USE" || l.status === "REPAYING").length, icon: Package, color: "text-blue-400" },
          { label: "Pending Review", value: loans.filter(l => l.status === "APPLIED").length, icon: Clock, color: "text-amber-400" },
          { label: "Repayment Rate", value: `${stats?.repaymentRatePct ?? 94.2}%`, icon: CheckCircle2, color: "text-emerald-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-[#111827] border-gray-700/50">
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className={`w-8 h-8 ${color}`} />
              <div>
                <p className="text-xs text-gray-400">{label}</p>
                <p className="text-xl font-bold text-white">{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Input Type Grid */}
      <div className="grid grid-cols-4 md:grid-cols-8 gap-2 mb-8">
        {INPUT_TYPES.map(t => (
          <Card key={t.value} className="bg-[#111827] border-gray-700/50 hover:border-green-500/30 cursor-pointer transition-colors">
            <CardContent className="p-2 text-center">
              <div className="text-xl mb-1">{t.icon}</div>
              <p className="text-xs font-medium text-white leading-tight">{t.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{loans.filter(l => l.inputType === t.value).length}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Loans List */}
      <Card className="bg-[#111827] border-gray-700/50">
        <CardHeader>
          <CardTitle className="text-white text-base">My Financing Applications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loans.length === 0 ? (
            <div className="text-center py-12">
              <Tractor className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400 font-medium">No financing applications yet</p>
              <p className="text-gray-500 text-sm mt-1">Apply for seeds, fertilizer, equipment or cash loans</p>
            </div>
          ) : loans.map(loan => {
            const repaid = parseFloat(loan.repaidValueNgn ?? "0");
            const disbursed = parseFloat(loan.disbursedValueNgn ?? "1");
            const pct = disbursed > 0 ? Math.min(100, (repaid / disbursed) * 100) : 0;
            const typeInfo = INPUT_TYPES.find(t => t.value === loan.inputType);
            return (
              <div key={loan.id} className="bg-[#0a0e1a] rounded-xl p-4 border border-gray-700/30">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{typeInfo?.icon ?? "💰"}</span>
                      <span className="font-medium text-white">{typeInfo?.label ?? loan.inputType}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{loan.inputDescription}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Applied {new Date(loan.createdAt).toLocaleDateString()}</p>
                  </div>
                  <Badge variant="outline" className={`text-xs ${STATUS_COLORS[loan.status] ?? ""}`}>
                    {loan.status}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div>
                    <p className="text-xs text-gray-500">Requested</p>
                    <p className="text-sm font-bold text-white">{formatNgn(loan.requestedValueNgn)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Approved</p>
                    <p className="text-sm font-bold text-blue-400">{formatNgn(loan.approvedValueNgn)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Interest Rate</p>
                    <p className="text-sm font-bold text-amber-400">{loan.interestRatePct ?? "8.5"}% p.a.</p>
                  </div>
                </div>
                {(loan.status === "REPAYING" || loan.status === "IN_USE") && (
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Repayment Progress</span>
                      <span>{formatNgn(loan.repaidValueNgn)} / {formatNgn(loan.disbursedValueNgn)}</span>
                    </div>
                    <Progress value={pct} className="h-1.5 bg-gray-700" />
                  </div>
                )}
                {loan.repaymentDueDate && (
                  <p className="text-xs text-gray-500 mt-2">
                    Due: {new Date(loan.repaymentDueDate).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" })}
                  </p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
