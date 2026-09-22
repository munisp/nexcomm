/**
 * NEXCOM — useWindowedList (PERF-CLIENT)
 * ─────────────────────────────────────────────────────────────────────────────
 * Tiny scroll-based windowing hook — no dependencies. Renders only the slice
 * of a long list that is near the viewport, plus `overscan` rows on each
 * side, using estimated-height spacers to preserve scrollbar geometry. Built
 * for lists of ~100+ heavy rows (deposit cards, receipt rows) where mounting
 * every row janks low-end Android devices on 3G.
 *
 * Scroll events are captured at the document level (capture phase) because
 * the app shell scrolls inside <main class="overflow-y-auto">, not on window
 * — a plain window scroll listener would never fire.
 *
 * Usage:
 *   const w = useWindowedList({ itemCount: rows.length, estimatedRowHeight: 118 });
 *   <div ref={w.containerRef}>
 *     {w.topSpacer > 0 && <div style={{ height: w.topSpacer }} aria-hidden />}
 *     {rows.slice(w.start, w.end).map(renderRow)}
 *     {w.bottomSpacer > 0 && <div style={{ height: w.bottomSpacer }} aria-hidden />}
 *   </div>
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface WindowedListOptions {
  itemCount: number;
  /** Average rendered row height in px — an estimate is fine. */
  estimatedRowHeight: number;
  /** Extra rows rendered above/below the viewport (default 5). */
  overscan?: number;
}

/** Rows painted before the first scroll measurement (initial viewport). */
const INITIAL_ROWS = 20;

export function useWindowedList({ itemCount, estimatedRowHeight, overscan = 5 }: WindowedListOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(itemCount, INITIAL_ROWS) });

  const update = useCallback(() => {
    const el = containerRef.current;
    if (!el || estimatedRowHeight <= 0) return;
    const top = el.getBoundingClientRect().top;
    const viewportH = window.innerHeight || 1;
    const firstVisible = Math.max(0, Math.floor(-top / estimatedRowHeight));
    const visibleCount = Math.ceil(viewportH / estimatedRowHeight) + 1;
    const start = Math.max(0, firstVisible - overscan);
    const end = Math.min(itemCount, firstVisible + visibleCount + overscan);
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [itemCount, estimatedRowHeight, overscan]);

  useEffect(() => {
    update();
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    // Capture phase: catches scrolls from nested scroll containers (Layout's
    // <main>) as well as window scrolls. Passive: never blocks scrolling.
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
    };
  }, [update]);

  return {
    containerRef,
    start: range.start,
    end: range.end,
    topSpacer: range.start * estimatedRowHeight,
    bottomSpacer: Math.max(0, itemCount - range.end) * estimatedRowHeight,
  };
}
