import type { ReactNode } from "react";

/**
 * Stage 11 dashboard greeting band — time-of-day greeting + contextual
 * stat sentence + actions slot. Mockup `dashboard.html .dash-greet`
 * (l. 199–209).
 *
 * `greetingFor(date)` is exported separately so the storybook + tests
 * can render deterministically without stubbing the clock.
 */
export type GreetingBandProps = {
  name: string;
  /** Sentence-case stat fragments rendered in the sub-line. Up to 3
   *  recommended; anything longer wraps. */
  stats?: ReadonlyArray<{ label: ReactNode; tone?: "neutral" | "alert" }>;
  /** Right-aligned actions (CTAs). */
  actions?: ReactNode;
  /** Override the greeting word (testing). Defaults to the local-time-
   *  derived greeting. */
  greetingOverride?: string;
};

export function GreetingBand(
  props: GreetingBandProps,
): React.ReactElement {
  const greeting = props.greetingOverride ?? greetingFor(new Date());
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1
          className="text-2xl tracking-tight sm:text-[28px]"
          style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
        >
          {greeting}, {props.name}
        </h1>
        {props.stats && props.stats.length > 0 ? (
          <p
            className="mt-1 text-sm"
            style={{ color: "var(--ink-muted)" }}
          >
            You have{" "}
            {props.stats.map((stat, idx) => (
              <span key={idx}>
                {idx > 0 ? " and " : null}
                <span
                  style={{
                    color:
                      stat.tone === "alert"
                        ? "var(--error, var(--ink))"
                        : "var(--ink)",
                    fontWeight: 600,
                  }}
                >
                  {stat.label}
                </span>
              </span>
            ))}
            .
          </p>
        ) : null}
      </div>
      {props.actions ? (
        <div className="flex shrink-0 items-center gap-2">{props.actions}</div>
      ) : null}
    </header>
  );
}

/** Returns "Good morning" / "Good afternoon" / "Good evening" based on
 *  the supplied date's local hour. Exported so callers can bypass live
 *  clock for deterministic tests. */
export function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
