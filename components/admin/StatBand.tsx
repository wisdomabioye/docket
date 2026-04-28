import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Horizontal strip of clickable stat cells. Used on `/admin/cases` as the
 * stage breakdown ("All · Intake · Documents · Drafting · Review · Filed")
 * and could host any "click me to filter" segmented summary.
 *
 * Responsive: 2 cols on phones, 3 on tablets, full N on `lg+`. The full
 * count is variable per page, so it's set via a `--stat-cols` CSS var and
 * applied through a Tailwind 4 arbitrary property.
 *
 * Cell dividers: a 1px gap (`gap-px`) + an outer surface color reveals
 * the border between cells — works at any column count and any wrap
 * point without `nth-child` math.
 *
 * Cell highlighting follows the same `active` pattern as `Filters.chips`,
 * so the URL-state-driven approach is consistent.
 */

export type StatCell = {
  label: string;
  /** Pre-formatted, e.g. `"892"` or `"+18 this week"`. */
  value: string;
  sub?: string;
  href?: string;
  active?: boolean;
};

export function StatBand(props: {
  cells: readonly StatCell[];
}): React.ReactElement {
  const fullCols = props.cells.length;

  return (
    <div
      className={cn(
        "mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-sm border sm:grid-cols-3",
        "lg:[grid-template-columns:repeat(var(--stat-cols),minmax(0,1fr))]",
      )}
      style={{
        ["--stat-cols" as string]: String(fullCols),
        background: "var(--border)",
        borderColor: "var(--border)",
      }}
    >
      {props.cells.map((cell) => {
        const inner = (
          <div
            className={cn(
              "h-full bg-[var(--surface)] px-3 py-2.5",
              cell.active && "border-t-2 border-t-[var(--accent)]",
            )}
          >
            <p className="eyebrow truncate">{cell.label}</p>
            <p
              className={cn(
                "mt-1 text-xl tracking-tight",
                cell.active && "text-[var(--accent)]",
              )}
              style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
            >
              {cell.value}
            </p>
            {cell.sub ? (
              <p className="mt-0.5 truncate text-[10px] text-[var(--ink-muted)]">
                {cell.sub}
              </p>
            ) : null}
          </div>
        );
        return cell.href ? (
          <Link
            key={cell.label}
            href={cell.href}
            className="block transition hover:bg-[var(--surface-sunken)]"
          >
            {inner}
          </Link>
        ) : (
          <div key={cell.label}>{inner}</div>
        );
      })}
    </div>
  );
}
