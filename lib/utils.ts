import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names. Resolves conflicting utilities (e.g.
 * `cn("px-2", "px-4")` → `"px-4"`). Use everywhere instead of template
 * strings.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Format integer cents as USD currency: `0n` → `"$0"`, `2350n` → `"$23.50"`,
 * `100000n` → `"$1,000"`. Drops the cents suffix when the amount is a
 * whole-dollar value to keep dashboard KPIs scannable. Pass `withCents:true`
 * to force `.00` on whole values (line items, accounting tables).
 */
export function formatCents(
  cents: bigint | number | null | undefined,
  opts?: { withCents?: boolean },
): string {
  if (cents === null || cents === undefined) return "—";
  const value = typeof cents === "bigint" ? Number(cents) : cents;
  const dollars = value / 100;
  const fractionDigits =
    opts?.withCents || value % 100 !== 0 ? 2 : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(dollars);
}

/**
 * Format a date as a short relative label suitable for admin tables and
 * audit rows: `"2m ago"`, `"4h ago"`, `"3d ago"`, then absolute date for
 * anything older than a week.
 *
 * Locale pinned to `en-US` on the absolute fallback so SSR + browser
 * agree (the relative branches are language-agnostic). Note: `Date.now()`
 * still differs by milliseconds between server and client, so a value
 * straddling a "minute ago" boundary can briefly mismatch — accepted
 * trade-off; relative time is inherently approximate.
 */
export function formatRelative(input: Date | string | null): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatDate(d);
}

/**
 * Format an absolute date as `"Apr 30, 2026"` (default) or `"Apr 30"`
 * (when `style: "compact"`). Locale pinned to `en-US` so the SSR + the
 * browser produce the same string (the runtime default differs across
 * Node and the browser → hydration mismatch).
 */
export function formatDate(
  input: Date | string | null,
  opts?: { style?: "default" | "compact" | "full" },
): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  const style = opts?.style ?? "default";
  if (style === "compact") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (style === "full") {
    return d.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Pin number formatting to `en-US` so the thousands separator matches
 *  across SSR + browser (no `1.000` vs `1,000` hydration drift). */
export function formatNumber(
  n: number | bigint | null | undefined,
): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

/**
 * Today's date as a `yyyy-mm-dd` string in the browser's local
 * timezone. Used to seed `DateInput`'s `min`/`max` bounds (e.g. DOB
 * `max=today`, filing date `min=today`). Local-time on purpose — the
 * native `<input type="date">` wire format is local-date semantics
 * (it has no time-of-day or zone), so calling sites should match.
 *
 * Don't call this on the server during render: it's now-dependent and
 * causes hydration drift. DateInput is a `"use client"` component, so
 * call from there or from another client effect.
 */
export function isoToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * `isoToday()` offset by `years` years. Negative for past, positive
 * for future. Returns a `yyyy-mm-dd` string. Handles month-end
 * edge cases via the JS `Date` constructor's overflow rules.
 */
const BYTES_PER_MB = 1024 * 1024;

/**
 * Bytes → megabytes, one decimal, as a string ("48.2"). Accepts bigint
 * (DB `bigint` columns) or number. Number division is safe — the
 * per-case storage cap (≤500 MB) is far below 2^53.
 */
export function formatMb(bytes: bigint | number): string {
  const mb = Number(bytes) / BYTES_PER_MB;
  return (Math.round(mb * 10) / 10).toFixed(1);
}

export function isoOffsetYears(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
