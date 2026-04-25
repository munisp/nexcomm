/**
 * AdminWarehouseMessages.tsx
 * Admin inbox for all warehouse contact messages submitted by farmers/traders.
 * Features: status filter, reply dialog, mark-read, close thread, pagination.
 * Backend: trpc.warehouseMessages.adminListAll / adminReply / adminMarkRead / adminClose
 */
import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  MessageSquare, Clock, CheckCheck, Reply, X, RefreshCw,
  ChevronLeft, ChevronRight, Search, Warehouse, User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageSkeleton } from "@/components/PageSkeleton";

type MsgStatus = "ALL" | "SENT" | "READ" | "REPLIED" | "CLOSED";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  SENT:    { label: "Unread",   color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", icon: <Clock className="w-3 h-3" /> },
  READ:    { label: "Read",     color: "bg-blue-500/20 text-blue-400 border-blue-500/30",       icon: <CheckCheck className="w-3 h-3" /> },
  REPLIED: { label: "Replied",  color: "bg-positive/20 text-positive border-positive/30",        icon: <Reply className="w-3 h-3" /> },
  CLOSED:  { label: "Closed",   color: "bg-muted/50 text-muted-foreground border-border",        icon: <X className="w-3 h-3" /> },
};

const PAGE_SIZE = 20;

