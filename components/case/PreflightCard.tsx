import { Card } from "@/components/ui";

/**
 * Stage 11 β package pre-flight card. Mockup `package.html` `.checks`
 * (l. 107-127). One row per gate from `case.preflight`; pass = green
 * dot + "Checked" pill, fail = warning dot + reason inline.
 *
 * The 4 gates we ship today (outputs approved / criteria threshold /
 * recommender letters / attorney bar standing) all have real data;
 * the other 8 gates the mockup shows ("I-129 form complete" etc.) are
 * deferred until their data lands. **No theatre rows.**
 */

export type PreflightGateView = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

export type PreflightCardProps = {
  allOk: boolean;
  gates: ReadonlyArray<PreflightGateView>;
};

export function PreflightCard(
  props: PreflightCardProps,
): React.ReactElement {
  const passCount = props.gates.filter((g) => g.ok).length;
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
            : `${passCount} of ${props.gates.length} passed`}
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
  return (
    <li className="flex items-baseline gap-3">
      <span
        aria-label={props.ok ? "Passed" : "Needs attention"}
        className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
        style={{
          background: props.ok
            ? "var(--success, #1f6b3d)"
            : "var(--warning, #b1830e)",
        }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{props.label}</p>
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
