/**
 * NEXCOM Exchange — useOrderFillToast
 *
 * Polls the user's unread TRADE notifications every 10 seconds.
 * When a new fill notification arrives (type === "TRADE"), it fires a
 * Sonner toast with the fill details and marks the notification as read.
 *
 * Mount this hook once in DashboardLayout so it fires on all authenticated pages.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

export function useOrderFillToast() {
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  // Fetch unread TRADE notifications only
  const { data } = trpc.notifications.list.useQuery(
    { unreadOnly: true, limit: 20 },
    {
      enabled: isAuthenticated,
      refetchInterval: 10_000,        // poll every 10 seconds
      refetchIntervalInBackground: false,
      staleTime: 5_000,
    }
  );

  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => utils.notifications.list.invalidate(),
  });

  // Track which notification IDs we have already toasted to avoid duplicates
  const seenIds = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!data?.notifications) return;

    const tradeNotifs = data.notifications.filter(n => n.type === "TRADE" && !n.read);

    for (const notif of tradeNotifs) {
      if (seenIds.current.has(notif.id)) continue;
      seenIds.current.add(notif.id);

      // Parse fill metadata if available
      const meta = notif.metadata as {
        symbol?: string;
        side?: string;
        filledQty?: number;
        avgFillPrice?: number;
        status?: string;
      } | null;

      const isFilled = meta?.status === "FILLED";
      const symbol = meta?.symbol ?? notif.title;
      const side = meta?.side;
      const qty = meta?.filledQty;
      const price = meta?.avgFillPrice;

      const priceStr = price && price > 0
        ? ` @ ${price.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
        : "";
      const qtyStr = qty ? ` ${qty}` : "";
      const sideStr = side ? `${side} ` : "";

      if (isFilled) {
        toast.success(`Order Filled: ${sideStr}${symbol}`, {
          description: `${qtyStr} units filled${priceStr}`,
          duration: 6000,
          action: {
            label: "View Orders",
            onClick: () => { window.location.href = "/orders"; },
          },
        });
      } else {
        // PARTIALLY_FILLED
        toast.info(`Partial Fill: ${sideStr}${symbol}`, {
          description: `${qtyStr} units filled${priceStr}`,
          duration: 5000,
          action: {
            label: "View Orders",
            onClick: () => { window.location.href = "/orders"; },
          },
        });
      }

      // Mark as read so it doesn't toast again on next poll
      markRead.mutate({ id: notif.id });
    }
  }, [data?.notifications]);
}
