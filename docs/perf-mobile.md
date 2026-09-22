# NEXCOM Mobile — Performance Budgets & Measurement Guide

Target devices: low-end Android (₦40k class, 2–3 GB RAM, Android 10+), 2G/3G
radio, intermittent connectivity. All budgets below are release-build
(`eas build --profile production`) numbers measured on a low-end physical
device — never on a simulator.

## Budget table

| # | Budget | Target | How to measure |
|---|--------|--------|----------------|
| 1 | Cold-start TTI, low-end Android over 3G | **< 3 s** | `adb shell am start -W exchange.nexcom.app/.MainActivity` → `TotalTime` (ms). Average of 5 cold starts (force-stop between runs). |
| 2 | List scrolling (markets, warehouse, notifications, ledger) | **60 fps, dropped frames < 5%** | RN Perf Monitor (`adb shell input keyevent 82` → "Perf Monitor") while flinging; or `systrace`/`adb shell gfxinfo exchange.nexcom.app framestats` (frames > 16.6 ms ÷ total < 5%). |
| 3 | Per-ABI release APK size | **< 40 MB** | EAS build artifact page (per-ABI APKs from `enableSeparateBuildPerCPUArchitecture`); locally `ls -la android/app/build/outputs/apk/release/`. |
| 4 | JS bundle sanity | no uncontrolled growth | `npx expo export --dump-sourcemap` then `npx source-map-explorer dist/.../*.hbc.map` (or `npx react-native-bundle-visualizer`). Review top modules after every dep change. |
| 5 | API interaction latency on 3G | **p95 < 1.5 s** | `lib/connectionQuality.ts` samples every tRPC request (dev: log samples; prod: Flipper network plugin / Charles with 3G throttle). Compute p95 of successful request durations. |
| 6 | Offline behavior | cached reads ≤ 24 h served with stale chip; orders queued + replayed | Airplane-mode walkthrough (checklist below). |
| 7 | Memory, dashboard idle | no growth across 5 min | RN Perf Monitor RAM readout; Hermes heap via Flipper. |

## How to measure each

### Cold start (budget 1)
```bash
adb shell am force-stop exchange.nexcom.app
adb shell am start -W exchange.nexcom.app/.MainActivity | grep TotalTime
```
Repeat 5×, take the median. `TotalTime` covers process spawn → first frame.
Auth rehydrate (SecureStore read) is the only render gate; push registration,
notification setup, and cache subscriptions run after interactions
(`app/_layout.tsx`).

### List fps (budget 2)
- Open the RN Perf Monitor on device (shake / `adb shell input keyevent 82`).
- Fling the markets list (FlashList) and warehouse list for ~10 s.
- UI fps must hold ~60; JS fps dips during polling refetch must recover.
- `adb shell gfxinfo exchange.nexcom.app framestats` gives exact
  dropped-frame percentages for a scroll recording.

### Bundle & APK size (budgets 3–4)
- Per-ABI APKs: EAS build report lists artifact sizes; the universal dev APK
  is expected to exceed 40 MB and is **not** the budget artifact.
- JS bundle: `npx expo export --dump-sourcemap`, inspect with
  `source-map-explorer`. Watch `victory-native` and
  `react-native-chart-kit` (both currently unused by screens — keep them out
  of the import graph or remove them in a future dep-audit pass).

### API latency (budget 5)
`lib/trpc.ts` wraps fetch: 12 s timeout, per-request latency samples feed
`lib/connectionQuality.ts`. On a 3G-throttled link (Chrome DevTools throttle
via `react-native-debugger`, or `tc qdisc` on a rooted test AP), run the
dashboard → markets → trade flow and confirm p95 < 1.5 s.

### Offline behavior (budget 6)
1. Launch online → dashboard loads prices (write-through to MMKV cache).
2. Airplane mode → force-stop → relaunch: dashboard shows last prices with
   the **"Last updated HH:mm · offline"** chip; polling is suspended.
3. Place an order on the Trade tab: alert reads "will send when online" and
   the queued badge appears. Duplicate replays are safe (server dedupes on
   `offline_operations.idempotencyKey` + `orders.clientOrderId`).
4. Leave airplane mode / foreground the app: the queue drains FIFO, one op
   at a time, via `offlineSync.submitQueued`; badge counts down; "duplicate"
   results are treated as success.
5. Entries older than 24 h are never served (fail-closed, deleted at
   hydrate time).

### Hermes / JS thread
- Hermes is the only engine (SDK 52, explicitly set in `app.json`).
- Profile with the Hermes sampling profiler:
  `npx react-native profile-hermes` → open in Chrome DevTools.

## Release regression checklist

- [ ] `node scripts/check-mobile-perf.mjs` passes (exit 0).
- [ ] Cold-start median < 3 s on the reference low-end device (3G).
- [ ] Markets + warehouse fling: dropped frames < 5%.
- [ ] Per-ABI release APK < 40 MB (EAS artifact report).
- [ ] `npx expo export --dump-sourcemap` bundle reviewed; no new heavy deps.
- [ ] 3G p95 API latency < 1.5 s on the core flow (dashboard/markets/trade).
- [ ] Airplane-mode walkthrough (read cache + order queue) passes.
- [ ] `app.json`/`app.config.ts` release flags still set
      (`enableProguardInReleaseBuilds`, `enableShrinkResourcesInReleaseBuilds`,
      `enableSeparateBuildPerCPUArchitecture`, `jsEngine: hermes`).
- [ ] Reduce-motion enabled in Android settings → app shows no animated
      transitions (root navigator falls back to `animation: 'none'`).
