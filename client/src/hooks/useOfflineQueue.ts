/**
 * NEXCOM Exchange — useOfflineQueue
 * ─────────────────────────────────────────────────────────────────────────────
 * IndexedDB-backed queue for operations that need to be retried when the
 * device comes back online. Integrates with the service worker background sync
 * event ("sync-orders") and provides a React hook for components to enqueue
 * operations and observe queue depth.
 *
 * Supported operation types:
 *   - place_order     → POST /api/trpc/orders.place
 *   - cancel_order    → POST /api/trpc/orders.cancel
 *   - amend_order     → POST /api/trpc/orders.amend
 *   - kyc_submit      → POST /api/trpc/kyc.submit
 *   - receipt_create  → POST /api/trpc/warehouseReceipts.create
 *
 * Usage:
 *   const { enqueue, queueDepth, pendingItems, flush } = useOfflineQueue();
 *   await enqueue("place_order", { symbol: "MAIZE-DEC25", side: "BUY", ... });
 */

import { useState, useEffect, useCallback } from "react";
import {
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OFFLINE_STORE_NAME,
  OFFLINE_TRPC_ENDPOINTS,
} from "@/lib/offlineConstants";

export type OfflineOpType =
  | "place_order"
  | "cancel_order"
  | "amend_order"
  | "kyc_submit"
  | "receipt_create"
  | "alert_create"
  | "profile_update";

export interface OfflineQueueItem {
  id: string;
  type: OfflineOpType;
  payload: unknown;
  enqueuedAt: number;
  retries: number;
  lastError?: string;
}

const DB_NAME = OFFLINE_DB_NAME;
const STORE_NAME = OFFLINE_STORE_NAME;
const DB_VERSION = OFFLINE_DB_VERSION;

// ─── IndexedDB helpers ────────────────────────────────────────────────────────
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("enqueuedAt", "enqueuedAt", { unique: false });
        store.createIndex("type", "type", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll(): Promise<OfflineQueueItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).index("enqueuedAt").getAll();
    req.onsuccess = () => resolve(req.result as OfflineQueueItem[]);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(item: OfflineQueueItem): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ─── Flush logic (called on reconnect or by SW background sync) ──────────────
// Mirrors client/src/lib/offlineConstants.ts — kept in sync automatically.
const TRPC_ENDPOINT_MAP: Record<OfflineOpType, string> = OFFLINE_TRPC_ENDPOINTS as Record<OfflineOpType, string>;

async function flushQueue(onProgress?: (remaining: number) => void): Promise<{ succeeded: number; failed: number }> {
  const items = await dbGetAll();
  let succeeded = 0;
  let failed = 0;

  for (const item of items) {
    const endpoint = TRPC_ENDPOINT_MAP[item.type];
    if (!endpoint) {
      await dbDelete(item.id);
      continue;
    }

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.payload),
        credentials: "include",
      });

      if (res.ok) {
        await dbDelete(item.id);
        succeeded++;
      } else {
        // Increment retries; give up after 5 attempts
        const updated: OfflineQueueItem = {
          ...item,
          retries: item.retries + 1,
          lastError: `HTTP ${res.status}`,
        };
        if (updated.retries >= 5) {
          await dbDelete(item.id);
          console.warn(`[OfflineQueue] Dropping operation ${item.id} after 5 retries`);
        } else {
          await dbPut(updated);
        }
        failed++;
      }
    } catch (err) {
      const updated: OfflineQueueItem = {
        ...item,
        retries: item.retries + 1,
        lastError: err instanceof Error ? err.message : "network error",
      };
      if (updated.retries >= 5) {
        await dbDelete(item.id);
      } else {
        await dbPut(updated);
      }
      failed++;
    }

    const remaining = (await dbGetAll()).length;
    onProgress?.(remaining);
  }

  return { succeeded, failed };
}

// ─── React hook ──────────────────────────────────────────────────────────────
export interface UseOfflineQueueResult {
  /** Add an operation to the queue. Returns the generated item ID. */
  enqueue: (type: OfflineOpType, payload: unknown) => Promise<string>;
  /** Number of operations currently in the queue. */
  queueDepth: number;
  /** All pending items (for display in UI). */
  pendingItems: OfflineQueueItem[];
  /** Manually trigger a flush attempt. */
  flush: () => Promise<{ succeeded: number; failed: number }>;
  /** True when a flush is in progress. */
  isFlushing: boolean;
}

export function useOfflineQueue(): UseOfflineQueueResult {
  const [pendingItems, setPendingItems] = useState<OfflineQueueItem[]>([]);
  const [isFlushing, setIsFlushing] = useState(false);

  // Load queue from IndexedDB on mount
  const refresh = useCallback(async () => {
    try {
      const items = await dbGetAll();
      setPendingItems(items);
    } catch {
      // IndexedDB not available (e.g., private browsing in some browsers)
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-flush when coming back online
  useEffect(() => {
    const handleOnline = async () => {
      if (pendingItems.length > 0) {
        setIsFlushing(true);
        await flushQueue(async () => {
          await refresh();
        });
        setIsFlushing(false);
        await refresh();
      }
    };

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [pendingItems.length, refresh]);

  const enqueue = useCallback(async (type: OfflineOpType, payload: unknown): Promise<string> => {
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const item: OfflineQueueItem = {
      id,
      type,
      payload,
      enqueuedAt: Date.now(),
      retries: 0,
    };
    await dbPut(item);
    await refresh();

    // Register background sync with service worker if available
    if ("serviceWorker" in navigator && "SyncManager" in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await (reg as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register("sync-orders");
      } catch {
        // Background sync not supported — will flush on next online event
      }
    }

    return id;
  }, [refresh]);

  const flush = useCallback(async () => {
    setIsFlushing(true);
    const result = await flushQueue(async () => {
      await refresh();
    });
    setIsFlushing(false);
    await refresh();
    return result;
  }, [refresh]);

  return {
    enqueue,
    queueDepth: pendingItems.length,
    pendingItems,
    flush,
    isFlushing,
  };
}
