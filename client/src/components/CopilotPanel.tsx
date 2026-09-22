/**
 * NEXCOM — CopilotPanel (INNOV-A / Innovation 5)
 *
 * Slide-over AI market copilot chat. Answers are grounded in real exchange
 * data (live prices, 24h trade trends, caller's portfolio, ml-platform
 * forecasts) assembled server-side; each assistant message shows source chips
 * for the data that fed it and a "rules mode" badge when no LLM key is
 * configured. Streaming is not used (tRPC mutation round-trip).
 *
 * Mount with the floating trigger:
 *   <CopilotPanel />   // renders its own floating button
 * or control externally via the `open`/`onOpenChange` props.
 */
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Bot, Database, Loader2, Send, Sparkles, TrendingUp, Briefcase, LineChart } from "lucide-react";
import { toast } from "sonner";

interface SourceChip {
  kind: "live-prices" | "trade-trends" | "portfolio" | "ml-forecast";
  detail: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  mode?: "llm" | "rules";
  sources?: SourceChip[];
}

const SOURCE_META: Record<SourceChip["kind"], { label: string; icon: React.ElementType }> = {
  "live-prices": { label: "Live prices", icon: Database },
  "trade-trends": { label: "24h trades", icon: TrendingUp },
  portfolio: { label: "Your portfolio", icon: Briefcase },
  "ml-forecast": { label: "ML forecast", icon: LineChart },
};

interface CopilotPanelProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function CopilotPanel({ open, onOpenChange }: CopilotPanelProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: suggestions } = trpc.marketAssistant.suggestions.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

  const askMutation = trpc.marketAssistant.ask.useMutation({
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer,
          timestamp: data.timestamp,
          mode: data.mode,
          sources: data.sources,
        },
      ]);
    },
    onError: (err) => {
      toast.error(err.message || "Copilot unavailable.");
      setMessages((prev) => prev.slice(0, -1)); // drop the pending user message
    },
  });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isOpen]);

  const send = (question: string) => {
    const q = question.trim();
    if (!q || askMutation.isPending) return;
    const userMsg: ChatMessage = { role: "user", content: q, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    askMutation.mutate({
      question: q,
      history: messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    });
  };

  return (
    <>
      {/* Floating trigger (only when not externally controlled) */}
      {open === undefined && (
        <Button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 h-12 w-12 rounded-full bg-teal-700 shadow-lg hover:bg-teal-800"
          aria-label="Open market copilot"
        >
          <Sparkles className="h-5 w-5" />
        </Button>
      )}

      <Sheet open={isOpen} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-md">
          <SheetHeader className="border-b border-slate-200 p-4">
            <SheetTitle className="flex items-center gap-2 text-slate-800">
              <Bot className="h-5 w-5 text-teal-700" /> Market Copilot
            </SheetTitle>
            <p className="text-xs text-slate-500">
              Grounded in live exchange data. Not investment advice.
            </p>
          </SheetHeader>

          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-slate-500">
                  Ask about prices, trends, forecasts, or your exposure:
                </p>
                <div className="flex flex-wrap gap-2">
                  {(suggestions ?? []).slice(0, 4).map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-left text-xs text-slate-600 hover:bg-slate-100"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-4">
              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[85%] rounded-lg bg-teal-700 px-3 py-2 text-sm text-white"
                        : "max-w-[90%] space-y-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800"
                    }
                  >
                    <p className="whitespace-pre-wrap">{m.content}</p>
                    {m.role === "assistant" && (
                      <div className="flex flex-wrap items-center gap-1">
                        {m.mode === "rules" && (
                          <Badge variant="outline" className="border-amber-300 text-[10px] text-amber-700">
                            rules mode
                          </Badge>
                        )}
                        {m.sources?.map((s) => {
                          const meta = SOURCE_META[s.kind];
                          const Icon = meta?.icon ?? Database;
                          return (
                            <Badge
                              key={s.kind}
                              variant="outline"
                              className="border-slate-300 text-[10px] text-slate-500"
                              title={s.detail}
                            >
                              <Icon className="mr-1 h-3 w-3" />
                              {meta?.label ?? s.kind}
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {askMutation.isPending && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="border-t border-slate-200 p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="flex gap-2"
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about maize prices, your exposure…"
                maxLength={500}
                disabled={askMutation.isPending}
              />
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim() || askMutation.isPending}
                className="bg-teal-700 hover:bg-teal-800"
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
