/**
 * NEXCOM Mobile — probe-based connection quality (no NetInfo dependency).
 *
 * The tRPC fetch wrapper (lib/trpc.ts) records one latency/success sample per
 * HTTP request. A tiny sliding window classifies the link as:
 *
 *   "fast"    — recent requests succeeding with low latency
 *   "slow"    — succeeding but latent (2G/3G, congested cells)
 *   "offline" — the last few requests all failed
 *
 * Screens consume `useConnectionQuality()` to scale polling: hot queries
 * poll aggressively on "fast", back off on "slow", and stop on "offline"
 * (the offline read cache / mutation queue take over from there).
 */
import { useSyncExternalStore } from 'react';

export type ConnectionQuality = 'fast' | 'slow' | 'offline';

/** Keep the window small: low-end devices, decisions must react fast. */
const MAX_SAMPLES = 8;
/** Mean latency of recent successes above this ⇒ "slow" (3G-ish). */
const SLOW_THRESHOLD_MS = 1_500;
/** This many consecutive failures ⇒ "offline". */
const FAILURE_STREAK = 3;

interface Sample {
  ok: boolean;
  durationMs: number;
}

let samples: Sample[] = [];
let quality: ConnectionQuality = 'fast';
const listeners = new Set<() => void>();

function classify(): ConnectionQuality {
  const recent = samples.slice(-FAILURE_STREAK);
  if (recent.length === FAILURE_STREAK && recent.every((s) => !s.ok)) {
    return 'offline';
  }
  const okSamples = samples.filter((s) => s.ok);
  if (okSamples.length === 0) {
    // No data yet: assume fast so first paint is not throttled.
    return samples.length === 0 ? 'fast' : 'offline';
  }
  const mean =
    okSamples.reduce((sum, s) => sum + s.durationMs, 0) / okSamples.length;
  return mean > SLOW_THRESHOLD_MS ? 'slow' : 'fast';
}

/** Record one HTTP request outcome. Called by the tRPC fetch wrapper. */
export function recordRequestSample(durationMs: number, ok: boolean): void {
  samples.push({ ok, durationMs });
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  const next = classify();
  if (next !== quality) {
    quality = next;
    listeners.forEach((l) => l());
  }
}

export function getConnectionQuality(): ConnectionQuality {
  return quality;
}

export function subscribeConnectionQuality(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: re-renders only when the classification changes. */
export function useConnectionQuality(): ConnectionQuality {
  return useSyncExternalStore(
    subscribeConnectionQuality,
    getConnectionQuality,
    () => 'fast' as ConnectionQuality,
  );
}

/**
 * Poll interval for a hot query given the current link quality.
 * Returns `false` (no polling) when offline.
 */
export function refetchIntervalFor(
  q: ConnectionQuality,
  opts: { fastMs?: number; slowMs?: number } = {},
): number | false {
  const { fastMs = 15_000, slowMs = 60_000 } = opts;
  if (q === 'offline') return false;
  return q === 'slow' ? slowMs : fastMs;
}
