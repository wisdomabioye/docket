import { WaitlistForm } from "@/app/(marketing)/WaitlistForm";

/**
 * Stage 11 landing waitlist strip. Headline + body copy on the left,
 * the existing `WaitlistForm` (Stage 04) on the right.
 * Mockup: `landing.html` `section.waitlist` (l. 704–717).
 */
export function WaitlistSection(): React.ReactElement {
  return (
    <section
      className="border-t"
      id="waitlist"
      style={{
        borderColor: "var(--border, rgba(0,0,0,0.08))",
        background: "var(--surface, white)",
      }}
    >
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div className="max-w-xl">
          <h3
            className="text-2xl tracking-tight sm:text-3xl"
            style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
          >
            Or join the waitlist.
          </h3>
          <p
            className="mt-3 text-sm"
            style={{ color: "var(--ink-soft)" }}
          >
            Not ready to apply? We&rsquo;ll reach out when we open the next
            cohort.
          </p>
        </div>
        <WaitlistForm />
      </div>
    </section>
  );
}
