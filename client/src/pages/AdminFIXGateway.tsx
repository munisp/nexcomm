/**
 * NEXCOM Exchange — FIX 4.4 Gateway Admin Page
 * Monitor institutional broker FIX sessions and send test messages.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
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
import { toast } from "sonner";
import {
  ArrowLeft,
  RefreshCw,
  Send,
  Activity,
  Wifi,
  WifiOff,
  Clock,
  Hash,
  Plus,
  Trash2,
} from "lucide-react";

type FixSession = {
  session_id: string;
  sender_comp_id: string;
  target_comp_id: string;
  status: string;
  msg_seq_num: number;
  last_heartbeat?: string;
  connected_at?: string;
  messages_sent?: number;
  messages_received?: number;
};

type FieldEntry = { key: string; value: string };

const FIX_MESSAGE_TYPES = [
  { value: "D", label: "D — New Order Single" },
  { value: "F", label: "F — Order Cancel Request" },
  { value: "G", label: "G — Order Cancel/Replace" },
  { value: "V", label: "V — Market Data Request" },
  { value: "0", label: "0 — Heartbeat" },
  { value: "1", label: "1 — Test Request" },
  { value: "5", label: "5 — Logout" },
];

export default function AdminFIXGateway() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  const [sendOpen, setSendOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<string>("");
  const [msgType, setMsgType] = useState("0");
  const [fields, setFields] = useState<FieldEntry[]>([{ key: "", value: "" }]);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const sessionsQuery = trpc.marketData.fixSessions.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const sendMutation = trpc.marketData.sendFixMessage.useMutation({
    onSuccess: () => {
      toast.success("FIX message sent successfully");
      setSendOpen(false);
      setFields([{ key: "", value: "" }]);
      sessionsQuery.refetch();
    },
    onError: (e) => toast.error(`Send failed: ${e.message}`),
  });

  if (loading) return <div className="flex items-center justify-center min-h-screen bg-[#0a0f1e]"><RefreshCw className="animate-spin text-emerald-400 w-8 h-8" /></div>;
  if (!user || user.role !== "admin") { navigate("/"); return null; }

  const sessions: FixSession[] = (sessionsQuery.data as FixSession[] | undefined) ?? [];
  const connectedCount = sessions.filter(s => s.status === "CONNECTED" || s.status === "ACTIVE").length;

  const addField = () => setFields(f => [...f, { key: "", value: "" }]);
  const removeField = (i: number) => setFields(f => f.filter((_, idx) => idx !== i));
  const updateField = (i: number, k: "key" | "value", v: string) =>
    setFields(f => f.map((entry, idx) => idx === i ? { ...entry, [k]: v } : entry));

  const handleSend = () => {
    if (!selectedSession) { toast.error("Select a session"); return; }
    const fieldMap: Record<string, string> = {};
    fields.forEach(f => { if (f.key && f.value) fieldMap[f.key] = f.value; });
    sendMutation.mutate({ sessionId: selectedSession, messageType: msgType, fields: fieldMap });
  };

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#0d1426] px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} className="text-gray-400 hover:text-white">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <div>
              <h1 className="text-xl font-bold text-white">FIX 4.4 Gateway</h1>
              <p className="text-xs text-gray-400">Institutional broker session monitoring</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setAutoRefresh(a => !a)}
              className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border transition-all ${autoRefresh ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10" : "border-white/10 text-gray-400"}`}
            >
              <Activity className="w-3 h-3" /> {autoRefresh ? "Live" : "Paused"}
            </button>
            <Button variant="ghost" size="sm" onClick={() => sessionsQuery.refetch()} className="text-gray-400 hover:text-white">
              <RefreshCw className={`w-4 h-4 ${sessionsQuery.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Sessions", value: sessions.length, icon: <Hash className="w-4 h-4" />, color: "text-white" },
            { label: "Connected", value: connectedCount, icon: <Wifi className="w-4 h-4" />, color: "text-emerald-400" },
            { label: "Disconnected", value: sessions.length - connectedCount, icon: <WifiOff className="w-4 h-4" />, color: "text-red-400" },
            { label: "Last Refresh", value: new Date().toLocaleTimeString(), icon: <Clock className="w-4 h-4" />, color: "text-gray-400" },
          ].map((card) => (
            <div key={card.label} className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className={card.color}>{card.icon}</span>
                <p className="text-xs text-gray-400">{card.label}</p>
              </div>
              <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
            </div>
          ))}
        </div>

        {/* Send Message Button */}
        <div className="flex justify-end mb-4">
          <Dialog open={sendOpen} onOpenChange={setSendOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                <Send className="w-4 h-4 mr-1" /> Send FIX Message
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#0d1426] border-white/10 text-white max-w-lg">
              <DialogHeader><DialogTitle>Send FIX Message</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-2">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Session</label>
                  <Select value={selectedSession} onValueChange={setSelectedSession}>
                    <SelectTrigger className="bg-white/5 border-white/10 text-white">
                      <SelectValue placeholder="Select session..." />
                    </SelectTrigger>
                    <SelectContent>
                      {sessions.map(s => (
                        <SelectItem key={s.session_id} value={s.session_id}>
                          {s.sender_comp_id} → {s.target_comp_id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Message Type</label>
                  <Select value={msgType} onValueChange={setMsgType}>
                    <SelectTrigger className="bg-white/5 border-white/10 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIX_MESSAGE_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-gray-400">Fields (Tag=Value)</label>
                    <Button variant="ghost" size="sm" onClick={addField} className="text-emerald-400 hover:text-emerald-300 h-6 text-xs">
                      <Plus className="w-3 h-3 mr-1" /> Add
                    </Button>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {fields.map((f, i) => (
                      <div key={i} className="flex gap-2">
                        <Input placeholder="Tag (e.g. 55)" value={f.key} onChange={e => updateField(i, "key", e.target.value)} className="bg-white/5 border-white/10 text-white text-sm w-28 flex-shrink-0" />
                        <Input placeholder="Value" value={f.value} onChange={e => updateField(i, "value", e.target.value)} className="bg-white/5 border-white/10 text-white text-sm flex-1" />
                        <Button variant="ghost" size="sm" onClick={() => removeField(i)} className="text-red-400 hover:text-red-300 h-9 w-9 p-0 flex-shrink-0">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700"
                  disabled={!selectedSession || sendMutation.isPending}
                  onClick={handleSend}
                >
                  {sendMutation.isPending ? "Sending..." : "Send Message"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Sessions Table */}
        {sessionsQuery.isLoading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="animate-spin text-emerald-400 w-8 h-8" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-xl p-12 text-center">
            <WifiOff className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 font-medium">No FIX sessions active</p>
            <p className="text-gray-500 text-sm mt-1">The matching engine FIX gateway is not running or has no connected clients.</p>
            <p className="text-gray-600 text-xs mt-3 font-mono">Endpoint: /api/v1/fix/sessions</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => {
              const isConnected = session.status === "CONNECTED" || session.status === "ACTIVE";
              return (
                <div key={session.session_id} className="bg-white/5 border border-white/10 rounded-xl p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" : "bg-red-400"}`} />
                      <div>
                        <p className="font-mono text-sm text-white">{session.session_id}</p>
                        <p className="text-xs text-gray-400">{session.sender_comp_id} → {session.target_comp_id}</p>
                      </div>
                    </div>
                    <Badge className={isConnected ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>
                      {session.status}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">Seq Num</p>
                      <p className="text-white font-mono">{session.msg_seq_num ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">Msgs Sent</p>
                      <p className="text-white">{session.messages_sent ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">Msgs Received</p>
                      <p className="text-white">{session.messages_received ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">Last Heartbeat</p>
                      <p className="text-gray-300 text-xs">{session.last_heartbeat ? new Date(session.last_heartbeat).toLocaleTimeString() : "—"}</p>
                    </div>
                  </div>
                  {session.connected_at && (
                    <p className="text-xs text-gray-500 mt-3">Connected: {new Date(session.connected_at).toLocaleString()}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
