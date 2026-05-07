import Link from "next/link";
import { APP_ROUTES } from "@/config";

/**
 * Stage 11 landing closer — dark band with the final CTA.
 * Mockup: `landing.html` `section.dark .cta-final` (l. 695–702).
 */
export function CloserSection(): React.ReactElement {
  return (
    <section
      className="px-6 py-24 text-center"
      style={{
        background: "var(--ink, #0B1221)",
        color: "var(--cream, #f5f1e8)",
      }}
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <h2
          className="text-3xl leading-tight sm:text-5xl"
          style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
        >
          Built for the solo
          <br />
          immigration attorney.
        </h2>
        <p
          className="text-base"
          style={{ color: "rgba(245,241,232,0.72)" }}
        >
          Apply for partnership today. We review applications within one
          business day.
        </p>
        <Link
          href={APP_ROUTES.apply}
          className="inline-block rounded-md bg-[var(--cream,_#f5f1e8)] px-6 py-3 text-sm font-medium"
          style={{ color: "var(--ink, #0B1221)" }}
        >
          Apply for partnership →
        </Link>
      </div>
    </section>
  );
}
