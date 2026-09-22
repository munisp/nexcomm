/**
 * useOrderFillSSE — subscribes to the /api/sse/order-fills endpoint and
 * fires a sonner toast whenever the authenticated user's order is filled.
 *
 * Usage: call this hook once at the app root (e.g. inside DashboardLayout)
 * so all pages receive fill notifications automatically.
 *
 * OFFLINE-RES reconnection policy (rural 2G/3G):
 *   - EventSource's native reconnect is a fixed ~3s retry — it hammers a
 *     barely-alive link and drains battery. We take over reconnection with
 *     exponential backoff + jitter (1s → 60s cap).
 *   - Paused entirely while document.hidden (background tabs don't need
 *     real-time fills; React Query refetches on return) and while
 *     navigator.onLine === false.
 *   - Resumes (with reset backoff) on 'online' and 'visibilitychange'.
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

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60_000; // cap — never wait longer than a minute
const JITTER_FACTOR = 0.3;   // ±30% — avoid thundering herd when a tower returns

function backoffDelay(attempt: number): number {
  const exp = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  const jitter = exp * JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.max(BASE_DELAY_MS, exp + jitter);
}

export function useOrderFillSSE() {
  const { user } = useAuth();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Only connect when user is authenticated
    if (!user) return;

    let disposed = false;
    let attempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const shouldBeConnected = () =>
      !disposed && navigator.onLine && !document.hidden;

    const closeStream = () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (!shouldBeConnected() || reconnectTimer) return;
      const delay = backoffDelay(attempts);
      attempts += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (!shouldBeConnected()) return;
      closeStream();

      const es = new EventSource("/api/sse/order-fills", { withCredentials: true });
      esRef.current = es;

      es.onopen = () => {
        attempts = 0; // healthy connection — reset backoff
      };

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
        // Native EventSource would retry on a fixed cadence — suppress that by
        // closing and driving reconnection through our backoff instead.
        closeStream();
        scheduleReconnect();
      };
    };

    const handleOnline = () => {
      attempts = 0;
      connect();
    };
    const handleOffline = () => {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      closeStream();
    };
    const handleVisibility = () => {
      if (document.hidden) {
        handleOffline(); // same pause semantics: no background reconnect churn
      } else {
        handleOnline();
      }
    };

    connect();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      closeStream();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [user]);
}
