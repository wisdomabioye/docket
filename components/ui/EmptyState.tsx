import type { ReactNode } from "react";

/**
 * Zero-data placeholder. Used by `DataTable` automatically when rows are
 * empty, and any page section whose data depends on a Stage 07/10 feature
 * that hasn't shipped (revenue, compute spend, etc.).
 *
 * Tone: subtitle "Awaiting first filing" / "No cases yet" — never bare
 * `—`. The mockups assume populated data; we soften the empty case so an
 * empty admin DB doesn't look broken.
 */

export function EmptyState(props: {
  title: string;
  subtitle?: string;
  cta?: ReactNode;
}): React.ReactElement {
  return (
    <div
      className="rounded-sm border border-dashed px-6 py-10 text-center"
      style={{
        borderColor: "var(--border-strong)",
        background: "var(--surface-sunken)",
      }}
    >
      <p className="text-sm font-medium">{props.title}</p>
      {props.subtitle ? (
        <p className="mt-1 text-xs text-[var(--ink-muted)]">{props.subtitle}</p>
      ) : null}
      {props.cta ? <div className="mt-4">{props.cta}</div> : null}
    </div>
  );
}
