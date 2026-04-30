"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Stage 11 segmented control — pill-shaped option group used in the
 * dashboard filter row (`All cases / Mine / Flagged`) and the table-vs-
 * board view toggle. Matches `app.css .seg`.
 *
 * Two modes:
 *   - `link` mode (default): each segment is a `<Link href>`. URL-state
 *     driven, server-rendered, no client JS for the navigation itself
 *     (the `"use client"` is only needed because Next's Link needs the
 *     client bundle for prefetch/hover behavior — using `<a>` would
 *     work too but loses prefetching).
 *   - `button` mode: each segment is a `<button onClick>` controlled
 *     by the caller. Used when state lives in component-local React
 *     (rare in this codebase — most filters are URL params).
 *
 * The `active` value is matched by `key`; segments without a matching
 * key all render in the inactive style.
 */

export type SegmentedOption = {
  key: string;
  label: string;
  /** For link mode: destination URL. Ignored in button mode. */
  href?: string;
  /** For button mode: click handler. Ignored in link mode. */
  onSelect?: () => void;
};

export type SegmentedProps = {
  options: ReadonlyArray<SegmentedOption>;
  /** Key of the currently-active option. */
  activeKey: string;
  /** Visual size — defaults to "sm" (matches the dashboard filter). */
  size?: "sm" | "md";
  /** ARIA label for the surrounding role="group". */
  ariaLabel?: string;
  className?: string;
};

export function Segmented(props: SegmentedProps): React.ReactElement {
  const sizeClass = props.size === "md" ? "text-xs px-3 py-1.5" : "text-[11px] px-2.5 py-1";
  return (
    <div
      role="group"
      aria-label={props.ariaLabel}
      className={cn(
        "inline-flex rounded-md border p-0.5",
        props.className,
      )}
      style={{
        borderColor: "var(--border, rgba(0,0,0,0.12))",
        background: "var(--surface, #fff)",
      }}
    >
      {props.options.map((opt) => {
        const active = opt.key === props.activeKey;
        const classes = cn(
          "rounded-sm font-medium transition",
          sizeClass,
          active
            ? "bg-[var(--ink)] text-[var(--cream)]"
            : "text-[var(--ink-muted)] hover:text-[var(--ink)]",
        );
        if (opt.href !== undefined) {
          return (
            <Link key={opt.key} href={opt.href} className={classes}>
              {opt.label}
            </Link>
          );
        }
        return (
          <button
            key={opt.key}
            type="button"
            onClick={opt.onSelect}
            className={classes}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
