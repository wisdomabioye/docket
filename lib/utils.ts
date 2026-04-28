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
  return d.toLocaleDateString();
}
