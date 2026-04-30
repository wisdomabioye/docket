import type { ReactNode } from "react";
import { cn, formatNumber } from "@/lib/utils";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageLink } from "./PageLink";

/**
 * Generic admin table chrome. Pure RSC: pagination is rendered as `Link`s
 * that mutate URL search params, so no client interactivity is needed for
 * the basic browse. Pages add filtering UI via the separate `Filters`
 * component above the table.
 *
 * The render contract is intentionally narrow:
 *   - `columns` declares header cells + per-column alignment/style hints
 *   - `rows` is the data array
 *   - `renderCell(row, col)` returns the cell's React content
 *
 * This keeps DataTable agnostic to the row shape (no generic gymnastics
 * leaking into JSX) while staying type-safe at the call site.
 */

export type ColumnAlign = "left" | "right";

/** Hide a column at viewports BELOW the breakpoint. `sm` = hide on phones,
 * `md` = hide on phones + small tablets, `lg` = show only on desktops.
 * Pages mark non-essential columns so dense admin tables stay readable on
 * smaller screens without forcing horizontal scroll. */
export type ColumnHideBelow = "sm" | "md" | "lg";

export type Column<TKey extends string = string> = {
  key: TKey;
  label: string;
  align?: ColumnAlign;
  /** Apply tabular-mono font (numbers, IDs, hashes). */
  mono?: boolean;
  /** Hide this column on screens narrower than the breakpoint. */
  hideBelow?: ColumnHideBelow;
  /** Column-specific class on both header + cells (e.g. width hint). */
  className?: string;
};

const HIDE_CLASS: Record<ColumnHideBelow, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

export type Pagination = {
  /** Total row count if known. Pass undefined to suppress "OF n". */
  total?: number;
  /** Range string: "1–10". Pass undefined to suppress "SHOWING …". */
  range?: string;
  /** URLs for prev/next pages; undefined disables that side. */
  prevHref?: string;
  nextHref?: string;
};

export function DataTable<TRow>(props: {
  columns: readonly Column[];
  rows: readonly TRow[];
  renderCell: (row: TRow, col: Column, rowIndex: number) => ReactNode;
  /** Stable React key for each row. */
  rowKey: (row: TRow, rowIndex: number) => string;
  /** Highlight a row, e.g. flagged for risk. Returns variant tone. */
  rowTone?: (row: TRow) => "warning" | "error" | undefined;
  pagination?: Pagination;
  /** Empty-state used when `rows.length === 0`. */
  empty?: { title: string; subtitle?: string };
}): React.ReactElement {
  if (props.rows.length === 0) {
    const emptyTitle = props.empty?.title ?? "Nothing to show yet.";
    const emptySub = props.empty?.subtitle;
    return (
      <EmptyState
        title={emptyTitle}
        {...(emptySub ? { subtitle: emptySub } : {})}
      />
    );
  }

  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[640px] text-sm sm:min-w-0">
        <thead>
          <tr
            className="text-left text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            {props.columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "px-4 py-2.5",
                  col.align === "right" && "text-right",
                  col.hideBelow && HIDE_CLASS[col.hideBelow],
                  col.className,
                )}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, i) => {
            const tone = props.rowTone?.(row);
            return (
              <tr
                key={props.rowKey(row, i)}
                className="border-b last:border-b-0 hover:bg-[var(--surface-sunken)]"
                style={{
                  borderColor: "var(--border)",
                  background:
                    tone === "warning"
                      ? "var(--warning-soft)"
                      : tone === "error"
                        ? "var(--error-soft)"
                        : undefined,
                }}
              >
                {props.columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "px-4 py-3 align-middle",
                      col.align === "right" && "text-right",
                      col.mono && "mono",
                      col.hideBelow && HIDE_CLASS[col.hideBelow],
                      col.className,
                    )}
                  >
                    {props.renderCell(row, col, i)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      {props.pagination ? <PaginationFooter {...props.pagination} /> : null}
    </div>
  );
}

function PaginationFooter(p: Pagination): React.ReactElement {
  const summary =
    p.range && p.total !== undefined
      ? `Showing ${p.range} of ${formatNumber(p.total)}`
      : p.range
        ? `Showing ${p.range}`
        : p.total !== undefined
          ? `${formatNumber(p.total)} results`
          : null;

  return (
    <div
      className="flex items-center justify-between px-4 py-2.5 text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]"
      style={{ borderTop: "1px solid var(--border)" }}
    >
      <span>{summary}</span>
      <span className="flex items-center gap-2">
        <PageLink {...(p.prevHref ? { href: p.prevHref } : {})} label="← Prev" />
        <PageLink {...(p.nextHref ? { href: p.nextHref } : {})} label="Next →" />
      </span>
    </div>
  );
}

