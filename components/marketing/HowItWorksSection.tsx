/**
 * Stage 11 landing "How it works" section — three-step grid.
 * Mockup: `landing.html` `section#how` (l. 542–588).
 *
 * Anchor `id="how"` so the in-nav link + hero "See how it works" jump
 * here.
 */
export function HowItWorksSection(): React.ReactElement {
  return (
    <section className="mx-auto max-w-6xl scroll-mt-16 px-6 py-20" id="how">
      <div className="max-w-2xl">
        <p
          className="text-xs uppercase tracking-[0.3em]"
          style={{ color: "var(--ink-muted)" }}
        >
          The Workflow
        </p>
        <h2
          className="mt-4 text-3xl leading-tight tracking-tight sm:text-4xl"
          style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
        >
          Three steps. One&nbsp;hour.
        </h2>
        <p
          className="mt-3 text-base leading-relaxed"
          style={{ color: "var(--ink-soft)" }}
        >
          You&rsquo;re the principal. Docket is the associate. You provide the
          inputs and the judgment. We handle the draft.
        </p>
      </div>

      <ol className="mt-12 grid gap-6 lg:grid-cols-3">
        <Step
          n="01"
          eyebrow="Intake"
          title="Enter beneficiary information."
          body="Guided intake for the beneficiary's background, criteria narrative, recommenders, and filing target. 30 minutes, auto-saving as you go."
          tickets={[
            { mark: "✓", label: "Personal & professional" },
            { mark: "✓", label: "Criteria narrative" },
            { mark: "·", label: "Recommenders · 6 added" },
            { mark: "·", label: "Additional context" },
          ]}
        />
        <Step
          n="02"
          eyebrow="Evidence"
          title="Upload evidence & letters."
          body="Drag-and-drop PDFs, Word docs, emails. Docket reads each file, maps it to the right criterion, and flags gaps before you're surprised by them."
          tickets={[
            { mark: "✓", label: "dissertation.pdf → Crit 4" },
            { mark: "✓", label: "nsf_award.pdf → Crit 1" },
            { mark: "·", label: "rec_smith.docx · OCR" },
          ]}
        />
        <Step
          n="03"
          eyebrow="Review"
          title="Receive a filing-ready package."
          body="Evidence plan, personal statement, petition letter, exhibit index, and recommendation templates. Edit inline, approve, download. Attorney of record: you."
          tickets={[
            { mark: "✓", label: "Personal statement · 12 pp" },
            { mark: "✓", label: "Petition letter · 18 pp" },
            { mark: "✓", label: "Exhibit index · 6 pp" },
          ]}
        />
      </ol>
    </section>
  );
}

function Step(props: {
  n: string;
  eyebrow: string;
  title: string;
  body: string;
  tickets: ReadonlyArray<{ mark: string; label: string }>;
}): React.ReactElement {
  return (
    <li
      className="rounded-md border p-6"
      style={{
        background: "var(--surface, white)",
        borderColor: "var(--border, rgba(0,0,0,0.08))",
      }}
    >
      <p
        className="mono text-[10px] uppercase tracking-wider"
        style={{ color: "var(--accent, var(--ink-muted))" }}
      >
        {props.n} · {props.eyebrow}
      </p>
      <h3
        className="mt-2 text-xl tracking-tight"
        style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
      >
        {props.title}
      </h3>
      <p
        className="mt-2 text-sm leading-relaxed"
        style={{ color: "var(--ink-soft)" }}
      >
        {props.body}
      </p>
      <div
        className="mono mt-5 space-y-1.5 rounded-sm border p-3 text-[11px]"
        style={{
          background: "var(--surface-sunken, rgba(0,0,0,0.04))",
          borderColor: "var(--border, rgba(0,0,0,0.08))",
          color: "var(--ink-soft)",
        }}
      >
        {props.tickets.map((t, idx) => (
          <div key={idx} className="flex items-baseline gap-2">
            <span style={{ color: "var(--ink-muted)" }}>{t.mark}</span>
            <span>{t.label}</span>
          </div>
        ))}
      </div>
    </li>
  );
}
