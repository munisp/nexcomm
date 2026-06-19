/**
 * useOrderFillSSE — subscribes to the /api/sse/order-fills endpoint and
 * fires a sonner toast whenever the authenticated user's order is filled.
 *
 * Usage: call this hook once at the app root (e.g. inside DashboardLayout)
 * so all pages receive fill notifications automatically.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

interface OrderFillEvent {
  orderId: number;
  symbol: string;
  side: "BUY" | "SELL";
  filledQty: number;
  fillPrice: number;
  timestamp: string;
}

export function useOrderFillSSE() {
  const { user } = useAuth();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Only connect when user is authenticated
    if (!user) return;

    const es = new EventSource("/api/sse/order-fills", { withCredentials: true });
    esRef.current = es;

    es.addEventListener("order_fill", (e: MessageEvent) => {
      try {
        const fill = JSON.parse(e.data) as OrderFillEvent;
        const side = fill.side === "BUY" ? "🟢 BUY" : "🔴 SELL";
        toast.success(
          `Order filled — ${side} ${fill.filledQty} ${fill.symbol} @ ${fill.fillPrice}`,
          {
            description: `Order #${fill.orderId} · ${new Date(fill.timestamp).toLocaleTimeString()}`,
            duration: 8000,
          }
        );
      } catch {
        // Malformed event — ignore
      }
    });

    es.onerror = () => {
      // EventSource auto-reconnects; no action needed
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [user]);
}
