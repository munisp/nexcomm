/**
 * NEXCOM Exchange — Broker Commission Dashboard
 * Full CRUD: client management, commission earnings, and trade routing history.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";
import {
import { PageSkeleton } from "@/components/PageSkeleton";
  Users,
  DollarSign,
  TrendingUp,
  ArrowLeft,
  Plus,
  Edit2,
  Trash2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

type Tab = "clients" | "commissions" | "trades";

export default function BrokerCommissions() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<Tab>("clients");
  const [clientPage, setClientPage] = useState(1);
  const [commPage, setCommPage] = useState(1);
  const [tradePage, setTradePage] = useState(1);
  const [clientStatusFilter, setClientStatusFilter] = useState<string>("ALL");
  const [commStatusFilter, setCommStatusFilter] = useState<string>("ALL");

  // Add client dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [editClient, setEditClient] = useState<{ id: number; clientName: string; clientEmail?: string; clientPhone?: string; accountType?: string; notes?: string } | null>(null);
  const [form, setForm] = useState({ clientName: "", clientEmail: "", clientPhone: "", accountType: "INDIVIDUAL", notes: "" });

  const utils = trpc.useUtils();

  const clientsQuery = trpc.broker.getMyClients.useQuery({
    page: clientPage,
    pageSize: 15,
    status: clientStatusFilter !== "ALL" ? (clientStatusFilter as "ACTIVE" | "INACTIVE" | "SUSPENDED") : undefined,
  }, { enabled: !!user });

  const commissionsQuery = trpc.broker.getMyCommissions.useQuery({
    page: commPage,
    pageSize: 15,
    status: commStatusFilter !== "ALL" ? (commStatusFilter as "PENDING" | "PAID" | "CANCELLED") : undefined,
  }, { enabled: !!user });

  const tradesQuery = trpc.broker.getMyTradeHistory.useQuery({
    page: tradePage,
    pageSize: 15,
  }, { enabled: !!user });

  const addClientMutation = trpc.broker.addClient.useMutation({
    onSuccess: () => {
      utils.broker.getMyClients.invalidate();
      setAddOpen(false);
      setForm({ clientName: "", clientEmail: "", clientPhone: "", accountType: "INDIVIDUAL", notes: "" });
      toast.success("Client added successfully");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateClientMutation = trpc.broker.updateClient.useMutation({
    onSuccess: () => {
      utils.broker.getMyClients.invalidate();
      setEditClient(null);
      toast.success("Client updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const removeClientMutation = trpc.broker.removeClient.useMutation({
    onSuccess: () => {
      utils.broker.getMyClients.invalidate();
      toast.success("Client removed");
    },
    onError: (e) => toast.error(e.message),
  });

  if (loading) return <div className="flex items-center justify-center min-h-screen bg-[#0a0f1e]"><RefreshCw className="animate-spin text-emerald-400 w-8 h-8" /></div>;
  if (!user) { window.location.href = getLoginUrl(); return null; }

  const summary = commissionsQuery.data?.summary;

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "clients", label: "My Clients", icon: <Users className="w-4 h-4" /> },
    { id: "commissions", label: "Commissions", icon: <DollarSign className="w-4 h-4" /> },
    { id: "trades", label: "Trade History", icon: <TrendingUp className="w-4 h-4" /> },
  ];

  if (clientsQuery.isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#0d1426] px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/broker/dashboard")} className="text-gray-400 hover:text-white">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-xl font-bold text-white">Commission Dashboard</h1>
            <p className="text-xs text-gray-400">Manage clients, track earnings, and view trade history</p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {[
              { label: "Total Earned", value: `₦${Number(summary.totalEarned).toLocaleString()}`, color: "text-emerald-400" },
              { label: "Paid Out", value: `₦${Number(summary.totalPaid).toLocaleString()}`, color: "text-blue-400" },
              { label: "Pending", value: `₦${Number(summary.totalPending).toLocaleString()}`, color: "text-amber-400" },
            ].map((card) => (
              <div key={card.label} className="bg-white/5 border border-white/10 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-1">{card.label}</p>
                <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
                {card.label === "Total Earned" && summary.commissionRate && (
                  <p className="text-xs text-gray-500 mt-1">Rate: {summary.commissionRate}%</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white/5 p-1 rounded-lg w-fit">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === tab.id ? "bg-emerald-500 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Clients Tab */}
        {activeTab === "clients" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Select value={clientStatusFilter} onValueChange={setClientStatusFilter}>
                  <SelectTrigger className="w-36 bg-white/5 border-white/10 text-white text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Status</SelectItem>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="INACTIVE">Inactive</SelectItem>
                    <SelectItem value="SUSPENDED">Suspended</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-xs text-gray-400">{clientsQuery.data?.total ?? 0} clients</span>
              </div>
              <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                    <Plus className="w-4 h-4 mr-1" /> Add Client
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-[#0d1426] border-white/10 text-white">
                  <DialogHeader><DialogTitle>Add New Client</DialogTitle></DialogHeader>
                  <div className="space-y-3 pt-2">
                    <Input placeholder="Client Name *" value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} className="bg-white/5 border-white/10 text-white" />
                    <Input placeholder="Email" value={form.clientEmail} onChange={e => setForm(f => ({ ...f, clientEmail: e.target.value }))} className="bg-white/5 border-white/10 text-white" />
                    <Input placeholder="Phone" value={form.clientPhone} onChange={e => setForm(f => ({ ...f, clientPhone: e.target.value }))} className="bg-white/5 border-white/10 text-white" />
                    <Select value={form.accountType} onValueChange={v => setForm(f => ({ ...f, accountType: v }))}>
                      <SelectTrigger className="bg-white/5 border-white/10 text-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="INDIVIDUAL">Individual</SelectItem>
                        <SelectItem value="CORPORATE">Corporate</SelectItem>
                        <SelectItem value="INSTITUTIONAL">Institutional</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input placeholder="Notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="bg-white/5 border-white/10 text-white" />
                    <Button
                      className="w-full bg-emerald-600 hover:bg-emerald-700"
                      disabled={!form.clientName || addClientMutation.isPending}
                      onClick={() => addClientMutation.mutate({ clientName: form.clientName, clientEmail: form.clientEmail || undefined, clientPhone: form.clientPhone || undefined, accountType: form.accountType, notes: form.notes || undefined })}
                    >
                      {addClientMutation.isPending ? "Adding..." : "Add Client"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="text-gray-400">Name</TableHead>
                    <TableHead className="text-gray-400">Email</TableHead>
                    <TableHead className="text-gray-400">Phone</TableHead>
                    <TableHead className="text-gray-400">Type</TableHead>
                    <TableHead className="text-gray-400">Status</TableHead>
                    <TableHead className="text-gray-400">Added</TableHead>
                    <TableHead className="text-gray-400">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientsQuery.isLoading ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-gray-400 py-8">Loading...</TableCell></TableRow>
                  ) : clientsQuery.data?.clients.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-gray-400 py-8">No clients yet. Add your first client above.</TableCell></TableRow>
                  ) : clientsQuery.data?.clients.map((c) => (
                    <TableRow key={c.id} className="border-white/10 hover:bg-white/5">
                      <TableCell className="font-medium text-white">{c.clientName}</TableCell>
                      <TableCell className="text-gray-300 text-sm">{c.clientEmail ?? "—"}</TableCell>
                      <TableCell className="text-gray-300 text-sm">{c.clientPhone ?? "—"}</TableCell>
                      <TableCell className="text-gray-300 text-sm">{c.accountType ?? "INDIVIDUAL"}</TableCell>
                      <TableCell>
                        <Badge className={c.status === "ACTIVE" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : c.status === "SUSPENDED" ? "bg-red-500/20 text-red-400 border-red-500/30" : "bg-gray-500/20 text-gray-400 border-gray-500/30"}>
                          {c.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-gray-400 text-xs">{new Date(c.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="sm" className="text-blue-400 hover:text-blue-300 h-7 w-7 p-0"
                            onClick={() => setEditClient({ id: c.id, clientName: c.clientName ?? "", clientEmail: c.clientEmail ?? "", clientPhone: c.clientPhone ?? "", accountType: c.accountType ?? "INDIVIDUAL", notes: c.notes ?? "" })}>
                            <Edit2 className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300 h-7 w-7 p-0"
                            onClick={() => { if (confirm("Remove this client?")) removeClientMutation.mutate({ clientId: c.id }); }}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {(clientsQuery.data?.total ?? 0) > 15 && (
              <div className="flex items-center justify-between mt-4">
                <span className="text-xs text-gray-400">Page {clientPage} of {Math.ceil((clientsQuery.data?.total ?? 0) / 15)}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={clientPage === 1} onClick={() => setClientPage(p => p - 1)} className="border-white/10 text-white"><ChevronLeft className="w-4 h-4" /></Button>
                  <Button variant="outline" size="sm" disabled={clientPage >= Math.ceil((clientsQuery.data?.total ?? 0) / 15)} onClick={() => setClientPage(p => p + 1)} className="border-white/10 text-white"><ChevronRight className="w-4 h-4" /></Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Commissions Tab */}
        {activeTab === "commissions" && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <Select value={commStatusFilter} onValueChange={setCommStatusFilter}>
                <SelectTrigger className="w-36 bg-white/5 border-white/10 text-white text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Status</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="PAID">Paid</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-gray-400">{commissionsQuery.data?.total ?? 0} records</span>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="text-gray-400">Order ID</TableHead>
                    <TableHead className="text-gray-400">Commodity</TableHead>
                    <TableHead className="text-gray-400">Trade Value</TableHead>
                    <TableHead className="text-gray-400">Commission</TableHead>
                    <TableHead className="text-gray-400">Status</TableHead>
                    <TableHead className="text-gray-400">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commissionsQuery.isLoading ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-gray-400 py-8">Loading...</TableCell></TableRow>
                  ) : commissionsQuery.data?.commissions.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-gray-400 py-8">No commission records yet.</TableCell></TableRow>
                  ) : commissionsQuery.data?.commissions.map((c) => (
                    <TableRow key={c.id} className="border-white/10 hover:bg-white/5">
                      <TableCell className="text-gray-300 font-mono text-xs">{c.orderId}</TableCell>
                      <TableCell className="text-white">{c.symbol ?? "—"}</TableCell>
                      <TableCell className="text-gray-300">₦{Number(c.tradeValue ?? 0).toLocaleString()}</TableCell>
                      <TableCell className="text-emerald-400 font-semibold">₦{Number(c.commissionAmount ?? 0).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge className={c.status === "PAID" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : c.status === "PENDING" ? "bg-amber-500/20 text-amber-400 border-amber-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>
                          {c.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-gray-400 text-xs">{new Date(c.createdAt).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {(commissionsQuery.data?.total ?? 0) > 15 && (
              <div className="flex items-center justify-between mt-4">
                <span className="text-xs text-gray-400">Page {commPage} of {Math.ceil((commissionsQuery.data?.total ?? 0) / 15)}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={commPage === 1} onClick={() => setCommPage(p => p - 1)} className="border-white/10 text-white"><ChevronLeft className="w-4 h-4" /></Button>
                  <Button variant="outline" size="sm" disabled={commPage >= Math.ceil((commissionsQuery.data?.total ?? 0) / 15)} onClick={() => setCommPage(p => p + 1)} className="border-white/10 text-white"><ChevronRight className="w-4 h-4" /></Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Trade History Tab */}
        {activeTab === "trades" && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs text-gray-400">{tradesQuery.data?.total ?? 0} fills</span>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="text-gray-400">Fill ID</TableHead>
                    <TableHead className="text-gray-400">Symbol</TableHead>
                    <TableHead className="text-gray-400">Side</TableHead>
                    <TableHead className="text-gray-400">Qty</TableHead>
                    <TableHead className="text-gray-400">Price</TableHead>
                    <TableHead className="text-gray-400">Value</TableHead>
                    <TableHead className="text-gray-400">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tradesQuery.isLoading ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-gray-400 py-8">Loading...</TableCell></TableRow>
                  ) : tradesQuery.data?.trades.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-gray-400 py-8">No trade fills yet.</TableCell></TableRow>
                  ) : tradesQuery.data?.trades.map((t) => {
                    const isBuyer = t.buyerUserId === user.id;
                    const value = Number(t.fillPrice ?? 0) * Number(t.filledQty ?? 0);
                    return (
                      <TableRow key={t.id} className="border-white/10 hover:bg-white/5">
                        <TableCell className="text-gray-300 font-mono text-xs">#{t.id}</TableCell>
                        <TableCell className="text-white font-medium">{t.symbol ?? "—"}</TableCell>
                        <TableCell>
                          <Badge className={isBuyer ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>
                            {isBuyer ? "BUY" : "SELL"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-gray-300">{Number(t.filledQty ?? 0).toLocaleString()} MT</TableCell>
                        <TableCell className="text-gray-300">₦{Number(t.fillPrice ?? 0).toLocaleString()}</TableCell>
                        <TableCell className="text-white font-semibold">₦{value.toLocaleString()}</TableCell>
                        <TableCell className="text-gray-400 text-xs">{new Date(t.createdAt).toLocaleString()}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {(tradesQuery.data?.total ?? 0) > 15 && (
              <div className="flex items-center justify-between mt-4">
                <span className="text-xs text-gray-400">Page {tradePage} of {Math.ceil((tradesQuery.data?.total ?? 0) / 15)}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={tradePage === 1} onClick={() => setTradePage(p => p - 1)} className="border-white/10 text-white"><ChevronLeft className="w-4 h-4" /></Button>
                  <Button variant="outline" size="sm" disabled={tradePage >= Math.ceil((tradesQuery.data?.total ?? 0) / 15)} onClick={() => setTradePage(p => p + 1)} className="border-white/10 text-white"><ChevronRight className="w-4 h-4" /></Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit Client Dialog */}
      <Dialog open={!!editClient} onOpenChange={(o) => { if (!o) setEditClient(null); }}>
        <DialogContent className="bg-[#0d1426] border-white/10 text-white">
          <DialogHeader><DialogTitle>Edit Client</DialogTitle></DialogHeader>
          {editClient && (
            <div className="space-y-3 pt-2">
              <Input placeholder="Client Name *" defaultValue={editClient.clientName}
                onChange={e => setEditClient(c => c ? { ...c, clientName: e.target.value } : null)}
                className="bg-white/5 border-white/10 text-white" />
              <Input placeholder="Email" defaultValue={editClient.clientEmail}
                onChange={e => setEditClient(c => c ? { ...c, clientEmail: e.target.value } : null)}
                className="bg-white/5 border-white/10 text-white" />
              <Input placeholder="Phone" defaultValue={editClient.clientPhone}
                onChange={e => setEditClient(c => c ? { ...c, clientPhone: e.target.value } : null)}
                className="bg-white/5 border-white/10 text-white" />
              <Input placeholder="Notes" defaultValue={editClient.notes}
                onChange={e => setEditClient(c => c ? { ...c, notes: e.target.value } : null)}
                className="bg-white/5 border-white/10 text-white" />
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700"
                disabled={updateClientMutation.isPending}
                onClick={() => updateClientMutation.mutate({
                  clientId: editClient.id,
                  clientName: editClient.clientName,
                  clientEmail: editClient.clientEmail,
                  clientPhone: editClient.clientPhone,
                  notes: editClient.notes,
                })}
              >
                {updateClientMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
