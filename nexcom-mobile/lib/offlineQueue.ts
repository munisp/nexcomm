/**
 * NEXCOM Mobile — offline order mutation queue (MMKV-persisted).
 *
 * Mirrors the portal's offline order queue contract
 * (client/src/lib/offlineOrderQueue.ts + server/routers/offlineSyncRouter.ts):
 *
 *   Item:  { id, type, payload, idempotencyKey, enqueuedAt, retries }
 *   type:  "order.create"   (fail-closed literal on the server)
 *   Key:   UUID per operation; the server dedupes on
 *          offline_operations.idempotencyKey AND injects the key as
 *          orders.clientOrderId at replay time (double protection).
 *
 * Storage is MMKV (sync, ~zero cost) instead of the portal's IndexedDB —
 * same semantics, mobile-native store. Replay logic lives in
 * lib/useOfflineOrderQueue.ts (needs the tRPC React client).
 */
import * as Crypto from 'expo-crypto';
import { getKv } from './mmkv';

const QUEUE_KEY = 'offline-order-queue';

/** tRPC endpoint per queued operation type — mirrors portal
 * client/src/lib/offlineConstants.ts OFFLINE_TRPC_ENDPOINTS. */
export const OFFLINE_TRPC_ENDPOINTS = {
  place_order: '/api/trpc/orders.create',
} as const;

/**
 * Mirrors orders.create input (server/routers/orders.ts) minus idempotency
 * fields — identical shape to the portal's OrderQueuePayload
 * (client/src/lib/offlineOrderQueue.ts). The idempotency key is carried
 * separately on the queue item and injected as clientOrderId at replay time.
 */
export interface OrderQueuePayload {
  symbol: string;
  assetClass?: 'COMMODITY' | 'FOREX' | 'EQUITY' | 'DIGITAL_ASSET' | 'INDEX';
  side: 'BUY' | 'SELL';
  orderType: 'LIMIT' | 'MARKET' | 'STOP_LIMIT';
  quantity: number;
  price?: number;
  stopPrice?: number;
  timeInForce?: 'GTC' | 'DAY' | 'IOC' | 'FOK';
  notes?: string;
}

export interface QueuedOperation {
  /** Local row id (UUID; MMKV has no autoincrement like the portal's IDB). */
  id: string;
  /** Fail-closed operation type — only "order.create" is supported. */
  type: 'order.create';
  /** tRPC endpoint the op targets (portal OFFLINE_TRPC_ENDPOINTS.place_order). */
  endpoint: string;
  payload: OrderQueuePayload;
  idempotencyKey: string;
  enqueuedAt: number;
  retries: number;
}

// ─── Storage ────────────────────────────────────────────────────────────────

function readQueue(): QueuedOperation[] {
  try {
    const raw = getKv().getString(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedOperation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(ops: QueuedOperation[]): void {
  try {
    getKv().set(QUEUE_KEY, JSON.stringify(ops));
  } catch {
    // MMKV unavailable — the op stays in memory of the caller; surface via
    // listeners so the UI can still show the pending count.
  }
  notify();
}

// ─── Count listeners (synchronous — MMKV needs no polling) ──────────────────

const listeners = new Set<(count: number) => void>();

function notify(): void {
  const n = readQueue().length;
  listeners.forEach((l) => l(n));
}

/** Subscribe to queued-operation count changes. Returns unsubscribe. */
export function subscribeQueueCount(cb: (count: number) => void): () => void {
  listeners.add(cb);
  cb(readQueue().length);
  return () => listeners.delete(cb);
}

// ─── Queue operations ───────────────────────────────────────────────────────

/**
 * Enqueue an order for later replay. `idempotencyKey` should be the SAME key
 * that was (or would have been) sent as clientOrderId on the direct attempt,
 * so a request that secretly reached the server before the network dropped
 * cannot double-place. Defaults to a fresh UUID.
 */
export function enqueueOrder(
  payload: OrderQueuePayload,
  idempotencyKey?: string,
): QueuedOperation {
  const op: QueuedOperation = {
    id: Crypto.randomUUID(),
    type: 'order.create',
    endpoint: OFFLINE_TRPC_ENDPOINTS.place_order,
    payload,
    idempotencyKey: idempotencyKey ?? Crypto.randomUUID(),
    enqueuedAt: Date.now(),
    retries: 0,
  };
  writeQueue([...readQueue(), op]);
  return op;
}

/** List queued operations, oldest first (FIFO replay order). */
export function listQueued(): QueuedOperation[] {
  return readQueue().sort((a, b) => a.enqueuedAt - b.enqueuedAt);
}

/** Remove a single operation by id (after done/duplicate replay). */
export function removeQueued(id: string): void {
  writeQueue(readQueue().filter((op) => op.id !== id));
}

/** Bump the retry counter of an operation that failed server-side. */
export function markRetried(id: string): void {
  writeQueue(
    readQueue().map((op) => (op.id === id ? { ...op, retries: op.retries + 1 } : op)),
  );
}

/** Current queue depth (0 on any storage failure). */
export function queuedCount(): number {
  return readQueue().length;
}
