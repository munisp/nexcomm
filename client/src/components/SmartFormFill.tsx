/**
 * SmartFormFill — AI-powered form auto-fill from unstructured text (R70)
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export interface SmartFillField {
  key: string; label: string;
  type: "text" | "number" | "select" | "date" | "email" | "phone";
  options?: string[]; description?: string;
}
export interface SmartFormFillProps {
  fields: SmartFillField[];
  onFill: (values: Record<string, string>) => void;
  placeholder?: string;
}

export default function SmartFormFill({ fields, onFill, placeholder }: SmartFormFillProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [lastFilled, setLastFilled] = useState<number | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleExtract = async () => {
    if (!text.trim() || isPending) return;
    setIsPending(true);
    try {
      // Use fetch directly to call the tRPC endpoint
      const res = await fetch("/api/trpc/smartFill.extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), fields }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { result?: { data?: { values: Record<string, string>; filledCount: number; totalFields: number } } };
      const data = json.result?.data;
      if (data) {
        onFill(data.values);
        setLastFilled(data.filledCount);
        setText("");
        toast.success(`Smart Fill complete — ${data.filledCount} of ${data.totalFields} fields auto-filled.`);
      }
    } catch (err) {
      toast.error(`Smart Fill failed: ${(err as Error).message}`);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="border border-dashed border-primary/40 rounded-lg bg-primary/5 overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 transition-colors">
        <span className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Smart Fill — paste text to auto-fill form
          {lastFilled !== null && <Badge variant="secondary" className="text-xs px-1.5 py-0 ml-1"><CheckCircle2 className="h-3 w-3 mr-1 text-green-500" />{lastFilled} filled</Badge>}
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-primary/20">
          <p className="text-xs text-muted-foreground pt-2">Paste any text — a message, email, or note — and the AI will extract the relevant values and fill the form fields automatically.</p>
          <Textarea value={text} onChange={e => setText(e.target.value)} placeholder={placeholder ?? 'e.g. "Buy 500 bags of white maize at ₦85,000 per tonne, GTC limit order"'} className="text-sm min-h-[80px] resize-none" maxLength={8000} />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{text.length}/8000</span>
            <Button type="button" size="sm" disabled={!text.trim() || isPending} onClick={handleExtract} className="gap-1.5">
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {isPending ? "Extracting…" : "Auto-fill"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
