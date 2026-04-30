import { Card, EmptyState, ProgressBar, type ProgressTone } from "@/components/ui";
import type { CriterionStrength } from "@/lib/visa-criteria";

/**
 * Stage 11 β Evidence-strength card. Mockup `case-overview.html`
 * `.crit-row` (l. 138-178). Renders one row per criterion with the
 * criterion code, name, exhibit count, a thin progress bar tinted by
 * strength, and a strength label pill.
 *
 * Pure server component — no client state. Data shape matches
 * `computeCriteriaCoverage`'s `CoverageResult`.
 */

export type CriteriaCoverageCardProps = {
  visaType: string;
  visaSupported: boolean;
  rows: ReadonlyArray<{
    code: number;
    name: string;
    exhibitCount: number;
    strength: CriterionStrength;
  }>;
  metCount: number;
  /** Per-visa minimum criteria required to qualify (e.g. 3 for O-1A). */
  minRequired: number;
};

export function CriteriaCoverageCard(
  props: CriteriaCoverageCardProps,
): React.ReactElement {
  if (!props.visaSupported) {
    return (
      <Card title="Evidence strength">
        <EmptyState
          title={`Coverage analysis for ${props.visaType} ships in a future release.`}
          subtitle="O-1A is the only visa with a coverage taxonomy in Phase 1."
        />
      </Card>
    );
  }

  const total = props.rows.length;
  const meta = `${props.visaType} · ${total} criteria · ${props.metCount} met`;

  return (
    <Card
      title="Evidence strength"
      meta={
        <span>
          {meta}{" "}
          <span style={{ color: "var(--ink-muted)" }}>
            · needs ≥{props.minRequired} to qualify
          </span>
        </span>
      }
    >
      <ul className="space-y-3">
        {props.rows.map((row) => (
          <CriterionRow key={row.code} {...row} />
        ))}
      </ul>
    </Card>
  );
}

function CriterionRow(props: {
  code: number;
  name: string;
  exhibitCount: number;
  strength: CriterionStrength;
}): React.ReactElement {
  const tone = strengthToTone(props.strength);
  const percent = strengthToPercent(props.strength);
  return (
    <li
      className="grid items-center gap-3"
      style={{
        gridTemplateColumns: "24px minmax(0,1.4fr) minmax(120px,1fr) 80px",
      }}
    >
      <span
        className="mono text-[11px] uppercase tracking-wider"
        style={{ color: "var(--ink-muted)" }}
      >
        {props.code}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{props.name}</p>
        <p
          className="mt-0.5 text-[11px]"
          style={{ color: "var(--ink-muted)" }}
        >
          {props.exhibitCount === 0
            ? "0 exhibits · add required"
            : `${props.exhibitCount} exhibit${props.exhibitCount === 1 ? "" : "s"}`}
        </p>
      </div>
      <ProgressBar value={percent} tone={tone} />
      <span
        className="mono text-right text-[10px] uppercase tracking-wider"
        style={{ color: strengthToColor(props.strength) }}
      >
        {strengthToLabel(props.strength)}
      </span>
    </li>
  );
}

function strengthToTone(s: CriterionStrength): ProgressTone {
  switch (s) {
    case "strong":
      return "success";
    case "moderate":
      return "warning";
    case "weak":
      return "warning";
    case "none":
      return "error";
  }
}

function strengthToPercent(s: CriterionStrength): number {
  switch (s) {
    case "strong":
      return 90;
    case "moderate":
      return 60;
    case "weak":
      return 30;
    case "none":
      return 0;
  }
}

function strengthToLabel(s: CriterionStrength): string {
  switch (s) {
    case "strong":
      return "Strong";
    case "moderate":
      return "Moderate";
    case "weak":
      return "Weak";
    case "none":
      return "Not met";
  }
}

function strengthToColor(s: CriterionStrength): string {
  switch (s) {
    case "strong":
      return "var(--success, #1f6b3d)";
    case "moderate":
      return "var(--warning, #b1830e)";
    case "weak":
      return "var(--warning, #b1830e)";
    case "none":
      return "var(--ink-muted)";
  }
}
