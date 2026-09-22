/**
 * useOfflineOrderQueue — order submission that survives offline periods.
 *
 * Direct port of the portal's client/src/hooks/useOfflineOrder.ts to React
 * Native semantics:
 *
 *   Online:  submit directly via orders.create with a clientOrderId UUID
 *            (idempotent — safe against double-taps and lost responses).
 *   Offline / network failure: enqueue into the MMKV queue
 *            (lib/offlineQueue.ts) with the SAME UUID as idempotencyKey and
 *            return { status: "queued" } — the screen shows honest
 *            "Will send when online" copy.
 *   Replay:  when the app returns to the foreground (AppState "active") and
 *            the connection-quality probe has seen a recent success, drain
 *            FIFO, ONE operation at a time, through
 *            offlineSync.submitQueued — the server replays each op through
 *            the real orders.create path with the key injected as
 *            clientOrderId (server/routers/offlineSyncRouter.ts). Results
 *            "done" and "duplicate" both remove the op (a duplicate means
 *            the order already placed — that is success).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import { trpc } from './trpc';
import {
  enqueueOrder,
  listQueued,
  markRetried,
  removeQueued,
  subscribeQueueCount,
  type OrderQueuePayload,
} from './offlineQueue';
import { getConnectionQuality, subscribeConnectionQuality } from './connectionQuality';

/** tRPC errors that mean "the network failed", not "the server rejected". */
function isNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /network request failed|failed to fetch|abort|timed?\s?out|timeout|econnrefused|socket/i.test(msg);
}

export function useOfflineOrderQueue() {
  const utils = trpc.useUtils();
  const createOrder = trpc.orders.create.useMutation();
  const submitQueued = trpc.offlineSync.submitQueued.useMutation();
  const [count, setCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const replayingRef = useRef(false);
  const createOrderRef = useRef(createOrder);
  createOrderRef.current = createOrder;
  const submitQueuedRef = useRef(submitQueued);
  submitQueuedRef.current = submitQueued;
  const utilsRef = useRef(utils);
  utilsRef.current = utils;

  useEffect(() => subscribeQueueCount(setCount), []);

  /**
   * Drain the queue FIFO, one operation per submitQueued call. Stops at the
   * first network failure (ops stay queued for the next trigger); per-op
   * server failures keep the op and continue with the next.
   */
  const replay = useCallback(async () => {
    if (replayingRef.current) return;
    if (getConnectionQuality() === 'offline') return;
    const ops = listQueued();
    if (ops.length === 0) return;
    replayingRef.current = true;
    setSyncing(true);
    let placed = 0;
    try {
      for (const op of ops) {
        try {
          const { results } = await submitQueuedRef.current.mutateAsync({
            operations: [
              { type: 'order.create' as const, idempotencyKey: op.idempotencyKey, payload: op.payload },
            ],
          });
          const r = results[0];
          if (r && (r.status === 'done' || r.status === 'duplicate')) {
            // "duplicate" = the server already has this order — success.
            removeQueued(op.id);
            if (r.status === 'done') placed++;
          } else {
            markRetried(op.id);
          }
        } catch (err) {
          // Network died mid-drain — stop; the rest stays queued.
          if (isNetworkFailure(err)) break;
          markRetried(op.id);
        }
      }
      if (placed > 0) {
        await utilsRef.current.orders.list.invalidate();
      }
    } finally {
      replayingRef.current = false;
      setSyncing(false);
    }
  }, []);

  // Replay triggers: app foregrounded, or link quality recovers from offline.
  useEffect(() => {
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void replay();
    });
    const unsubQuality = subscribeConnectionQuality(() => {
      if (getConnectionQuality() !== 'offline') void replay();
    });
    // Once on mount (covers orders queued in a previous session).
    void replay();
    return () => {
      appStateSub.remove();
      unsubQuality();
    };
  }, [replay]);

  /**
   * Submit an order; queues it when the network call cannot complete.
   * Server rejections (validation, balance, halt) throw to the caller —
   * they must surface to the user, never be queued.
   */
  const submitOrder = useCallback(
    async (
      payload: OrderQueuePayload,
    ): Promise<{ status: 'submitted' } | { status: 'queued'; idempotencyKey: string }> => {
      // One UUID per user intent: used as clientOrderId on the direct path
      // and as idempotencyKey if queued, so a lost-response retry can never
      // double-place (portal Trade.tsx does the same per-attempt).
      const idempotencyKey = Crypto.randomUUID();
      try {
        await createOrderRef.current.mutateAsync({ ...payload, clientOrderId: idempotencyKey });
        return { status: 'submitted' };
      } catch (err) {
        if (!isNetworkFailure(err)) throw err;
      }
      enqueueOrder(payload, idempotencyKey);
      return { status: 'queued', idempotencyKey };
    },
    [],
  );

  return { submitOrder, queuedCount: count, syncing, isPending: createOrder.isPending, replay };
}

export default useOfflineOrderQueue;
