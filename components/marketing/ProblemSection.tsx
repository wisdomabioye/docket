/**
 * Stage 11 landing "Problem" section. Mockup: `landing.html`
 * `section.alt` (l. 526–540).
 */
export function ProblemSection(): React.ReactElement {
  return (
    <section
      className="border-y"
      style={{
        background: "var(--surface, white)",
        borderColor: "var(--border, rgba(0,0,0,0.08))",
      }}
    >
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div>
          <p
            className="text-xs uppercase tracking-[0.3em]"
            style={{ color: "var(--ink-muted)" }}
          >
            The Problem
          </p>
          <h2
            className="mt-4 text-3xl leading-tight tracking-tight sm:text-4xl"
            style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
          >
            Solo attorneys leave money on the table every week.
          </h2>
          <p
            className="mt-4 text-base leading-relaxed"
            style={{ color: "var(--ink-soft)" }}
          >
            An O-1A petition takes 40 to 80 hours of paralegal and associate
            time. Most solo practitioners can only run two or three cases in
            parallel. The rest of the market — the high-margin, career-defining
            cases — goes to large firms with associate armies, or to templated
            mills that deliver second-rate work.
          </p>
        </div>

        <dl className="space-y-5">
          <StatRow
            number={
              <>
                40–80
                <span
                  className="ml-1 text-base font-normal"
                  style={{ color: "var(--ink-muted)" }}
                >
                  hrs
                </span>
              </>
            }
            label="per petition, paralegal + associate time at industry standard"
          />
          <StatRow
            number="$3.2–32k"
            label="of internal labor at standard hourly rates to prepare one case"
          />
          <StatRow
            number="2–3"
            label="maximum cases a solo attorney can run in parallel"
          />
        </dl>
      </div>
    </section>
  );
}

function StatRow(props: {
  number: React.ReactNode;
  label: string;
}): React.ReactElement {
  return (
    <div
      className="border-l-2 pl-5"
      style={{ borderColor: "var(--accent, var(--ink))" }}
    >
      <dt
        className="text-2xl tracking-tight sm:text-3xl"
        style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
      >
        {props.number}
      </dt>
      <dd className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
        {props.label}
      </dd>
    </div>
  );
}
