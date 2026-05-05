import { Card } from "@/components/ui";

/**
 * Stage 11 β package pre-flight card. Mockup `package.html` `.checks`
 * (l. 107-127). One row per gate from `case.preflight`.
 *
 * Two row kinds:
 *   - **Hard gate** — must pass for `allOk` to be true. Failure shows
 *     a warning dot.
 *   - **Advisory** — informational; surfaces state without blocking
 *     `allOk`. The signed-letter coverage row is advisory because the
 *     package PDF watermarks unsigned drafts rather than refusing to
 *     compile. Advisories render with a neutral/info dot when not yet
 *     met so they don't read as "failure."
 */

export type PreflightGateView = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  advisory?: boolean;
};

export type PreflightCardProps = {
  allOk: boolean;
  gates: ReadonlyArray<PreflightGateView>;
};

export function PreflightCard(
  props: PreflightCardProps,
): React.ReactElement {
  const hardGates = props.gates.filter((g) => !g.advisory);
  const passCount = hardGates.filter((g) => g.ok).length;
  return (
    <Card
      title="Pre-flight checks"
      meta={
        <span
          className="text-[11px]"
          style={{
            color: props.allOk
              ? "var(--success, #1f6b3d)"
              : "var(--warning, #b1830e)",
          }}
        >
          {props.allOk
            ? "All passed"
            : `${passCount} of ${hardGates.length} passed`}
        </span>
      }
    >
      <ul className="space-y-3">
        {props.gates.map((gate) => (
          <Row key={gate.id} {...gate} />
        ))}
      </ul>
    </Card>
  );
}

function Row(props: PreflightGateView): React.ReactElement {
  // Advisory rows with `ok: false` get the info tone — they're not
  // failures, just "still pending." Hard gates with `ok: false` get
  // the warning tone so they read as needing attention.
  const dotColor = props.ok
    ? "var(--success, #1f6b3d)"
    : props.advisory
      ? "var(--accent, #1F3D2F)"
      : "var(--warning, #b1830e)";
  const ariaLabel = props.ok
    ? "Passed"
    : props.advisory
      ? "Informational"
      : "Needs attention";
  return (
    <li className="flex items-baseline gap-3">
      <span
        aria-label={ariaLabel}
        className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ background: dotColor }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {props.label}
          {props.advisory ? (
            <span
              className="ml-2 rounded-sm px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider"
              style={{
                background: "var(--surface-sunken, rgba(0,0,0,0.06))",
                color: "var(--ink-muted)",
              }}
            >
              Advisory
            </span>
          ) : null}
        </p>
        <p
          className="mt-0.5 text-xs"
          style={{ color: "var(--ink-muted)" }}
        >
          {props.detail}
        </p>
      </div>
    </li>
  );
}
