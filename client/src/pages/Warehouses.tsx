/**
 * NEXCOM Exchange — Warehouses Page
 * Certified warehouse directory with capacity, location, and commodity support.
 * Contact Warehouse uses an in-app message dialog (warehouseMessages.sendMessage)
 * instead of a mailto: fallback, keeping communication on-platform and auditable.
 */
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import {
  Warehouse, MapPin, CheckCircle2, Search, Package, Mail,
  Send, MessageSquare, Clock, CheckCheck,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { WAREHOUSES, COMMODITIES, CATEGORY_ICONS } from "../../../shared/commodities";
import { PageSkeleton } from "@/components/PageSkeleton";

const COUNTRY_FLAGS: Record<string, string> = {
  "Nigeria": "🇳🇬",
  "Ghana": "🇬🇭",
  "Kenya": "🇰🇪",
  "Ethiopia": "🇪🇹",
  "Tanzania": "🇹🇿",
  "Ivory Coast": "🇨🇮",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  SENT:    <Clock className="w-3 h-3 text-yellow-400" />,
  READ:    <CheckCheck className="w-3 h-3 text-blue-400" />,
  REPLIED: <MessageSquare className="w-3 h-3 text-positive" />,
  CLOSED:  <CheckCheck className="w-3 h-3 text-muted-foreground" />,
};

export default function Warehouses() {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [countryFilter, setCountryFilter] = useState("ALL");
  const [selected, setSelected] = useState<typeof WAREHOUSES[0] | null>(null);

  // Contact dialog state
  const [contactOpen, setContactOpen] = useState(false);
  const [contactWh, setContactWh] = useState<typeof WAREHOUSES[0] | null>(null);
  const [msgSubject, setMsgSubject] = useState("");
  const [msgBody, setMsgBody] = useState("");

  const countries = useMemo(() => {
    const set = new Set(WAREHOUSES.map(w => w.country));
    return ["ALL", ...Array.from(set).sort()];
  }, []);

  const filtered = useMemo(() => {
    let rows = [...WAREHOUSES];
    if (countryFilter !== "ALL") rows = rows.filter(w => w.country === countryFilter);
    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter(w =>
        w.name.toLowerCase().includes(q) ||
        w.city.toLowerCase().includes(q) ||
        w.id.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [query, countryFilter]);

  const totalCapacity = WAREHOUSES.reduce((s, w) => s + w.capacity, 0);
  const totalAvailable = WAREHOUSES.reduce((s, w) => s + w.available, 0);

  // Fetch all messages sent by this user across all warehouses (global inbox) — paginated
  const PAGE_SIZE = 5;
  const [msgPage, setMsgPage] = useState(0); // 0-based page index
  const { data: allMyMessagesData, refetch: refetchAllMessages, isLoading: allMyMessagesLoading } = trpc.warehouseMessages.listAllMessages.useQuery(
    { limit: PAGE_SIZE * (msgPage + 1), offset: 0 },
  );
  const allMyMessages = allMyMessagesData?.messages ?? [];
  const totalMessages = allMyMessagesData?.total ?? 0;
  const hasMoreMessages = allMyMessages.length < totalMessages;

  // Fetch message history for the warehouse currently open in the contact dialog
  const { data: msgHistory, refetch: refetchHistory } = trpc.warehouseMessages.listMessages.useQuery(
    { warehouseId: contactWh?.id ?? "" },
    { enabled: contactOpen && !!contactWh?.id },
  );

  // Mark all messages for a warehouse as read when History tab is opened
  const markAllReadMutation = trpc.warehouseMessages.markAllRead.useMutation({
    onSuccess: () => refetchHistory(),
  });

  function handleHistoryTabOpen() {
    if (contactWh?.id) {
      markAllReadMutation.mutate({ warehouseId: contactWh.id });
    }
  }

  // Send message mutation
  const sendMsgMutation = trpc.warehouseMessages.sendMessage.useMutation({
    onSuccess: () => {
      toast.success("Message sent to warehouse operator");
      setMsgSubject("");
      setMsgBody("");
      refetchHistory();
      refetchAllMessages();
    },
    onError: (err) => toast.error(err.message),
  });

  function openContactDialog(wh: typeof WAREHOUSES[0]) {
    setContactWh(wh);
    setMsgSubject(`Warehouse Inquiry — ${wh.name}`);
    setMsgBody(
      `Hello,\n\nI am interested in depositing commodities at ${wh.name} (${wh.city}, ${wh.country}).\n\nWarehouse ID: ${wh.id}\nAvailable Capacity: ${wh.available.toLocaleString()} MT\n\nPlease provide more information about your rates and procedures.\n\nThank you.`
    );
    setSelected(null);
    setContactOpen(true);
  }

  function handleSendMessage() {
    if (!contactWh) return;
    if (!msgSubject.trim()) { toast.error("Please enter a subject"); return; }
    if (!msgBody.trim()) { toast.error("Please enter a message"); return; }
    sendMsgMutation.mutate({
      warehouseId:   contactWh.id,
      warehouseName: contactWh.name,
      subject:       msgSubject.trim(),
      body:          msgBody.trim(),
    });
  }

  function handleDepositHere(wh: typeof WAREHOUSES[0]) {
    setSelected(null);
    navigate(`/deposits?warehouseId=${encodeURIComponent(wh.id)}`);
  }

  if (allMyMessagesLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
  return (
    <div className="page-container space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'DM Serif Display', serif" }}>
          Certified Warehouses
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {WAREHOUSES.length} certified facilities across {countries.length - 1} countries
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Facilities",  value: String(WAREHOUSES.length),                 color: "text-foreground" },
          { label: "Total Capacity",    value: `${(totalCapacity/1000).toFixed(0)}k MT`,  color: "text-primary" },
          { label: "Available Space",   value: `${(totalAvailable/1000).toFixed(0)}k MT`, color: "text-positive" },
          { label: "Countries",         value: String(countries.length - 1),               color: "text-blue-400" },
        ].map(s => (
          <div key={s.label} className="stat-card text-center">
            <div className={"text-2xl font-bold font-mono " + s.color}>{s.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search warehouse name, city, or ID..." value={query} onChange={e => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={countryFilter} onValueChange={setCountryFilter}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {countries.map(c => (
              <SelectItem key={c} value={c}>
                {c === "ALL" ? "All Countries" : `${COUNTRY_FLAGS[c] || "🌍"} ${c}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground text-sm rounded-xl border border-border">
            No warehouses match your search.
          </div>
        )}
        {filtered.map(wh => {
          const usedPct = ((wh.capacity - wh.available) / wh.capacity) * 100;
          return (
            <div
              key={wh.id}
              className="rounded-xl border border-border bg-card p-4 hover:border-primary/30 transition-all duration-200 cursor-pointer hover:shadow-lg hover:shadow-primary/5"
              onClick={() => setSelected(wh)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Warehouse className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <div className="text-xs font-mono text-muted-foreground">{wh.id}</div>
                    <Badge variant="outline" className="text-[10px] border-positive/30 text-positive mt-0.5">
                      <CheckCircle2 className="w-2.5 h-2.5 mr-1" />Certified
                    </Badge>
                  </div>
                </div>
                <span className="text-lg">{COUNTRY_FLAGS[wh.country] || "🌍"}</span>
              </div>

              <h3 className="font-semibold text-foreground text-sm leading-tight">{wh.name}</h3>
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                <MapPin className="w-3 h-3" />
                {wh.city}, {wh.state}, {wh.country}
              </div>

              <div className="mt-3">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Capacity used</span>
                  <span className="font-mono text-foreground">{usedPct.toFixed(0)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className={"h-full rounded-full " + (usedPct > 85 ? "bg-negative" : usedPct > 60 ? "bg-yellow-500" : "bg-positive")}
                    style={{ width: `${usedPct}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>{wh.available.toLocaleString()} MT available</span>
                  <span>{wh.capacity.toLocaleString()} MT total</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-1 mt-3">
                {wh.commodities.slice(0, 6).map(sym => {
                  const c = COMMODITIES.find(c => c.symbol === sym);
                  return c ? (
                    <span key={sym} className="text-base" title={c.name}>
                      {CATEGORY_ICONS[c.category]}
                    </span>
                  ) : null;
                })}
                {wh.commodities.length > 6 && (
                  <span className="text-xs text-muted-foreground self-center">+{wh.commodities.length - 6}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Warehouse Detail Dialog ── */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Warehouse className="w-5 h-5 text-primary" />
              {selected?.name}
            </DialogTitle>
            <DialogDescription>{selected?.id} · {selected?.city}, {selected?.country}</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  ["Total Capacity", `${selected.capacity.toLocaleString()} MT`],
                  ["Available",      `${selected.available.toLocaleString()} MT`],
                  ["City",           selected.city],
                  ["State/Region",   selected.state],
                  ["Country",        `${COUNTRY_FLAGS[selected.country] || "🌍"} ${selected.country}`],
                  ["Certification",  "NEXCOM Grade A"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-secondary/50 p-3">
                    <div className="text-xs text-muted-foreground">{k}</div>
                    <div className="text-sm font-semibold text-foreground mt-0.5">{v}</div>
                  </div>
                ))}
              </div>

              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Supported Commodities</div>
                <div className="flex flex-wrap gap-2">
                  {selected.commodities.map(sym => {
                    const c = COMMODITIES.find(c => c.symbol === sym);
                    return c ? (
                      <Badge key={sym} variant="outline" className="text-xs gap-1">
                        {CATEGORY_ICONS[c.category]} {c.name.split(" ")[0]}
                      </Badge>
                    ) : null;
                  })}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1 gap-2"
                  onClick={() => openContactDialog(selected)}
                >
                  <Mail className="w-4 h-4" />Contact Warehouse
                </Button>
                <Button
                  className="flex-1 gap-2"
                  onClick={() => handleDepositHere(selected)}
                >
                  <Package className="w-4 h-4" />Deposit Here
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── My Messages — Global Inbox ── */}
      {allMyMessages && allMyMessages.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-primary" />
              My Messages
              <Badge variant="outline" className="text-[10px]">{allMyMessages.length}</Badge>
            </h2>
            <span className="text-xs text-muted-foreground">Messages you've sent to warehouse operators</span>
          </div>
          <div className="space-y-2">
            {allMyMessages.length === 0 && (
              <div className="py-8 text-center text-muted-foreground text-sm rounded-xl border border-border">
                No messages sent yet. Use the Contact Warehouse button to start a conversation.
              </div>
            )}
            {allMyMessages.map(msg => (
              <div key={msg.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground truncate">{msg.subject}</span>
                      {msg.status === "REPLIED" && (
                        <Badge className="text-[10px] bg-positive/20 text-positive border-positive/30 shrink-0">Replied</Badge>
                      )}
                      {msg.status === "SENT" && (
                        <Badge variant="outline" className="text-[10px] shrink-0">Pending</Badge>
                      )}
                      {msg.status === "READ" && (
                        <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-400/30 shrink-0">Read</Badge>
                      )}
                      {msg.status === "CLOSED" && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">Closed</Badge>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      To: <span className="font-medium">{msg.warehouseName}</span> · {new Date(msg.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7 px-2 shrink-0"
                    onClick={() => {
                      const wh = WAREHOUSES.find(w => w.id === msg.warehouseId);
                      if (wh) openContactDialog(wh);
                    }}
                  >
                    <MessageSquare className="w-3 h-3 mr-1" />View Thread
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-2">{msg.body}</p>
                {msg.replyBody && (
                  <div className="rounded-md bg-primary/10 border border-primary/20 p-2">
                    <div className="text-[10px] font-semibold text-primary mb-0.5">Warehouse Reply</div>
                    <p className="text-xs text-foreground whitespace-pre-wrap line-clamp-3">{msg.replyBody}</p>
                    {msg.repliedAt && (
                      <div className="text-[10px] text-muted-foreground mt-1">{new Date(msg.repliedAt).toLocaleString()}</div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {hasMoreMessages && (
              <div className="pt-1 text-center">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-xs"
                  onClick={() => setMsgPage(p => p + 1)}
                >
                  Show more <span className="text-muted-foreground">({totalMessages - allMyMessages.length} remaining)</span>
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── In-App Contact Dialog ── */}
      <Dialog open={contactOpen} onOpenChange={setContactOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-primary" />
              Contact {contactWh?.name}
            </DialogTitle>
            <DialogDescription>
              Send an on-platform message to the warehouse operator. All messages are logged for compliance.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="compose">
            <TabsList className="w-full">
              <TabsTrigger value="compose" className="flex-1">Compose</TabsTrigger>
              <TabsTrigger value="history" className="flex-1" onClick={handleHistoryTabOpen}>
                History {msgHistory && msgHistory.length > 0 ? `(${msgHistory.length})` : ""}
                {msgHistory && msgHistory.some(m => !m.readAt) && (
                  <span className="ml-1.5 inline-flex items-center justify-center w-2 h-2 rounded-full bg-orange-500" />
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="compose" className="space-y-3 pt-2">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Subject</Label>
                <Input
                  value={msgSubject}
                  onChange={e => setMsgSubject(e.target.value)}
                  placeholder="e.g. Storage inquiry for maize"
                  maxLength={300}
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Message</Label>
                <Textarea
                  value={msgBody}
                  onChange={e => setMsgBody(e.target.value)}
                  placeholder="Describe your inquiry..."
                  rows={6}
                  maxLength={4000}
                  className="resize-none"
                />
                <div className="text-[10px] text-muted-foreground text-right mt-1">{msgBody.length}/4000</div>
              </div>
              <Button
                className="w-full gap-2"
                onClick={handleSendMessage}
                disabled={sendMsgMutation.isPending}
              >
                <Send className="w-4 h-4" />
                {sendMsgMutation.isPending ? "Sending…" : "Send Message"}
              </Button>
            </TabsContent>

            <TabsContent value="history" className="pt-2">
              {!msgHistory || msgHistory.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  No messages sent to this warehouse yet.
                </div>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {msgHistory.map(msg => (
                    <div key={msg.id} className={`rounded-lg border p-3 space-y-1.5 ${!msg.readAt ? "border-orange-500/40 bg-orange-500/5" : "border-border bg-secondary/30"}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {!msg.readAt && <span className="inline-flex items-center justify-center w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />}
                          <span className="text-xs font-semibold text-foreground truncate">{msg.subject}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {STATUS_ICONS[msg.status]}
                          <span className="text-[10px] text-muted-foreground capitalize">{msg.status.toLowerCase()}</span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">{msg.body}</p>
                      {msg.replyBody && (
                        <div className="rounded-md bg-primary/10 border border-primary/20 p-2 mt-1">
                          <div className="text-[10px] font-semibold text-primary mb-0.5">Warehouse Reply</div>
                          <p className="text-xs text-foreground whitespace-pre-wrap">{msg.replyBody}</p>
                        </div>
                      )}
                      <div className="text-[10px] text-muted-foreground">
                        {new Date(msg.createdAt).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}
