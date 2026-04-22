/**
 * NEXCOM Exchange — Reusable Skeleton Components
 * Provides consistent loading states across all pages.
 * Usage:
 *   <PageSkeleton />                     — full page with header + 3 stat cards + table
 *   <TableSkeleton rows={8} cols={5} />  — table-only skeleton
 *   <CardGridSkeleton cards={6} />       — grid of stat cards
 *   <StatCardSkeleton />                 — single stat card
 *   <ChartSkeleton />                    — chart placeholder
 *   <FormSkeleton fields={4} />          — form fields
 */
import { Skeleton } from "@/components/ui/skeleton";

// ─── Stat Card ────────────────────────────────────────────────────────────────
export function StatCardSkeleton() {
  return (
    <div className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-7 rounded-lg" />
      </div>
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

// ─── Card Grid ────────────────────────────────────────────────────────────────
export function CardGridSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className={`grid grid-cols-2 md:grid-cols-${Math.min(cards, 4)} gap-4`}>
      {Array.from({ length: cards }).map((_, i) => (
        <StatCardSkeleton key={i} />
      ))}
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────
export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      {/* Header */}
      <div className="bg-muted/30 px-4 py-3 flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-3 flex gap-4 border-t border-border/30">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton
              key={j}
              className="h-4 flex-1"
              style={{ opacity: 1 - i * 0.06 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Chart ────────────────────────────────────────────────────────────────────
export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div
      className="rounded-lg border border-border/50 bg-card/30 flex flex-col gap-2 p-4"
      style={{ height }}
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-6 w-20 rounded-md" />
      </div>
      <div className="flex-1 flex items-end gap-1 pt-2">
        {Array.from({ length: 20 }).map((_, i) => (
          <Skeleton
            key={i}
            className="flex-1 rounded-sm"
            style={{ height: `${20 + Math.sin(i * 0.8) * 30 + Math.random() * 20}%` }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Form ─────────────────────────────────────────────────────────────────────
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      ))}
      <Skeleton className="h-10 w-28 rounded-md mt-2" />
    </div>
  );
}

// ─── List Item ────────────────────────────────────────────────────────────────
export function ListItemSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border/30">
          <Skeleton className="h-9 w-9 rounded-lg flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

// ─── Full Page ────────────────────────────────────────────────────────────────
export function PageSkeleton({
  cards = 4,
  tableRows = 8,
  tableCols = 5,
  showChart = false,
}: {
  cards?: number;
  tableRows?: number;
  tableCols?: number;
  showChart?: boolean;
}) {
  return (
    <div className="container py-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
      </div>

      {/* Stat cards */}
      <div className={`grid grid-cols-2 md:grid-cols-${Math.min(cards, 4)} gap-4`}>
        {Array.from({ length: cards }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>

      {/* Optional chart */}
      {showChart && <ChartSkeleton height={220} />}

      {/* Table */}
      <TableSkeleton rows={tableRows} cols={tableCols} />
    </div>
  );
}

export default PageSkeleton;
