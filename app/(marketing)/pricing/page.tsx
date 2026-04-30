import Link from "next/link";
import { APP_ROUTES, pageTitle } from "@/config";
import { PartnershipSection, WaitlistSection } from "@/components/marketing";

export const metadata = { title: pageTitle("Pricing") };

/**
 * Stage 11 pricing page. Per Stage 04 spec, Docket has no per-seat
 * pricing — the partnership IS the price. This page is a focused
 * extract of the landing's Partnership section + the waitlist CTA,
 * with a short header.
 */
export default function PricingPage(): React.ReactElement {
  return (
    <>
      <header className="mx-auto max-w-3xl px-6 pb-4 pt-16 text-center">
        <p
          className="text-xs uppercase tracking-[0.3em]"
          style={{ color: "var(--ink-muted)" }}
        >
          Pricing
        </p>
        <h1
          className="mt-4 text-4xl tracking-tight sm:text-5xl"
          style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
        >
          A partnership, not a subscription.
        </h1>
        <p
          className="mt-4 text-base"
          style={{ color: "var(--ink-soft)" }}
        >
          You only pay Docket when you file. There are no seats, no monthly
          fees, no compute overage. The economics work for a single-case
          practice; they scale linearly to a hundred.
        </p>
        <div className="mt-6">
          <Link
            href={APP_ROUTES.login}
            className="inline-block rounded-md bg-[var(--ink)] px-5 py-2.5 text-sm font-medium text-[var(--cream)]"
          >
            Apply for partnership →
          </Link>
        </div>
      </header>

      <PartnershipSection />
      <WaitlistSection />
    </>
  );
}
