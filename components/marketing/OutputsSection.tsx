/**
 * Stage 11 landing "Per case, Docket produces" section — six-card
 * grid of output types.
 * Mockup: `landing.html` `section.alt#output` (l. 590–625).
 */
export function OutputsSection(): React.ReactElement {
  return (
    <section
      className="border-y"
      style={{
        background: "var(--surface, white)",
        borderColor: "var(--border, rgba(0,0,0,0.08))",
      }}
    >
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <p
            className="text-xs uppercase tracking-[0.3em]"
            style={{ color: "var(--ink-muted)" }}
          >
            The Output
          </p>
          <h2
            className="mt-4 text-3xl leading-tight tracking-tight sm:text-4xl"
            style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
          >
            Per case, Docket&nbsp;produces:
          </h2>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {OUTPUTS.map((out) => (
            <Output key={out.title} {...out} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Output(props: {
  title: string;
  pages: string;
  body: string;
}): React.ReactElement {
  return (
    <article
      className="rounded-md border p-5"
      style={{
        background: "var(--surface-sunken, rgba(0,0,0,0.025))",
        borderColor: "var(--border, rgba(0,0,0,0.08))",
      }}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold">{props.title}</h3>
        <span
          className="mono text-[10px] uppercase tracking-wider"
          style={{ color: "var(--ink-muted)" }}
        >
          {props.pages}
        </span>
      </header>
      <p
        className="mt-2 text-sm leading-relaxed"
        style={{ color: "var(--ink-soft)" }}
      >
        {props.body}
      </p>
    </article>
  );
}

const OUTPUTS: ReadonlyArray<{ title: string; pages: string; body: string }> = [
  {
    title: "Evidence plan",
    pages: "3–6 pp",
    body: "Criterion-by-criterion mapping of exhibits with strength ratings and gap analysis. Your blueprint for the rest of the case.",
  },
  {
    title: "Personal statement",
    pages: "10–15 pp",
    body: "First-person narrative in the beneficiary's voice, anchored to specific exhibits. Signed declaration ready for notarization.",
  },
  {
    title: "Petition letter",
    pages: "15–25 pp",
    body: "Legal brief addressed to USCIS. Each criterion argued with evidence citations and controlling case law.",
  },
  {
    title: "Exhibit index",
    pages: "4–8 pp",
    body: "Numbered, tabbed exhibit list cross-referenced to every claim in the petition letter. Adjudicator-ready.",
  },
  {
    title: "Recommendation templates",
    pages: "2–3 pp ea.",
    body: "One tailored draft per recommender. Emailable, with redline instructions for the recommender to personalize.",
  },
  {
    title: "Cover & forms checklist",
    pages: "2 pp",
    body: "Form I-129 checklist, filing-fee summary, premium-processing flag, and the cover letter you send to USCIS.",
  },
];