export default function AdminWarehouseMessages() {
  const utils = trpc.useUtils();
  const [statusFilter, setStatusFilter] = useState<MsgStatus>("ALL");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyOpen, setReplyOpen] = useState(false);

  const { data: messages = [], isLoading, refetch } = trpc.warehouseMessages.adminListAll.useQuery(
    { status: statusFilter, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
    { refetchInterval: 30_000 },
  );

  // Auto-clear all SENT→READ when admin opens the inbox (once per mount)
  const didMarkRead = useRef(false);
  const adminMarkAllReadMutation = trpc.warehouseMessages.adminMarkAllRead.useMutation({
    onSuccess: () => {
      utils.warehouseMessages.adminUnreadCount.invalidate();
      utils.warehouseMessages.adminListAll.invalidate();
    },
  });
  useEffect(() => {
    if (!didMarkRead.current) {
      didMarkRead.current = true;
      adminMarkAllReadMutation.mutate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const replyMutation = trpc.warehouseMessages.adminReply.useMutation({
    onSuccess: () => {
      toast.success("Reply sent");
      setReplyBody("");
      setReplyOpen(false);
      setSelected(null);
      utils.warehouseMessages.adminListAll.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const markReadMutation = trpc.warehouseMessages.adminMarkRead.useMutation({
    onSuccess: () => utils.warehouseMessages.adminListAll.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const closeMutation = trpc.warehouseMessages.adminClose.useMutation({
    onSuccess: () => {
      toast.success("Thread closed");
      utils.warehouseMessages.adminListAll.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // Client-side search filter on top of server-side status filter
  const filtered = messages.filter(m => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.subject.toLowerCase().includes(q) ||
      m.warehouseName.toLowerCase().includes(q) ||
      m.warehouseId.toLowerCase().includes(q) ||
      String(m.userId).includes(q)
    );
  });

  const selectedMsg = messages.find(m => m.id === selected);

  function openReply(msgId: number) {
    setSelected(msgId);
    setReplyBody("");
    setReplyOpen(true);
    // Mark as read if still SENT
    const msg = messages.find(m => m.id === msgId);
    if (msg?.status === "SENT") {
      markReadMutation.mutate({ messageId: msgId });
    }
  }

  function handleSendReply() {
    if (!selected) return;
    if (!replyBody.trim()) { toast.error("Reply cannot be empty"); return; }
    replyMutation.mutate({ messageId: selected, replyBody: replyBody.trim() });
  }

  const unreadCount = messages.filter(m => m.status === "SENT").length;

  return (
    <div className="page-container space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'DM Serif Display', serif" }}>
            Warehouse Message Inbox
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            On-platform messages from farmers and traders to warehouse operators
            {unreadCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-yellow-400 font-semibold">
                <Clock className="w-3 h-3" />{unreadCount} unread
              </span>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => refetch()}>
          <RefreshCw className="w-3.5 h-3.5" />Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search subject, warehouse, or user ID..." value={search} onChange={(e) => setSearch(e.target.value)}
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v as MsgStatus); setPage(0); }}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="SENT">Unread</SelectItem>
            <SelectItem value="READ">Read</SelectItem>
            <SelectItem value="REPLIED">Replied</SelectItem>
            <SelectItem value="CLOSED">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Message list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-secondary/40 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground text-sm rounded-xl border border-border">
          <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
          No messages found.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(msg => {
            const cfg = STATUS_CONFIG[msg.status] ?? STATUS_CONFIG.SENT;
            const isUnread = msg.status === "SENT";
  if (isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={5} />;
            return (
              <div
                key={msg.id}
                className={cn(
                  "rounded-xl border p-4 transition-all cursor-pointer hover:border-primary/30 hover:shadow-md hover:shadow-primary/5",
                  isUnread ? "border-yellow-500/30 bg-yellow-500/5" : "border-border bg-card",
                )}
                onClick={() => openReply(msg.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isUnread && <span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0" />}
                      <span className={cn("font-semibold text-sm truncate", isUnread ? "text-foreground" : "text-foreground/80")}>
                        {msg.subject}
                      </span>
                      <Badge variant="outline" className={cn("text-[10px] gap-1 shrink-0", cfg.color)}>
                        {cfg.icon}{cfg.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <Warehouse className="w-3 h-3" />{msg.warehouseName}
                      </span>
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />User #{msg.userId}
                      </span>
                      <span>{new Date(msg.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{msg.body}</p>
                    {msg.replyBody && (
                      <div className="mt-2 rounded-md bg-primary/10 border border-primary/20 px-3 py-1.5">
                        <span className="text-[10px] font-semibold text-primary">Your reply: </span>
                        <span className="text-xs text-foreground line-clamp-1">{msg.replyBody}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      onClick={() => openReply(msg.id)}
                    >
                      <Reply className="w-3 h-3" />Reply
                    </Button>
                    {msg.status !== "CLOSED" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs gap-1 text-muted-foreground"
                        onClick={() => closeMutation.mutate({ messageId: msg.id })}
                        disabled={closeMutation.isPending}
                      >
                        <X className="w-3 h-3" />Close
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {(page > 0 || messages.length === PAGE_SIZE) && (
        <div className="flex items-center justify-between pt-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={page === 0}
            onClick={() => setPage(p => Math.max(0, p - 1))}
          >
            <ChevronLeft className="w-4 h-4" />Previous
          </Button>
          <span className="text-xs text-muted-foreground">Page {page + 1}</span>
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={messages.length < PAGE_SIZE}
            onClick={() => setPage(p => p + 1)}
          >
            Next<ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Reply Dialog */}
      <Dialog open={replyOpen} onOpenChange={setReplyOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Reply className="w-5 h-5 text-primary" />
              Reply to Message
            </DialogTitle>
            {selectedMsg && (
              <DialogDescription>
                {selectedMsg.subject} — {selectedMsg.warehouseName} · User #{selectedMsg.userId}
              </DialogDescription>
            )}
          </DialogHeader>

          {selectedMsg && (
            <div className="space-y-4">
              {/* Original message */}
              <div className="rounded-lg bg-secondary/50 border border-border p-3">
                <div className="text-xs font-semibold text-muted-foreground mb-1">Original Message</div>
                <p className="text-sm text-foreground whitespace-pre-wrap max-h-32 overflow-y-auto">{selectedMsg.body}</p>
                <div className="text-[10px] text-muted-foreground mt-2">
                  Sent {new Date(selectedMsg.createdAt).toLocaleString()}
                </div>
              </div>

              {/* Existing reply if any */}
              {selectedMsg.replyBody && (
                <div className="rounded-lg bg-primary/10 border border-primary/20 p-3">
                  <div className="text-xs font-semibold text-primary mb-1">Previous Reply</div>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{selectedMsg.replyBody}</p>
                  {selectedMsg.repliedAt && (
                    <div className="text-[10px] text-muted-foreground mt-2">
                      Replied {new Date(selectedMsg.repliedAt).toLocaleString()}
                    </div>
                  )}
                </div>
              )}

              {/* Reply form */}
              {selectedMsg.status !== "CLOSED" ? (
                <>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Your Reply</Label>
                    <Textarea
                      value={replyBody}
                      onChange={e => setReplyBody(e.target.value)}
                      placeholder="Type your reply to the farmer/trader..."
                      rows={5}
                      maxLength={4000}
                      className="resize-none"
                    />
                    <div className="text-[10px] text-muted-foreground text-right mt-1">{replyBody.length}/4000</div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      className="flex-1 gap-2"
                      onClick={handleSendReply}
                      disabled={replyMutation.isPending}
                    >
                      <Reply className="w-4 h-4" />
                      {replyMutation.isPending ? "Sending…" : "Send Reply"}
                    </Button>
                    <Button
                      variant="outline"
                      className="gap-2"
                      onClick={() => {
                        closeMutation.mutate({ messageId: selectedMsg.id });
                        setReplyOpen(false);
                      }}
                      disabled={closeMutation.isPending}
                    >
                      <X className="w-4 h-4" />Close Thread
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  This thread has been closed.
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
