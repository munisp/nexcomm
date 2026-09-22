/**
 * NEXCOM Exchange — Offline order queue (IndexedDB persistence + Background Sync).
 *
 * Storage contract is shared with the service worker (client/public/sw.js) and
 * the existing useOfflineQueue hook:
 *   DB:      "nexcom-offline-queue"
 *   Store:   "operations" (keyPath "id")
 *   Item:    { id, type, payload, enqueuedAt, retries, idempotencyKey }
 *
 * Replay paths:
 *   1. Background Sync (tag "sync-orders") — handled by the service worker,
 *      which drains this same store even if the tab is closed.
 *   2. In-page fallback (online / visibilitychange) — used when the Background
 *      Sync API is unavailable (e.g. Safari, Firefox); the caller supplies the
 *      submit function (useOfflineOrder wires it to trpc offlineSync.submitQueued).
 *
 * Every queued operation carries a crypto.randomUUID idempotency key, which the
 * server dedupes on (offline_operations.idempotencyKey + orders.clientOrderId).
 */

const DB_NAME = "nexcom-offline-queue";
const STORE = "operations";
const DB_VERSION = 1;
export const SYNC_TAG = "sync-orders";

export interface QueuedOperation<T = unknown> {
  id: number; // autoincrement
  type: string; // e.g. "order.create"
  payload: T;
  idempotencyKey: string;
  enqueuedAt: number;
  retries: number;
}

/** Mirrors orders.create input (server/routers/orders.ts) minus idempotency
 * fields — the idempotency key is carried separately on the queue item and
 * injected as clientOrderId at replay time. */
export interface OrderQueuePayload {
  symbol: string;
  assetClass?: "COMMODITY" | "FOREX" | "EQUITY" | "DIGITAL_ASSET" | "INDEX";
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET" | "STOP_LIMIT";
  quantity: number;
  price?: number;
  stopPrice?: number;
  timeInForce?: "GTC" | "DAY" | "IOC" | "FOK";
  notes?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

/** Queue an operation. Returns the idempotency key assigned to it. */
export async function enqueue(type: string, payload: unknown): Promise<string> {
  const idempotencyKey = crypto.randomUUID();
  const item: Omit<QueuedOperation, "id"> = {
    type,
    payload,
    idempotencyKey,
    enqueuedAt: Date.now(),
    retries: 0,
  };
  await tx("readwrite", (s) => s.add(item));
  await registerBackgroundSync();
  return idempotencyKey;
}

/** List queued operations, oldest first. */
export async function list(): Promise<QueuedOperation[]> {
  try {
    const all = await tx("readonly", (s) => s.getAll() as IDBRequest<QueuedOperation[]>);
    return (all ?? []).sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  } catch {
    return [];
  }
}

/** Remove a single operation by id. */
export async function remove(id: number): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

/** Number of queued operations (0 on any IDB failure). */
export async function count(): Promise<number> {
  try {
    return await tx("readonly", (s) => s.count());
  } catch {
    return 0;
  }
}

/** True when the Background Sync API is available. */
export function backgroundSyncSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "SyncManager" in window
  );
}

/** Ask the service worker to replay the queue when connectivity returns. */
export async function registerBackgroundSync(): Promise<void> {
  if (!backgroundSyncSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await (reg as unknown as { sync: { register: (tag: string) => Promise<void> } }).sync.register(SYNC_TAG);
  } catch {
    // Registration can fail when offline/permissionless — harmless; the
    // in-page online/visibilitychange fallback will still replay.
  }
}

/**
 * In-page replay fallback for browsers without Background Sync (and a fast
 * path when the tab is open). Calls `submit` with the current queue; the
 * caller removes successfully-replayed operations via `remove`.
 * Returns an unsubscribe function.
 */
export function onQueueReplayFallback(
  submit: (ops: QueuedOperation[]) => Promise<void>
): () => void {
  let running = false;
  const maybeReplay = async () => {
    if (running || !navigator.onLine) return;
    const ops = await list();
    if (ops.length === 0) return;
    running = true;
    try {
      await submit(ops);
    } catch {
      // Stay queued — next event retries.
    } finally {
      running = false;
    }
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") void maybeReplay();
  };
  window.addEventListener("online", maybeReplay);
  document.addEventListener("visibilitychange", onVisibility);
  // Also attempt once on registration (covers "queued while tab stayed open").
  void maybeReplay();
  return () => {
    window.removeEventListener("online", maybeReplay);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

/**
 * Subscribe to queue size changes (poll-based; IDB has no observers).
 * Interval is intentionally modest — the pill only needs coarse counts.
 */
export function watchCount(cb: (n: number) => void, intervalMs = 2000): () => void {
  void count().then(cb);
  const t = setInterval(() => void count().then(cb), intervalMs);
  return () => clearInterval(t);
}
