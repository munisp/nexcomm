/**
 * useOfflineOrder (INNOV-C) — order submission that survives offline periods.
 *
 * Online: submits directly via orders.create (real path, unchanged).
 * Offline / network failure: enqueues into IndexedDB (nexcom-offline-queue /
 * operations — the store the service worker drains on Background Sync
 * "sync-orders"), shows an optimistic "Queued — will send when online" toast,
 * and registers background sync; on successful replay it invalidates the
 * orders queries and toasts a confirmation.
 *
 * Replay is idempotent end-to-end (per-op UUID → offline_operations ledger +
 * orders.clientOrderId), so double replays are safe.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  enqueue,
  onQueueReplayFallback,
  remove,
  watchCount,
  type OrderQueuePayload,
  type QueuedOperation,
} from "@/lib/offlineOrderQueue";

export function useOfflineOrder() {
  const utils = trpc.useUtils();
  const createOrder = trpc.orders.create.useMutation();
  const submitQueued = trpc.offlineSync.submitQueued.useMutation();
  const [queuedCount, setQueuedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const unwatch = watchCount((n) => mounted.current && setQueuedCount(n));

    // In-page replay fallback (Safari/Firefox have no Background Sync; also a
    // fast path while the tab is open). The SW drains the same queue on
    // "sync-orders" when available — both paths are idempotent, so overlap is
    // safe.
    const replay = async (ops: QueuedOperation[]) => {
      setSyncing(true);
      try {
        const { results } = await submitQueued.mutateAsync({
          operations: ops.map((op) => ({
            type: "order.create" as const,
            idempotencyKey: op.idempotencyKey,
            payload: op.payload as OrderQueuePayload,
          })),
        });
        let done = 0;
        for (let i = 0; i < ops.length; i++) {
          const r = results[i];
          if (r && (r.status === "done" || r.status === "duplicate")) {
            await remove(ops[i].id);
            if (r.status === "done") done++;
          }
        }
        if (done > 0) {
          await utils.orders.list.invalidate();
          await utils.orders.listFills.invalidate().catch(() => undefined);
          await utils.orders.stats.invalidate().catch(() => undefined);
          toast.success(`${done} queued order${done === 1 ? "" : "s"} submitted`);
        }
      } finally {
        setSyncing(false);
      }
    };
    const unbind = onQueueReplayFallback(replay);

    // SW → page notification when Background Sync drained the queue.
    const onSwMessage = (ev: MessageEvent) => {
      const data = ev.data as { type?: string; count?: number } | undefined;
      if (data && (data.type === "SYNC_ORDERS_DONE" || data.type === "ORDERS_SYNCED")) {
        void utils.orders.list.invalidate();
        void utils.orders.listFills.invalidate();
        toast.success("Queued orders synced");
      }
    };
    navigator.serviceWorker?.addEventListener("message", onSwMessage);

    return () => {
      mounted.current = false;
      unwatch();
      unbind();
      navigator.serviceWorker?.removeEventListener("message", onSwMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Submit an order; queues it when offline or when the network call fails. */
  const submitOrder = useCallback(
    async (
      payload: OrderQueuePayload
    ): Promise<{ status: "submitted"; orderId?: number } | { status: "queued"; idempotencyKey: string }> => {
      if (navigator.onLine) {
        try {
          const res = await createOrder.mutateAsync(payload);
          return { status: "submitted", orderId: (res as { orderId?: number }).orderId };
        } catch (err: unknown) {
          // Only queue on network-type failures; a server rejection (4xx,
          // validation, insufficient balance) must surface to the user.
          const isNetwork =
            err instanceof TypeError ||
            (err instanceof Error && /fetch|network|Failed to fetch|ECONNREFUSED/i.test(err.message));
          if (!isNetwork) throw err;
        }
      }
      const idempotencyKey = await enqueue("order.create", payload);
      setQueuedCount((n) => n + 1);
      toast.info("Queued — will send when online", {
        description: `${payload.side} ${payload.quantity} ${payload.symbol}`,
      });
      return { status: "queued", idempotencyKey };
    },
    [createOrder]
  );

  return { submitOrder, queuedCount, syncing, isPending: createOrder.isPending };
}

export default useOfflineOrder;
