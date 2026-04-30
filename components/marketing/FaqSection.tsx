/**
 * Stage 11 landing FAQ section. Native `<details>`/`<summary>` so the
 * accordion works without JS — accessibility freebie + RSC-friendly.
 * Mockup: `landing.html` `section.alt#faq` (l. 665–693).
 *
 * Q&A copy hardcoded per current marketing voice; future polish can
 * source from a CMS / MDX file.
 */
export function FaqSection(): React.ReactElement {
  return (
    <section
      className="scroll-mt-16 border-y"
      id="faq"
      style={{
        background: "var(--surface, white)",
        borderColor: "var(--border, rgba(0,0,0,0.08))",
      }}
    >
      <div className="mx-auto max-w-3xl px-6 py-20">
        <p
          className="text-xs uppercase tracking-[0.3em]"
          style={{ color: "var(--ink-muted)" }}
        >
          Common Questions
        </p>
        <h2
          className="mt-4 text-3xl leading-tight tracking-tight sm:text-4xl"
          style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
        >
          Things attorneys ask.
        </h2>
        <div className="mt-10 space-y-3">
          {QA.map((qa) => (
            <FaqItem key={qa.q} q={qa.q} a={qa.a} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqItem(props: { q: string; a: string }): React.ReactElement {
  return (
    <details
      className="group rounded-md border p-5"
      style={{
        background: "var(--surface-sunken, rgba(0,0,0,0.025))",
        borderColor: "var(--border, rgba(0,0,0,0.08))",
      }}
    >
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 text-sm font-medium">
        <span>{props.q}</span>
        <span
          aria-hidden="true"
          className="text-lg transition-transform group-open:rotate-45"
          style={{ color: "var(--ink-muted)" }}
        >
          +
        </span>
      </summary>
      <p
        className="mt-3 text-sm leading-relaxed"
        style={{ color: "var(--ink-soft)" }}
      >
        {props.a}
      </p>
    </details>
  );
}

const QA: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: "Who actually owns the work product?",
    a: "You do. Every output is drafted for your review, filed under your bar number, and covered by your attorney-client privilege with the beneficiary. Docket is a tool, not counsel.",
  },
  {
    q: "What happens if USCIS issues an RFE?",
    a: "Docket regenerates targeted response drafts against the specific RFE questions, using the original evidence corpus plus any new documents you upload. RFE responses are included in the base 15% — no additional fee.",
  },
  {
    q: "How is the AI trained — on my client data?",
    a: "No. We use foundation models via their enterprise APIs, with zero-retention agreements in place. Your beneficiary data is never used to train our models or any third-party model. Full data-handling policy on request.",
  },
  {
    q: "What visa categories are supported?",
    a: "O-1A and EB-1A are generally available. O-1B, EB-1B, EB-1C, and EB-2 NIW are in closed beta with a waitlist. H-1B, L-1, and family-based categories are not on the near-term roadmap.",
  },
  {
    q: "Can I white-label Docket for my firm?",
    a: "Docket already runs invisibly — every document goes out on your letterhead. A firm-branded client portal is on the roadmap for Q3 2026. Contact us if you'd like early access.",
  },
];
