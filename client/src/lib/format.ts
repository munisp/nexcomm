/**
 * NEXCOM Exchange — shared formatting utilities (UX-FIX)
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for currency/date/number formatting. Nigerian market
 * defaults: NGN via Intl.NumberFormat("en-NG"), Africa/Lagos dates.
 */

const ngnFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

const ngnPreciseFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/** Format an amount in Naira (₦1,250,000). Accepts number | numeric string. */
export function formatNGN(value: number | string | null | undefined, opts?: { decimals?: boolean }): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return (opts?.decimals ? ngnPreciseFormatter : ngnFormatter).format(n);
}

/** Format an amount in its own currency (defaults to NGN for Nigerian symbols). */
export function formatMoney(
  value: number | string | null | undefined,
  currency: string = "NGN",
  opts?: { decimals?: boolean },
): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (currency.toUpperCase() === "USD") return usdFormatter.format(n);
  if (currency.toUpperCase() === "NGN") return (opts?.decimals ? ngnPreciseFormatter : ngnFormatter).format(n);
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString("en-NG")}`;
  }
}

/** Compact number for tickers/cards: 1.2K / 3.4M / 2.1B */
export function formatCompact(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-NG", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** Signed percentage: +2.35% / -1.10% */
export function formatPct(value: number | string | null | undefined, decimals = 2): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(decimals)}%`;
}

const LAGOS_TZ = "Africa/Lagos";

/** Date in Africa/Lagos: 22 Sep 2026 */
export function formatDate(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeZone: LAGOS_TZ }).format(d);
}

/** Date+time in Africa/Lagos: 22 Sep 2026, 14:32 */
export function formatDateTime(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: LAGOS_TZ }).format(d);
}

/** Relative time ("5 min ago") for notifications/timelines. */
export function formatRelativeTime(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const d = value instanceof Date ? value : new Date(value);
  const diffMs = d.getTime() - Date.now();
  const absSec = Math.round(Math.abs(diffMs) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en-NG", { numeric: "auto" });
  if (absSec < 60) return rtf.format(Math.round(diffMs / 1000), "second");
  if (absSec < 3600) return rtf.format(Math.round(diffMs / 60_000), "minute");
  if (absSec < 86400) return rtf.format(Math.round(diffMs / 3_600_000), "hour");
  return rtf.format(Math.round(diffMs / 86_400_000), "day");
}
