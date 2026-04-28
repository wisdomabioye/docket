import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Filter chip strip. Each chip is a `Link` (RSC-friendly) that swaps URL
 * search params; the consuming page reads params and computes which chip
 * is `active`. Right-aligned slot for the result count or extra controls.
 *
 * Why Link not button: page-level filtering is server-driven (URL state),
 * so chips need to navigate, not flip client state. Keeps everything RSC.
 */

export type Chip = {
  label: string;
  /** Pre-formatted count, e.g. "(147)". Optional. */
  count?: string | number;
  href: string;
  active?: boolean;
};

export function Filters(props: {
  chips: readonly Chip[];
  /** Slot for "147 results" or sort dropdown. */
  right?: ReactNode;
}): React.ReactElement {
  return (
    <div
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-sm border px-3 py-2"
      style={{
        background: "var(--surface)",
        borderColor: "var(--border)",
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {props.chips.map((chip) => {
          const inner = (
            <>
              {chip.label}
              {chip.count !== undefined ? (
                <span className="ml-1 text-[10px] opacity-70">{chip.count}</span>
              ) : null}
            </>
          );
          // Active chip: render as `<span>` with `aria-current="page"`.
          // Skips the no-op nav (no need to round-trip when you're
          // already on the page) and signals state to assistive tech.
          if (chip.active) {
            return (
              <span
                key={chip.href}
                aria-current="page"
                className="rounded-sm border border-[var(--accent)] bg-[var(--accent-soft)] px-2.5 py-1 text-xs text-[var(--accent)]"
              >
                {inner}
              </span>
            );
          }
          return (
            <Link
              key={chip.href}
              href={chip.href}
              className={cn(
                "rounded-sm border px-2.5 py-1 text-xs transition",
                "border-[var(--border)] text-[var(--ink-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--ink)]",
              )}
            >
              {inner}
            </Link>
          );
        })}
      </div>
      {props.right ? (
        <div className="text-xs text-[var(--ink-muted)]">{props.right}</div>
      ) : null}
    </div>
  );
}
