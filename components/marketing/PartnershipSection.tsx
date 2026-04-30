/**
 * Stage 11 landing "Partnership" section — 3-card explainer for the
 * 85/15 split + $0 upfront + attorney-of-record positioning.
 * Mockup: `landing.html` `section#partnership` (l. 636–663).
 */
export function PartnershipSection(): React.ReactElement {
  return (
    <section
      className="mx-auto max-w-6xl scroll-mt-16 px-6 py-20"
      id="partnership"
    >
      <div className="max-w-2xl">
        <p
          className="text-xs uppercase tracking-[0.3em]"
          style={{ color: "var(--ink-muted)" }}
        >
          The Partnership
        </p>
        <h2
          className="mt-4 text-3xl leading-tight tracking-tight sm:text-4xl"
          style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
        >
          How the partnership works.
        </h2>
        <p
          className="mt-3 text-base leading-relaxed"
          style={{ color: "var(--ink-soft)" }}
        >
          Docket is a partnership, not a subscription. We only make money when
          you file. You stay attorney of record. You keep the client
          relationship.
        </p>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-3">
        <Pillar
          big={
            <>
              85
              <span
                className="text-2xl"
                style={{ color: "var(--ink-muted)" }}
              >
                /15
              </span>
            </>
          }
          title="You keep 85% of every case fee."
          body="Standard O-1A fee is $6,000. Your share is $5,100. Docket's share is $900 — charged only on filing, never on drafts."
        />
        <Pillar
          big="$0"
          title="No upfront fees. Ever."
          body="No seats, no subscriptions, no compute bills. You pay Docket when you file, and only when you file. The economics work for a one-case practice."
        />
        <Pillar
          big={
            <>
              Your
              <br />
              <span style={{ color: "var(--ink-muted)" }}>name</span>
            </>
          }
          title="You stay attorney of record."
          body="Every filing goes out under your bar number and your letterhead. Docket is invisible to your client, to USCIS, and to opposing counsel."
        />
      </div>
    </section>
  );
}

function Pillar(props: {
  big: React.ReactNode;
  title: string;
  body: string;
}): React.ReactElement {
  return (
    <article
      className="rounded-md border p-6"
      style={{
        background: "var(--surface, white)",
        borderColor: "var(--border, rgba(0,0,0,0.08))",
      }}
    >
      <div
        className="text-5xl leading-none tracking-tight"
        style={{
          fontFamily: "var(--font-serif), Georgia, serif",
          color: "var(--accent, var(--ink))",
        }}
      >
        {props.big}
      </div>
      <h3 className="mt-5 text-base font-semibold">{props.title}</h3>
      <p
        className="mt-2 text-sm leading-relaxed"
        style={{ color: "var(--ink-soft)" }}
      >
        {props.body}
      </p>
    </article>
  );
}
