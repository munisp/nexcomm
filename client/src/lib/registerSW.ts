/**
 * NEXCOM Exchange — Single service-worker registration (UX-FIX)
 * ─────────────────────────────────────────────────────────────────────────────
 * The ONLY place /sw.js is registered. Previously the SW was registered in
 * three places (index.html inline script, main.tsx, usePWA) with conflicting
 * update policies (60s vs 60min update checks; the inline script purged ALL
 * caches on every SW activation, defeating the SW's cache strategy).
 *
 * Deterministic update flow:
 *   1. register("/sw.js") once on window load
 *   2. poll for updates hourly (and on tab refocus)
 *   3. when a new SW takes control (controllerchange), reload the page ONCE
 *      so users never run a stale app shell against a new API
 *   4. relay offline-queue flush completions to the UI via CustomEvent
 */

const UPDATE_POLL_MS = 60 * 60 * 1000; // 1 hour
let _registered = false;

export function registerServiceWorker(): void {
  if (_registered) return;
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  _registered = true;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        console.log("[SW] Registered, scope:", reg.scope);

        // Poll hourly + on tab refocus (cheap no-op when nothing changed)
        setInterval(() => reg.update().catch(() => undefined), UPDATE_POLL_MS);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") reg.update().catch(() => undefined);
        });

        // Ask a waiting worker to activate immediately
        if (reg.waiting && navigator.serviceWorker.controller) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        }
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              // New version waiting — activate it (sw.js calls skipWaiting on install,
              // so this is a belt-and-braces nudge)
              worker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch((err) => console.warn("[SW] Registration failed:", err));

    // Reload once when the new SW takes control (avoid reload loops)
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });

    // Relay SW messages (offline queue flushed, etc.) to the app
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "OFFLINE_QUEUE_FLUSHED") {
        window.dispatchEvent(
          new CustomEvent("offline-queue-flushed", { detail: { remaining: event.data.remaining } }),
        );
      }
    });
  });
}
