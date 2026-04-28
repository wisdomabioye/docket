import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";

/**
 * Single KPI tile. Mockup pattern: small uppercase label, large
 * number/value (serif for hero pages, mono for tabular density), optional
 * delta vs prior period, optional sparkline slot in the bottom-right.
 *
 * `value` is a string (already-formatted) so the component never decides
 * how to format currency/percent — that lives at the call site near the
 * data. Avoids a leaky `formatter` prop and keeps the type narrow.
 */

export type Delta = {
  /** Pre-formatted text, e.g. `+18.4%` or `+4 vs prior 7d` */
  text: string;
  direction: "up" | "down" | "flat";
};

export function KpiCard(props: {
  label: string;
  value: string;
  /** Render the value in muted color — use when `value` is a stand-in
   *  for missing data (e.g. `"$0"` or `"—"` before the source ledger
   *  has been populated). The number still shows; it just doesn't read
   *  as a real metric. */
  dim?: boolean;
  /** Optional small line under the value (e.g. "on track to $94k MTD"). */
  sub?: string;
  delta?: Delta;
  /** Sparkline / chart slot in the bottom-right. */
  chart?: ReactNode;
}): React.ReactElement {
  return (
    <div
      className="rounded-sm border p-4"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="eyebrow">{props.label}</p>
        {props.delta ? <DeltaPill delta={props.delta} /> : null}
      </div>
      <p
        className="mt-3 text-[28px] leading-none tracking-tight"
        style={{
          fontFamily: "var(--font-serif), Georgia, serif",
          color: props.dim ? "var(--ink-faint)" : "var(--ink)",
        }}
      >
        {props.value}
      </p>
      {props.sub ? (
        <p className="mt-1.5 text-xs text-[var(--ink-muted)]">{props.sub}</p>
      ) : null}
      {props.chart ? <div className="mt-3">{props.chart}</div> : null}
    </div>
  );
}

function DeltaPill({ delta }: { delta: Delta }) {
  const color =
    delta.direction === "up"
      ? "var(--success)"
      : delta.direction === "down"
        ? "var(--error)"
        : "var(--ink-muted)";
  const iconName: IconName | null =
    delta.direction === "up"
      ? "trending-up"
      : delta.direction === "down"
        ? "trending-down"
        : null;
  return (
    <span
      className="mono inline-flex items-center gap-1 text-[11px] font-medium"
      style={{ color }}
      aria-label={`${delta.direction} ${delta.text}`}
    >
      {iconName ? <Icon name={iconName} size={12} /> : null}
      {delta.text}
    </span>
  );
}
