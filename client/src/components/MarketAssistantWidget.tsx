/**
 * NEXCOM Market Assistant Widget (R72)
 * Floating AI chat widget for natural language crop price and trading trend queries.
 */
import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Bot, Send, X, ChevronDown, Loader2, Sparkles, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export default function MarketAssistantWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: suggestions, refetch: refetchSuggestions } = trpc.marketAssistant.suggestions.useQuery(
    undefined,
    { staleTime: 5 * 60 * 1000 }
  );

  const askMutation = trpc.marketAssistant.ask.useMutation({
    onSuccess: (data) => {
      const assistantMsg: Message = {
        role: "assistant",
        content: data.answer,
        timestamp: data.timestamp,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      if (!isOpen || isMinimized) {
        setUnreadCount((c) => c + 1);
      }
    },
    onError: (err) => {
      toast.error(err.message || "Market assistant unavailable.");
      // Remove the pending user message on error
      setMessages((prev) => prev.slice(0, -1));
    },
  });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && !isMinimized) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setUnreadCount(0);
    }
  }, [isOpen, isMinimized]);

  const handleSend = () => {
    const question = input.trim();
    if (!question || askMutation.isPending) return;

    const userMsg: Message = {
      role: "user",
      content: question,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    askMutation.mutate({
      question,
      history: messages.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });
  };

  const handleSuggestion = (suggestion: string) => {
    setInput(suggestion);
    inputRef.current?.focus();
  };

  const handleClear = () => {
    setMessages([]);
    setInput("");
  };

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  return (
    <>
      {/* Floating toggle button */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
        {/* Unread badge */}
        {!isOpen && unreadCount > 0 && (
          <Badge className="bg-primary text-primary-foreground text-xs px-1.5 py-0.5 self-end">
            {unreadCount}
          </Badge>
        )}
        <button
          onClick={() => {
            setIsOpen((o) => !o);
            setIsMinimized(false);
            setUnreadCount(0);
          }}
          className="h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Open Market Assistant"
        >
          {isOpen ? <X className="h-6 w-6" /> : <Bot className="h-6 w-6" />}
        </button>
      </div>

      {/* Chat panel */}
      {isOpen && (
        <div
          className={`fixed bottom-24 right-6 z-50 w-[360px] rounded-xl border border-border bg-card shadow-2xl flex flex-col transition-all duration-200 ${
            isMinimized ? "h-14" : "h-[520px]"
          }`}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border rounded-t-xl bg-card">
            <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground leading-none">Market Assistant</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">AI-powered crop & trading insights</p>
            </div>
            <div className="flex items-center gap-1">
              {!isMinimized && messages.length > 0 && (
                <button
                  onClick={handleClear}
                  title="Clear conversation"
                  className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={() => setIsMinimized((m) => !m)}
                className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${isMinimized ? "rotate-180" : ""}`} />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {!isMinimized && (
            <>
              {/* Messages */}
              <ScrollArea className="flex-1 px-3 py-2" ref={scrollRef as React.RefObject<HTMLDivElement>}>
                {messages.length === 0 ? (
                  <div className="flex flex-col gap-3 pt-2">
                    <p className="text-xs text-muted-foreground text-center">
                      Ask me about crop prices, trading trends, or how to use the platform.
                    </p>
                    {suggestions && suggestions.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                          Suggested questions
                        </p>
                        {suggestions.map((s, i) => (
                          <button
                            key={i}
                            onClick={() => handleSuggestion(s)}
                            className="text-left text-xs px-3 py-2 rounded-lg border border-border bg-muted/40 hover:bg-accent/60 transition-colors text-foreground/80"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 py-1">
                    {messages.map((msg, i) => (
                      <div
                        key={i}
                        className={`flex flex-col gap-0.5 ${msg.role === "user" ? "items-end" : "items-start"}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground rounded-br-sm"
                              : "bg-muted text-foreground rounded-bl-sm"
                          }`}
                        >
                          {msg.content}
                        </div>
                        <span className="text-[10px] text-muted-foreground px-1">
                          {formatTime(msg.timestamp)}
                        </span>
                      </div>
                    ))}
                    {askMutation.isPending && (
                      <div className="flex items-start gap-2">
                        <div className="bg-muted rounded-xl rounded-bl-sm px-3 py-2 flex items-center gap-1.5">
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Thinking…</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>

              {/* Input */}
              <div className="px-3 pb-3 pt-2 border-t border-border">
                <div className="flex gap-2">
                  <Input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="Ask about crop prices or trends…"
                    className="flex-1 text-xs h-9"
                    disabled={askMutation.isPending}
                    maxLength={500}
                  />
                  <Button
                    size="sm"
                    onClick={handleSend}
                    disabled={!input.trim() || askMutation.isPending}
                    className="h-9 w-9 p-0 shrink-0"
                  >
                    {askMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
                  AI responses are informational only. Not financial advice.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
