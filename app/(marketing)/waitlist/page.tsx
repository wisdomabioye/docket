import { pageTitle } from "@/config";
import { WaitlistForm } from "@/app/(marketing)/WaitlistForm";

export const metadata = { title: pageTitle("Join the waitlist") };

/**
 * Stage 11 standalone waitlist page — fallback URL for cold-email
 * outreach where a deep-link to the landing's waitlist anchor is too
 * fragile. Same form, more focused chrome.
 */
export default function WaitlistPage(): React.ReactElement {
  return (
    <main className="mx-auto max-w-2xl px-6 pb-24 pt-16">
      <p
        className="text-xs uppercase tracking-[0.3em]"
        style={{ color: "var(--ink-muted)" }}
      >
        Join the waitlist
      </p>
      <h1
        className="mt-4 text-4xl tracking-tight"
        style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
      >
        We&rsquo;ll reach out as spots open.
      </h1>
      <p className="mt-4 text-base" style={{ color: "var(--ink-soft)" }}>
        Drop your email and we&rsquo;ll let you know when the next cohort opens.
        Solo immigration attorneys only, for now.
      </p>
      <div className="mt-8">
        <WaitlistForm />
      </div>
    </main>
  );
}
