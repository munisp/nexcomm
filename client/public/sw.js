/**
 * NEXCOM Exchange — Service Worker
 * Static assets: cache-first. Navigation: network-first with offline.html fallback.
 * /api/* (tRPC): network-only — personalised financial data is never cached.
 * Push notifications (price alerts, order fills) + background sync of the
 * offline operation queue (shared with client/src/lib/offlineConstants.ts).
 *
 * Registered exactly once by client/src/lib/registerSW.ts.
 */

const CACHE_VERSION = "v3";
const STATIC_CACHE = `nexcom-static-${CACHE_VERSION}`;

// Assets to pre-cache on install
const PRECACHE_URLS = [
  "/",
  "/manifest.json",
  "/offline.html",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// ─── Install ─────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate ────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  const validCaches = [STATIC_CACHE];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => !validCaches.includes(name))
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// ─── Message handling (registerSW.ts posts SKIP_WAITING for instant updates) ─
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// ─── Fetch Strategy ──────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin
  if (request.method !== "GET" || !url.origin.includes(self.location.origin.split("//")[1]?.split(":")[0] ?? "")) {
    return;
  }

  // API calls — NETWORK ONLY.
  // tRPC responses are personalised & time-sensitive (balances, KYC status,
  // positions). Caching them offline serves stale financial data — never do it.
  // The app-level offline queue (useOfflineQueue + sync event) covers writes;
  // market reference data freshness is handled by React Query, not the SW.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  // Static assets — cache-first
  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".svg")
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // HTML navigation — network-first, fallback to offline page
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match("/offline.html").then((cached) => cached || caches.match("/"))
        )
    );
    return;
  }

  // Default: network with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match("/"))
      )
  );
});

// ─── Push Notifications ──────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "NEXCOM Exchange", body: event.data.text() };
  }

  const options = {
    body: data.body || "You have a new notification",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag || "nexcom-notification",
    data: { url: data.url || "/" },
    actions: data.actions || [],
    vibrate: [100, 50, 100],
    requireInteraction: data.requireInteraction || false,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "NEXCOM Exchange", options)
  );
});

// ─── Notification Click ──────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus existing window if open
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      // Open new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});

// ─── Background Sync ─────────────────────────────────────────────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-orders") {
    event.waitUntil(syncPendingOrders());
  }
});

// IMPORTANT: these values MUST match client/src/lib/offlineConstants.ts
// (OFFLINE_DB_NAME / OFFLINE_DB_VERSION / OFFLINE_STORE_NAME /
//  OFFLINE_TRPC_ENDPOINTS). The app writes queued operations to this exact
// database/store; if the two drift apart, offline orders silently never sync.
const OFFLINE_DB_NAME = "nexcom-offline-queue";      // keep in sync with offlineConstants.ts
const OFFLINE_DB_VERSION = 1;                        // keep in sync with offlineConstants.ts
const OFFLINE_STORE_NAME = "operations";             // keep in sync with offlineConstants.ts
const OFFLINE_TRPC_ENDPOINTS = {                     // keep in sync with offlineConstants.ts
  place_order: "/api/trpc/orders.create",
  cancel_order: "/api/trpc/orders.cancel",
  amend_order: "/api/trpc/orders.amend",
  kyc_submit: "/api/trpc/kycService.submitApplication",
  receipt_create: "/api/trpc/receipts.create",
  alert_create: "/api/trpc/priceAlerts.create",
  profile_update: "/api/trpc/profile.update",
};
const OFFLINE_MAX_RETRIES = 5;

async function syncPendingOrders() {
  // Drain the offline operation queue written by the app (useOfflineQueue.ts)
  // and retry each operation against its tRPC endpoint.
  try {
    const db = await openDB();
    const pending = await getFromDB(db, OFFLINE_STORE_NAME);
    for (const item of pending || []) {
      const endpoint = OFFLINE_TRPC_ENDPOINTS[item.type];
      if (!endpoint) {
        await deleteFromDB(db, OFFLINE_STORE_NAME, item.id);
        continue;
      }
      try {
        // Idempotency: the queued item's idempotencyKey (written by
        // lib/offlineOrderQueue.ts / hooks/useOfflineQueue.ts) is forwarded as
        // clientOrderId so orders.create's server-side dedupe catches replays
        // of operations the server already accepted before connectivity dropped.
        const body =
          item.type === "place_order" && item.idempotencyKey
            ? { ...item.payload, clientOrderId: item.idempotencyKey }
            : item.payload;
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          credentials: "include",
        });
        if (res.ok) {
          await deleteFromDB(db, OFFLINE_STORE_NAME, item.id);
        } else {
          const retries = (item.retries || 0) + 1;
          if (retries >= OFFLINE_MAX_RETRIES) {
            await deleteFromDB(db, OFFLINE_STORE_NAME, item.id); // drop poisoned item
          } else {
            await putToDB(db, OFFLINE_STORE_NAME, { ...item, retries, lastError: `HTTP ${res.status}` });
          }
        }
      } catch {
        // Network still down — will retry on next sync event
      }
    }
    // Tell open clients the queue changed so UI badges can refresh
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const remaining = (await getFromDB(db, OFFLINE_STORE_NAME)).length;
    for (const client of clients) {
      client.postMessage({ type: "OFFLINE_QUEUE_FLUSHED", remaining });
    }
  } catch {
    // IndexedDB not available
  }
}

// Simple IndexedDB helpers
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(OFFLINE_STORE_NAME)) {
        const store = db.createObjectStore(OFFLINE_STORE_NAME, { keyPath: "id" });
        store.createIndex("enqueuedAt", "enqueuedAt", { unique: false });
        store.createIndex("type", "type", { unique: false });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = reject;
  });
}

function getFromDB(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = reject;
  });
}

function putToDB(db, storeName, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).put(value);
    req.onsuccess = resolve;
    req.onerror = reject;
  });
}

function deleteFromDB(db, storeName, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).delete(id);
    req.onsuccess = resolve;
    req.onerror = reject;
  });
}
