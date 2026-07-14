import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  ArrowRightLeft, Send, Clock, CheckCircle2, XCircle,
  RefreshCw, AlertTriangle, Globe, Banknote,
} from "lucide-react";

const CORRIDORS = [
  { label: "NGN → KES", from: "NGN", to: "KES", rate: 0.0028 },
  { label: "NGN → GHS", from: "NGN", to: "GHS", rate: 0.0042 },
  { label: "NGN → ZAR", from: "NGN", to: "ZAR", rate: 0.0095 },
  { label: "GHS → KES", from: "GHS", to: "KES", rate: 0.67 },
  { label: "KES → ZAR", from: "KES", to: "ZAR", rate: 3.41 },
  { label: "USD → NGN", from: "USD", to: "NGN", rate: 1620.0 },
  { label: "USD → KES", from: "USD", to: "KES", rate: 130.5 },
  { label: "EUR → NGN", from: "EUR", to: "NGN", rate: 1755.0 },
];

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  PENDING:   { color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20", label: "Pending" },
  PROCESSING:{ color: "bg-blue-500/10 text-blue-400 border-blue-500/20",       label: "Processing" },
  COMPLETED: { color: "bg-green-500/10 text-green-400 border-green-500/20",    label: "Completed" },
  FAILED:    { color: "bg-red-500/10 text-red-400 border-red-500/20",          label: "Failed" },
  CANCELLED: { color: "bg-slate-500/10 text-slate-400 border-slate-500/20",    label: "Cancelled" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG["PENDING"];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

// Matches crossBorderLedgerEntries schema
type Transfer = {
  id: number;
  transferId: string;
  userId: number;
  sendAmount: string;
  sendCurrency: string;
  receiveAmount: string | null;
  receiveCurrency: string | null;
  fxRate: string | null;
  tbTransferId: string | null;
  status: string;
  createdAt: Date;
  settledAt: Date | null;
};

export default function CrossBorderFx() {
  const [tab, setTab] = useState("send");
  const [corridor, setCorridor] = useState(CORRIDORS[0]);
  const [amount, setAmount] = useState("");
  const [receiverFsp, setReceiverFsp] = useState("");
  const [receiverAccount, setReceiverAccount] = useState("");
  const [note, setNote] = useState("");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const { data: listData, isLoading: listLoading } = trpc.crossBorderFx.list.useQuery(
    { page: 1, pageSize: 50 },
    { refetchInterval: 10000 },
  );

  const { data: statusData } = trpc.crossBorderFx.getStatus.useQuery(
    { workflowId: selectedWorkflowId! },
    { enabled: !!selectedWorkflowId, refetchInterval: 5000 },
  );
  // getStatus returns: { transferId, workflowId, dbStatus, temporalPhase, temporalStatus, sendAmount, sendCurrency, receiveCurrency, receiveAmount, fxRate, createdAt, settledAt }

  const initiateMut = trpc.crossBorderFx.initiate.useMutation({
    onSuccess: (data) => {
      toast.success(`Transfer initiated — Workflow: ${data.workflowId}`);
      setSelectedWorkflowId(data.workflowId);
      setTab("history");
      setAmount(""); setReceiverFsp(""); setReceiverAccount(""); setNote("");
      utils.crossBorderFx.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const cancelMut = trpc.crossBorderFx.cancel.useMutation({
    onSuccess: () => { toast.success("Transfer cancelled"); utils.crossBorderFx.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const receivingAmount = amount
    ? (parseFloat(amount) * corridor.rate).toFixed(4)
    : "";

  const handleSend = () => {
    if (!amount || !receiverFsp || !receiverAccount) {
      toast.error("Please fill in all required fields");
      return;
    }
    const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    initiateMut.mutate({
      sendCurrency: corridor.from,
      receiveCurrency: corridor.to,
      amount: parseFloat(amount),
      receiverFsp,
      receiverAccount,
      note: note || undefined,
      idempotencyKey,
    });
  };

  const transfers: Transfer[] = listData?.transfers ?? [];

  if (listLoading) return <PageSkeleton cards={2} tableRows={6} tableCols={4} />;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-blue-500/10">
          <Globe className="h-5 w-5 text-blue-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Cross-Border FX</h1>
          <p className="text-sm text-muted-foreground">Mojaloop ILP-powered cross-border transfers via Temporal workflows</p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Transfers", value: listData?.total ?? 0, icon: <ArrowRightLeft className="h-4 w-4 text-blue-400" /> },
          { label: "Completed", value: transfers.filter((t) => t.status === "COMPLETED").length, icon: <CheckCircle2 className="h-4 w-4 text-green-400" /> },
          { label: "Processing", value: transfers.filter((t) => ["PENDING","PROCESSING"].includes(t.status)).length, icon: <RefreshCw className="h-4 w-4 text-yellow-400" /> },
          { label: "Failed", value: transfers.filter((t) => t.status === "FAILED").length, icon: <AlertTriangle className="h-4 w-4 text-red-400" /> },
        ].map((s) => (
          <Card key={s.label} className="bg-card/50 border-border/50">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-2xl font-bold text-foreground mt-0.5">{s.value}</p>
                </div>
                {s.icon}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-muted/30">
          <TabsTrigger value="send"><Send className="h-3.5 w-3.5 mr-1.5" />Send Transfer</TabsTrigger>
          <TabsTrigger value="history"><Clock className="h-3.5 w-3.5 mr-1.5" />History</TabsTrigger>
          {selectedWorkflowId && <TabsTrigger value="status"><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Live Status</TabsTrigger>}
        </TabsList>

        {/* ── Send Transfer ── */}
        <TabsContent value="send" className="mt-4">
          <div className="grid grid-cols-2 gap-6">
            <Card className="bg-card/50 border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Transfer Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Corridor</Label>
                  <Select
                    value={corridor.label}
                    onValueChange={(v) => setCorridor(CORRIDORS.find((c) => c.label === v)!)}
                  >
                    <SelectTrigger className="bg-background/50"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CORRIDORS.map((c) => (
                        <SelectItem key={c.label} value={c.label}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Send Amount ({corridor.from})</Label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="bg-background/50"
                  />
                </div>

                {receivingAmount && (
                  <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3">
                    <p className="text-xs text-muted-foreground">Recipient receives (est.)</p>
                    <p className="text-lg font-bold text-blue-400">{receivingAmount} {corridor.to}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Rate: 1 {corridor.from} = {corridor.rate} {corridor.to}</p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label>Receiver FSP ID *</Label>
                  <Input
                    placeholder="e.g. safaricom-mpesa"
                    value={receiverFsp}
                    onChange={(e) => setReceiverFsp(e.target.value)}
                    className="bg-background/50"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Receiver Account *</Label>
                  <Input
                    placeholder="e.g. +254700123456"
                    value={receiverAccount}
                    onChange={(e) => setReceiverAccount(e.target.value)}
                    className="bg-background/50"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Note (optional)</Label>
                  <Input
                    placeholder="Payment note..."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="bg-background/50"
                  />
                </div>

                <Button
                  onClick={handleSend}
                  disabled={initiateMut.isPending}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  {initiateMut.isPending ? (
                    <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Initiating…</>
                  ) : (
                    <><Send className="h-4 w-4 mr-2" />Send Transfer</>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* How it works */}
            <Card className="bg-card/50 border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">How It Works</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { step: 1, title: "Quote Request", desc: "NEXCOM requests a Mojaloop ILP quote from the receiver FSP" },
                    { step: 2, title: "FX Conversion", desc: `${corridor.from} converted to ${corridor.to} at live interbank rate` },
                    { step: 3, title: "ILP Prepare", desc: "Funds reserved with cryptographic condition hash" },
                    { step: 4, title: "Fulfil", desc: "Receiver FSP fulfils the condition, releasing funds atomically" },
                    { step: 5, title: "Settlement", desc: "Net settlement via NEXCOM's TigerBeetle ledger" },
                    { step: 6, title: "Notification", desc: "Both parties notified via Fluvio event stream" },
                  ].map((s) => (
                    <div key={s.step} className="flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-xs text-blue-400 font-bold shrink-0 mt-0.5">
                        {s.step}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{s.title}</p>
                        <p className="text-xs text-muted-foreground">{s.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── History ── */}
        <TabsContent value="history" className="mt-4">
          <Card className="bg-card/50 border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Banknote className="h-4 w-4 text-blue-400" />
                Transfer History
                {listLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {transfers.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Globe className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No transfers yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {transfers.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-background/30 border-border/30 hover:bg-background/50 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <ArrowRightLeft className="h-4 w-4 text-blue-400" />
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {t.sendAmount} {t.sendCurrency}
                            {t.receiveAmount && ` → ${t.receiveAmount} ${t.receiveCurrency}`}
                          </p>
                          <p className="text-xs text-muted-foreground font-mono">{t.transferId}</p>
                          <p className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString()}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={t.status} />
                        {["PENDING","PROCESSING"].includes(t.status) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-red-400 hover:text-red-300"
                            onClick={() => cancelMut.mutate({ workflowId: t.transferId })}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Live Status ── */}
        {selectedWorkflowId && (
          <TabsContent value="status" className="mt-4">
            <Card className="bg-card/50 border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-blue-400 animate-spin" />
                  Live Workflow Status
                  <code className="text-xs text-muted-foreground font-mono ml-2">{selectedWorkflowId}</code>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {statusData ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <StatusBadge status={statusData.dbStatus} />
                      <span className="text-sm text-muted-foreground">
                        Workflow: <code className="text-xs font-mono">{statusData.workflowId}</code>
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-lg bg-background/30 border border-border/30 p-3">
                        <p className="text-xs text-muted-foreground">Send</p>
                        <p className="font-medium text-foreground">{statusData.sendAmount} {statusData.sendCurrency}</p>
                      </div>
                      {statusData.receiveAmount && (
                        <div className="rounded-lg bg-background/30 border border-border/30 p-3">
                          <p className="text-xs text-muted-foreground">Receive</p>
                          <p className="font-medium text-foreground">{statusData.receiveAmount} {statusData.receiveCurrency}</p>
                        </div>
                      )}
                    </div>
                    {statusData.temporalPhase && (
                      <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3">
                        <p className="text-xs text-blue-400 font-medium mb-1">Temporal Phase</p>
                        <p className="text-sm text-foreground">{statusData.temporalPhase} · {statusData.temporalStatus}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <RefreshCw className="h-6 w-6 mx-auto mb-2 animate-spin opacity-40" />
                    <p className="text-sm">Loading status…</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
