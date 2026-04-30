/**
 * Stage 11 landing dark numbers band. Three serif lines, the middle
 * one with an italic accent number. Mockup: `landing.html`
 * `section.dark.lg .num-stack` (l. 627–634).
 */
export function NumbersBand(): React.ReactElement {
  return (
    <section
      className="px-6 py-24 text-center"
      style={{
        background: "var(--ink, #0B1221)",
        color: "var(--cream, #f5f1e8)",
      }}
    >
      <div className="mx-auto max-w-4xl space-y-6">
        <Line>
          <em style={{ color: "var(--accent-ink, #A6C4AA)" }}>14 days,</em> not
          14 weeks.
        </Line>
        <Line>
          One attorney.{" "}
          <em style={{ color: "var(--accent-ink, #A6C4AA)" }}>Ten cases</em> a
          week.
        </Line>
        <Line size="sm">
          $3,200–$32,000 of paralegal work. Done for $0 upfront.
        </Line>
      </div>
    </section>
  );
}

function Line(props: {
  size?: "sm" | "lg";
  children: React.ReactNode;
}): React.ReactElement {
  const cls =
    props.size === "sm"
      ? "text-xl sm:text-2xl"
      : "text-3xl leading-tight sm:text-5xl";
  return (
    <p
      className={cls}
      style={{
        fontFamily: "var(--font-serif), Georgia, serif",
        fontStyle: props.size === "sm" ? "italic" : "normal",
      }}
    >
      {props.children}
    </p>
  );
}
