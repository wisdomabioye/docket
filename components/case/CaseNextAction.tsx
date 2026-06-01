import Link from "next/link";
import { Card } from "@/components/ui";
import type { CaseGuidance } from "@/server/services/cases/guidance";

/**
 * The unified "what to do next + what's blocking it" surface (Stage 13).
 * ONE presentational component, two layouts:
 *   - `variant="card"` — the rich Overview Action Card.
 *   - `variant="bar"`  — the slim header bar shown under the stage rail
 *     on every case tab.
 *
 * Fed by `getCaseGuidance` (server) or `case.guidance` (client) — it
 * renders the resolved `primary` / `blockers` / `progress`; it does NOT
 * derive anything. `import type` keeps the server-only guidance module
 * out of any client bundle this is compiled into.
 *
 * The four states it renders (driven by `guidance.primary` + blockers):
 *   1. actionable   — enabled primary CTA, no blockers.
 *   2. blocked-fix  — primary already retargeted to the fix action
 *                     (enabled), blockers listed.
 *   3. wait-only    — primary disabled, "waiting on…" from the blockers.
 *   4. in-progress / terminal — no primary; show stage + progress.
 */

export type CaseNextActionProps = {
  guidance: CaseGuidance;
  variant: "card" | "bar";
};

export function CaseNextAction(
  props: CaseNextActionProps,
): React.ReactElement {
  return props.variant === "bar" ? (
    <NextActionBar guidance={props.guidance} />
  ) : (
    <NextActionCard guidance={props.guidance} />
  );
}

function NextActionBar(props: {
  guidance: CaseGuidance;
}): React.ReactElement {
  const { primary, blockers, stage, progress } = props.guidance;

  // In-progress / terminal: no primary — surface the stage label.
  if (!primary) {
    return (
      <div
        className="mt-3 flex items-center gap-2 text-[11px]"
        data-component="case-next-action-bar"
      >
        <span
          className="mono uppercase tracking-wider"
          style={{ color: "var(--ink-muted)" }}
        >
          {progress.indeterminate ? "In progress" : "Next"}
        </span>
        <span style={{ color: "var(--ink-muted)" }}>{stage.sub}</span>
      </div>
    );
  }

  const waitingOn = blockers.find((b) => b.resolveHref === null);

  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"
      data-component="case-next-action-bar"
    >
      <span
        className="mono uppercase tracking-wider"
        style={{ color: "var(--ink-muted)" }}
      >
        Next
      </span>
      {primary.enabled ? (
        <Link
          href={primary.href}
          className="font-medium underline-offset-2 hover:underline"
          style={{ color: "var(--accent, var(--ink))" }}
        >
          {primary.label} →
        </Link>
      ) : (
        <>
          <span style={{ color: "var(--ink-muted)" }}>{primary.label}</span>
          {waitingOn ? (
            <span style={{ color: "var(--ink-muted)" }}>
              · waiting on {waitingOn.label}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}

function NextActionCard(props: {
  guidance: CaseGuidance;
}): React.ReactElement {
  const { primary, blockers, stage, progress } = props.guidance;

  return (
    <Card title="Next action">
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
            {stage.label}
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>
            {stage.sub}
          </p>
        </div>

        {progress.indeterminate ? (
          <div
            className="h-1 w-full overflow-hidden rounded-full"
            style={{ background: "var(--surface-sunken, rgba(0,0,0,0.06))" }}
            aria-hidden="true"
          >
            <span
              className="block h-full w-1/3 animate-pulse rounded-full"
              style={{ background: "var(--ink)" }}
            />
          </div>
        ) : null}

        {blockers.length > 0 ? (
          <ul className="space-y-2">
            {blockers.map((b, idx) => (
              <li
                key={`${idx}-${b.label}`}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <span style={{ color: "var(--ink-soft, var(--ink))" }}>
                  {b.label}
                </span>
                {b.resolveHref ? (
                  <Link
                    href={b.resolveHref}
                    className="mono shrink-0 text-[11px] uppercase tracking-wider underline-offset-2 hover:underline"
                    style={{ color: "var(--accent, var(--ink))" }}
                  >
                    Fix →
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {primary ? (
          primary.enabled ? (
            <Link
              href={primary.href}
              className="inline-flex w-full items-center justify-center rounded-md border px-3 py-2 text-sm font-medium sm:w-auto"
              style={{
                borderColor: "var(--ink)",
                background: "var(--ink)",
                color: "var(--cream)",
              }}
            >
              {primary.label} →
            </Link>
          ) : (
            // Disabled: render a non-interactive element (not a <Link>) so
            // it's genuinely unreachable by mouse AND keyboard — `aria-
            // disabled` + pointer-events alone leave a navigable anchor.
            <span
              role="button"
              aria-disabled="true"
              className="inline-flex w-full cursor-not-allowed items-center justify-center rounded-md border px-3 py-2 text-sm font-medium sm:w-auto"
              style={{
                borderColor: "var(--border)",
                background: "var(--surface)",
                color: "var(--ink-muted)",
              }}
            >
              {primary.label} →
            </span>
          )
        ) : null}
      </div>
    </Card>
  );
}
