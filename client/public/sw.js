/**
 * NEXCOM Exchange — Service Worker
 * Static assets: cache-first. Navigation: network-first with offline.html fallback.
 * /api/* (tRPC): network-only EXCEPT a strict allowlist of read-only public
 * market-data GETs (CACHEABLE_READ_ENDPOINTS below) served stale-while-
 * revalidate with a 24h offline cap — personalised financial data is never
 * cached (all POSTs/mutations/user-specific routers stay network-only).
 * Push notifications (price alerts, order fills) + background sync of the
 * offline operation queue (shared with client/src/lib/offlineConstants.ts).
 *
 * Registered exactly once by client/src/lib/registerSW.ts.
 */

const CACHE_VERSION = "v4";
const STATIC_CACHE = `nexcom-static-${CACHE_VERSION}`;
// OFFLINE-RES: separate cache for allowlisted public market-data reads so a
// deploy can invalidate it independently of the app shell.
const READ_CACHE = `nexcom-read-${CACHE_VERSION}`;

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
  const validCaches = [STATIC_CACHE, READ_CACHE];
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

// ─── OFFLINE-RES: cached market-data reads (stale-while-revalidate) ─────────
// STRICT allowlist of read-only PUBLIC tRPC procedures. These return market
// reference data identical for every user — safe to cache. NEVER add any
// procedure that varies by user (auth.*, orders.*, portfolio.*, kycService.*,
// notifications.*, profile.*, receipts.*, priceAlerts.mine, …). The allowlist
// is the security boundary: anything not listed here falls through to
// network-only above.
const CACHEABLE_READ_ENDPOINTS = [
  "/api/trpc/livePrices.getAll",
  "/api/trpc/commodities.list",
  "/api/trpc/commodities.priceHistory",
  "/api/trpc/marketStream.tickerSnapshot",
  "/api/trpc/transparency.marketStats",
  "/api/trpc/transparency.priceDiscovery",
  "/api/trpc/priceAlerts.currentPrice",
];
// Max age for offline fallback: 24h. Older data is treated as absent — we
// fail closed rather than show a farmer a dangerously stale price.
const READ_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function isCacheableMarketRead(url) {
  // tRPC GET batch format: /api/trpc/<procA>,<procB>?batch=1&input=…
  // Cacheable ONLY if EVERY procedure in the batch is on the allowlist —
  // a single user-specific procedure in the batch disqualifies the request.
  const prefix = "/api/trpc/";
  if (!url.pathname.startsWith(prefix)) return false;
  const procs = url.pathname.slice(prefix.length).split(",");
  return procs.length > 0 && procs.every((proc) => CACHEABLE_READ_ENDPOINTS.includes(prefix + proc));
}

/**
 * Stale-while-revalidate:
 *   1. Serve the cached response immediately (if any) — annotated with the
 *      original store time via X-SW-Cached-At.
 *   2. Revalidate in the background and refresh the cache.
 *   3. When the network fails (offline), serve cache up to 24h with an
 *      X-Served-Offline: 1 header so the client can badge the data as stale.
 *   4. No cache + network down → rethrow; React Query surfaces its normal
 *      error state (fail-closed, never fabricated data).
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(READ_CACHE);
  const cached = await cache.match(request);
  const cachedAt = cached ? Number(cached.headers.get("X-SW-Cached-At")) || 0 : 0;
  // Enforce the 24h cap — beyond it the cache is treated as absent.
  const cachedUsable = cached && Date.now() - cachedAt <= READ_CACHE_MAX_AGE_MS ? cached : null;

  // Definitively offline: serve the cache immediately with the marker header
  // the client keys its "OFFLINE — cached prices" badge on. No network attempt.
  if (self.navigator.onLine === false) {
    if (cachedUsable) return markOfflineServed(cachedUsable);
    throw new TypeError("Offline and no cached market data");
  }

  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, stampCachedResponse(response)).catch(() => undefined);
      }
      return response;
    })
    .catch(() => null);

  if (cachedUsable) {
    // Stale-while-revalidate: serve cache now, refresh in the background.
    // (Lie-fi 2G case: if the background revalidation fails, the client still
    // has the cached payload + X-SW-Cached-At to reason about staleness.)
    networkPromise.then(() => undefined);
    return cachedUsable;
  }

  // No usable cache — we must hit the network.
  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;

  // Offline with nothing cached for this exact query — fail closed.
  throw new TypeError("Network unavailable and no cached market data");
}

// Rebuild a cached response with the offline marker header (cached response
// headers are immutable post-construction).
function markOfflineServed(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Served-Offline", "1");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Store a copy of the response with a server-observed cache timestamp so the
// client can reason about staleness; mark offline-served responses. Headers
// on cached responses are immutable post-construction, so rebuild.
function stampCachedResponse(response) {
  const clone = response.clone();
  const headers = new Headers(clone.headers);
  headers.set("X-SW-Cached-At", String(Date.now()));
  return new Response(clone.body, {
    status: clone.status,
    statusText: clone.statusText,
    headers,
  });
}

// ─── Fetch Strategy ──────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin
  if (request.method !== "GET" || !url.origin.includes(self.location.origin.split("//")[1]?.split(":")[0] ?? "")) {
    return;
  }

  // API calls.
  // OFFLINE-RES: a STRICT ALLOWLIST of read-only, public (non-personalised)
  // market-data tRPC GET endpoints is served stale-while-revalidate so the
  // app still has price data when connectivity drops. EVERYTHING else under
  // /api/* — every POST, every mutation, every authenticated/user-specific
  // router (balances, KYC status, positions, orders…) — stays NETWORK-ONLY.
  if (url.pathname.startsWith("/api/")) {
    if (isCacheableMarketRead(url)) {
      event.respondWith(staleWhileRevalidate(request));
    } else {
      event.respondWith(fetch(request));
    }
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
