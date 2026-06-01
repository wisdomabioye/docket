import type { ReactElement } from "react";

/**
 * Bundle-stats cluster for the Outputs header (Stage 13 / #72). Mockup
 * `outputs.html .bundle-stats` — big serif number + mono label per stat.
 *
 * Generic over the stat list so the page composes only data it actually
 * has (output/approved/awaiting counts + criteria met/total). The mockup
 * also shows "Pages total / Exhibits cited / Readiness" — omitted on
 * purpose: page count needs PDF pagination, exhibits-cited needs citation
 * parsing, and readiness has no scoring methodology. We don't fabricate.
 */

export type BundleStat = { value: string | number; label: string };

export type BundleStatsProps = {
  items: ReadonlyArray<BundleStat>;
};

export function BundleStats(props: BundleStatsProps): ReactElement {
  return (
    <div
      className="mt-4 flex flex-wrap gap-x-8 gap-y-3"
      data-component="bundle-stats"
    >
      {props.items.map((s) => (
        <div key={s.label}>
          <div
            className="text-[26px] leading-none tracking-tight"
            style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
          >
            {s.value}
          </div>
          <div
            className="mono mt-1 text-[10px] uppercase tracking-wider"
            style={{ color: "var(--ink-muted)" }}
          >
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}
