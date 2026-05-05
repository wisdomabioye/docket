import {
  CloserSection,
  FaqSection,
  Hero,
  HowItWorksSection,
  NumbersBand,
  OutputsSection,
  PartnershipSection,
  ProblemSection,
  WaitlistSection,
} from "@/components/marketing";

/**
 * Stage 11 landing page. Composes all eight mockup sections from
 * `components/marketing/*` so this page is a thin shell — every
 * section is independently testable and the page itself never
 * accumulates inline styling.
 *
 * Mockup: `Docket-Meridian-UI/hifi/landing.html` (779 lines).
 *
 * Page is wrapped by `app/(marketing)/layout.tsx` → `MarketingShell`,
 * which provides the sticky nav + footer.
 */
export default function HomePage(): React.ReactElement {
  return (
    <>
      <Hero />
      <ProblemSection />
      <HowItWorksSection />
      <OutputsSection />
      <NumbersBand />
      <PartnershipSection />
      <WaitlistSection />
      <FaqSection />
      <CloserSection />
    </>
  );
}
