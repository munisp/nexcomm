import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  MessageSquare,
  Phone,
  Send,
  Users,
  Activity,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  Hash,
} from "lucide-react";

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  icon: Icon,
  color = "text-emerald-400",
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <Card className="bg-slate-800/60 border-slate-700">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`p-2 rounded-lg bg-slate-700/50 ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-slate-400">{label}</p>
          <p className="text-xl font-bold text-white">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── USSD Tab ─────────────────────────────────────────────────────────────────
function UssdTab() {
  const [page, setPage] = useState(1);
  const [usernameSearch, setUsernameSearch] = useState("");
  const [phoneSearch, setPhoneSearch] = useState("");
  const [phoneFilter, setPhoneFilter] = useState("");

  const { data: statsData } = trpc.ussd.getSessionStats.useQuery({});
  const { data: sessionsData, refetch } = trpc.ussd.getSessions.useQuery({
    page,
    limit: 20,
    phone: phoneFilter || undefined,
  });

  const stats = statsData?.stats;
  const sessions = sessionsData?.sessions ?? [];
  const total = sessionsData?.total ?? 0;

  const statusColor = (s: string) => {
    if (s === "COMPLETED") return "bg-emerald-500/20 text-emerald-400";
    if (s === "ACTIVE") return "bg-blue-500/20 text-blue-400";
    if (s === "TIMED_OUT") return "bg-amber-500/20 text-amber-400";
    return "bg-red-500/20 text-red-400";
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Sessions" value={stats?.total_sessions ?? 0} icon={Activity} />
        <StatCard label="Completed" value={stats?.completed_sessions ?? 0} icon={CheckCircle} color="text-emerald-400" />
        <StatCard label="Active Now" value={stats?.active_sessions ?? 0} icon={Clock} color="text-blue-400" />
        <StatCard label="Unique Users" value={stats?.unique_users ?? 0} icon={Users} color="text-purple-400" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Completion Rate" value={stats?.completion_rate ?? "0%"} icon={CheckCircle} color="text-emerald-400" />
        <StatCard label="Timed Out" value={stats?.timed_out_sessions ?? 0} icon={XCircle} color="text-amber-400" />
        <StatCard label="Failed" value={stats?.failed_sessions ?? 0} icon={XCircle} color="text-red-400" />
      </div>

      {/* Service Codes */}
      <Card className="bg-slate-800/60 border-slate-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
            <Hash className="h-4 w-4 text-amber-400" />
            USSD Service Codes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {[
              { code: "*347*99#", desc: "Main Menu" },
              { code: "*347*100#", desc: "Quick Price Check" },
              { code: "*347*101#", desc: "Portfolio" },
            ].map((c) => (
              <div key={c.code} className="flex items-center gap-2 bg-slate-700/50 rounded-lg px-3 py-2">
                <code className="text-amber-400 font-mono text-sm">{c.code}</code>
                <span className="text-slate-300 text-xs">{c.desc}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Session List */}
      <Card className="bg-slate-800/60 border-slate-700">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm text-slate-300">Sessions</CardTitle>
            <div className="flex gap-2">
              <Input
                placeholder="Filter by phone..."
                value={phoneFilter}
                onChange={(e) => { setPhoneFilter(e.target.value); setPage(1); }}
                className="h-8 w-40 bg-slate-700 border-slate-600 text-white text-xs"
              />
              <Button size="sm" variant="outline" onClick={() => refetch()} className="h-8 border-slate-600">
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700">
                <TableHead className="text-slate-400 text-xs">Phone</TableHead>
                <TableHead className="text-slate-400 text-xs">Service Code</TableHead>
                <TableHead className="text-slate-400 text-xs">Menu</TableHead>
                <TableHead className="text-slate-400 text-xs">Status</TableHead>
                <TableHead className="text-slate-400 text-xs">Interactions</TableHead>
                <TableHead className="text-slate-400 text-xs">Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500 py-8">
                    No sessions found
                  </TableCell>
                </TableRow>
              ) : (
                sessions.map((s) => (
                  <TableRow key={s.id} className="border-slate-700 hover:bg-slate-700/30">
                    <TableCell className="text-white text-xs font-mono">{s.phoneNumber}</TableCell>
                    <TableCell className="text-amber-400 text-xs font-mono">{s.serviceCode}</TableCell>
                    <TableCell className="text-slate-300 text-xs">{s.currentMenu}</TableCell>
                    <TableCell>
                      <Badge className={`text-xs ${statusColor(s.status)}`}>{s.status}</Badge>
                    </TableCell>
                    <TableCell className="text-slate-300 text-xs text-center">{s.totalInteractions}</TableCell>
                    <TableCell className="text-slate-400 text-xs">
                      {new Date(s.startedAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {total > 20 && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-slate-700">
              <span className="text-xs text-slate-400">{total} total sessions</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)} className="h-7 text-xs border-slate-600">Prev</Button>
                <Button size="sm" variant="outline" disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)} className="h-7 text-xs border-slate-600">Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── WhatsApp Tab ─────────────────────────────────────────────────────────────
function WhatsAppTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<number | null>(null);
  const [msgText, setMsgText] = useState("");
  const [showMsgDialog, setShowMsgDialog] = useState(false);

  const { data: stats, refetch: refetchStats } = trpc.whatsapp.getStats.useQuery();
  const { data: contactsData, refetch } = trpc.whatsapp.getContacts.useQuery({
    page,
    limit: 20,
    search: search || undefined,
  });
  const { data: messagesData } = trpc.whatsapp.getMessages.useQuery(
    { contactId: selectedContact!, page: 1, limit: 20 },
    { enabled: !!selectedContact }
  );

  const sendMsg = trpc.whatsapp.sendMessage.useMutation({
    onSuccess: () => {
      toast.success("Message queued", { description: "WhatsApp message queued for delivery." });
      setShowMsgDialog(false);
      setMsgText("");
      refetchStats();
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });
  const updateStatus = trpc.whatsapp.updateContactStatus.useMutation({
    onSuccess: () => { toast.success("Status updated"); refetch(); },
  });

  const contacts = contactsData?.contacts ?? [];
  const total = contactsData?.total ?? 0;
  const messages = messagesData?.messages ?? [];

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Total Contacts" value={stats?.totalContacts ?? 0} icon={Users} color="text-green-400" />
        <StatCard label="Total Messages" value={stats?.totalMessages ?? 0} icon={MessageSquare} color="text-green-400" />
        <StatCard label="Messages (24h)" value={stats?.messagesLast24h ?? 0} icon={Activity} color="text-blue-400" />
        <StatCard label="Inbound" value={stats?.inboundMessages ?? 0} icon={MessageSquare} color="text-emerald-400" />
        <StatCard label="Outbound" value={stats?.outboundMessages ?? 0} icon={Send} color="text-amber-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Contacts */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-green-400" />
                WhatsApp Contacts
              </CardTitle>
              <div className="flex gap-2">
                <Input
                  placeholder="Search phone..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="h-7 w-32 bg-slate-700 border-slate-600 text-white text-xs"
                />
                <Button size="sm" variant="outline" onClick={() => refetch()} className="h-7 border-slate-600">
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700">
                  <TableHead className="text-slate-400 text-xs">Phone</TableHead>
                  <TableHead className="text-slate-400 text-xs">Status</TableHead>
                  <TableHead className="text-slate-400 text-xs">Msgs</TableHead>
                  <TableHead className="text-slate-400 text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-slate-500 py-6 text-xs">No contacts yet</TableCell>
                  </TableRow>
                ) : (
                  contacts.map((c) => (
                    <TableRow
                      key={c.id}
                      className={`border-slate-700 cursor-pointer hover:bg-slate-700/30 ${selectedContact === c.id ? "bg-slate-700/50" : ""}`}
                      onClick={() => setSelectedContact(c.id)}
                    >
                      <TableCell className="text-white text-xs font-mono">{c.phoneNumber}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${c.status === "ACTIVE" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                          {c.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-300 text-xs">{c.totalMessages}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs text-green-400 hover:text-green-300"
                            onClick={(e) => { e.stopPropagation(); setSelectedContact(c.id); setShowMsgDialog(true); }}
                          >
                            <Send className="h-3 w-3" />
                          </Button>
                          {c.status === "ACTIVE" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs text-red-400 hover:text-red-300"
                              onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ contactId: c.id, status: "BLOCKED" }); }}
                            >
                              Block
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Message History */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300">
              {selectedContact ? "Message History" : "Select a contact"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 max-h-80 overflow-y-auto">
            {messages.length === 0 ? (
              <div className="text-center text-slate-500 py-8 text-xs">
                {selectedContact ? "No messages" : "Click a contact to view messages"}
              </div>
            ) : (
              <div className="p-3 space-y-2">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`}
                  >
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${
                      m.direction === "OUTBOUND"
                        ? "bg-green-600/30 text-green-100"
                        : "bg-slate-700 text-slate-200"
                    }`}>
                      <p>{m.body}</p>
                      <p className="text-[10px] opacity-60 mt-1">
                        {new Date(m.createdAt).toLocaleTimeString()} · {m.status}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Send Message Dialog */}
      <Dialog open={showMsgDialog} onOpenChange={setShowMsgDialog}>
        <DialogContent className="bg-slate-800 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-white">Send WhatsApp Message</DialogTitle>
          </DialogHeader>
          <Textarea
            value={msgText}
            onChange={(e) => setMsgText(e.target.value)}
            placeholder="Type your message..."
            className="bg-slate-700 border-slate-600 text-white min-h-24"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMsgDialog(false)} className="border-slate-600">Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              disabled={!msgText.trim() || sendMsg.isPending}
              onClick={() => selectedContact && sendMsg.mutate({ contactId: selectedContact, message: msgText })}
            >
              <Send className="h-4 w-4 mr-2" />
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Telegram Tab ─────────────────────────────────────────────────────────────
function TelegramTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<number | null>(null);
  const [msgText, setMsgText] = useState("");
  const [showMsgDialog, setShowMsgDialog] = useState(false);

  const { data: stats, refetch: refetchStats } = trpc.telegram.getStats.useQuery();
  const { data: contactsData, refetch } = trpc.telegram.getContacts.useQuery({
    page,
    limit: 20,
    search: search || undefined,
  });
  const { data: messagesData } = trpc.telegram.getMessages.useQuery(
    { contactId: selectedContact!, page: 1, limit: 20 },
    { enabled: !!selectedContact }
  );

  const sendMsg = trpc.telegram.sendMessage.useMutation({
    onSuccess: () => {
      toast.success("Message queued", { description: "Telegram message queued for delivery." });
      setShowMsgDialog(false);
      setMsgText("");
      refetchStats();
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });
  const updateStatus = trpc.telegram.updateContactStatus.useMutation({
    onSuccess: () => { toast.success("Status updated"); refetch(); },
  });

  const contacts = contactsData?.contacts ?? [];
  const total = contactsData?.total ?? 0;
  const messages = messagesData?.messages ?? [];

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Total Contacts" value={stats?.totalContacts ?? 0} icon={Users} color="text-blue-400" />
        <StatCard label="Verified" value={stats?.verifiedContacts ?? 0} icon={CheckCircle} color="text-emerald-400" />
        <StatCard label="Total Messages" value={stats?.totalMessages ?? 0} icon={MessageSquare} color="text-blue-400" />
        <StatCard label="Inbound" value={stats?.inboundMessages ?? 0} icon={MessageSquare} color="text-emerald-400" />
        <StatCard label="Outbound" value={stats?.outboundMessages ?? 0} icon={Send} color="text-amber-400" />
        <StatCard label="Messages (24h)" value={stats?.messagesLast24h ?? 0} icon={Activity} color="text-purple-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Contacts */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                <Send className="h-4 w-4 text-blue-400" />
                Telegram Contacts
              </CardTitle>
              <div className="flex gap-2">
                <Input
                  placeholder="Search username..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="h-7 w-32 bg-slate-700 border-slate-600 text-white text-xs"
                />
                <Button size="sm" variant="outline" onClick={() => refetch()} className="h-7 border-slate-600">
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700">
                  <TableHead className="text-slate-400 text-xs">Username</TableHead>
                  <TableHead className="text-slate-400 text-xs">Verified</TableHead>
                  <TableHead className="text-slate-400 text-xs">Commands</TableHead>
                  <TableHead className="text-slate-400 text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-slate-500 py-6 text-xs">No contacts yet</TableCell>
                  </TableRow>
                ) : (
                  contacts.map((c) => (
                    <TableRow
                      key={c.id}
                      className={`border-slate-700 cursor-pointer hover:bg-slate-700/30 ${selectedContact === c.id ? "bg-slate-700/50" : ""}`}
                      onClick={() => setSelectedContact(c.id)}
                    >
                      <TableCell className="text-white text-xs">
                        {c.username ? `@${c.username}` : `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.telegramId}
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${c.isVerified ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-600 text-slate-400"}`}>
                          {c.isVerified ? "Verified" : "Pending"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-300 text-xs">{c.totalCommands}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs text-blue-400 hover:text-blue-300"
                            onClick={(e) => { e.stopPropagation(); setSelectedContact(c.id); setShowMsgDialog(true); }}
                          >
                            <Send className="h-3 w-3" />
                          </Button>
                          {c.status === "ACTIVE" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs text-red-400 hover:text-red-300"
                              onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ contactId: c.id, status: "BLOCKED" }); }}
                            >
                              Block
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Message History */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300">
              {selectedContact ? "Message History" : "Select a contact"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 max-h-80 overflow-y-auto">
            {messages.length === 0 ? (
              <div className="text-center text-slate-500 py-8 text-xs">
                {selectedContact ? "No messages" : "Click a contact to view messages"}
              </div>
            ) : (
              <div className="p-3 space-y-2">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`}
                  >
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${
                      m.direction === "OUTBOUND"
                        ? "bg-blue-600/30 text-blue-100"
                        : "bg-slate-700 text-slate-200"
                    }`}>
                      {m.command && <p className="text-[10px] text-blue-400 mb-1 font-mono">{m.command}</p>}
                      <p>{m.text}</p>
                      <p className="text-[10px] opacity-60 mt-1">
                        {new Date(m.createdAt).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Send Message Dialog */}
      <Dialog open={showMsgDialog} onOpenChange={setShowMsgDialog}>
        <DialogContent className="bg-slate-800 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-white">Send Telegram Message</DialogTitle>
          </DialogHeader>
          <Textarea
            value={msgText}
            onChange={(e) => setMsgText(e.target.value)}
            placeholder="Supports Markdown formatting..."
            className="bg-slate-700 border-slate-600 text-white min-h-24"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMsgDialog(false)} className="border-slate-600">Cancel</Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              disabled={!msgText.trim() || sendMsg.isPending}
              onClick={() => selectedContact && sendMsg.mutate({ contactId: selectedContact, message: msgText })}
            >
              <Send className="h-4 w-4 mr-2" />
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ChannelDashboard() {
  const { user } = useAuth();

  if (!user || user.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-400">Admin access required.</p>
      </div>
    );
  }

  
  return (
    <div className="p-6 space-y-6 bg-slate-900 min-h-screen">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500/20 to-blue-500/20 border border-emerald-500/30">
          <MessageSquare className="h-6 w-6 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Channel Dashboard</h1>
          <p className="text-slate-400 text-sm">USSD · WhatsApp · Telegram — unified messaging admin</p>
        </div>
      </div>

      {/* Architecture Info */}
      <Card className="bg-slate-800/40 border-slate-700">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="flex items-start gap-2">
              <Phone className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-amber-400 font-semibold">USSD Engine (Rust)</p>
                <p className="text-slate-400">Africa's Talking gateway · Redis session store · Kafka events · PIN auth · 5-level menu tree</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <MessageSquare className="h-4 w-4 text-green-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-green-400 font-semibold">WhatsApp (Go + Python)</p>
                <p className="text-slate-400">Meta Cloud API webhooks · Go channel-gateway · Python NLP intent classifier · 15 command types</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Send className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-blue-400 font-semibold">Telegram (Go + Python)</p>
                <p className="text-slate-400">Telegram Bot API · Go webhook handler · Python command router · Inline keyboards · Markdown</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="ussd">
        <TabsList className="bg-slate-800 border border-slate-700">
          <TabsTrigger value="ussd" className="data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-400">
            <Phone className="h-4 w-4 mr-2" />
            USSD
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="data-[state=active]:bg-green-500/20 data-[state=active]:text-green-400">
            <MessageSquare className="h-4 w-4 mr-2" />
            WhatsApp
          </TabsTrigger>
          <TabsTrigger value="telegram" className="data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-400">
            <Send className="h-4 w-4 mr-2" />
            Telegram
          </TabsTrigger>
        </TabsList>
        <TabsContent value="ussd" className="mt-4">
          <UssdTab />
        </TabsContent>
        <TabsContent value="whatsapp" className="mt-4">
          <WhatsAppTab />
        </TabsContent>
        <TabsContent value="telegram" className="mt-4">
          <TelegramTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
