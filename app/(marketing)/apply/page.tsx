import { pageTitle } from "@/config";
import { AttorneyApplyForm } from "@/app/(marketing)/AttorneyApplyForm";

export const metadata = { title: pageTitle("Apply for partnership") };

/**
 * Public attorney-partnership application. Posts via the same
 * `marketing.joinWaitlist` mutation as `WaitlistForm`, with
 * `kind: "attorney"` so the structured firm/bar payload lands in
 * `waitlist_entries.details`.
 */
export default function ApplyPage(): React.ReactElement {
  return (
    <main className="mx-auto max-w-2xl px-6 pb-24 pt-16">
      <p
        className="text-xs uppercase tracking-[0.3em]"
        style={{ color: "var(--ink-muted)" }}
      >
        Apply for partnership
      </p>
      <h1
        className="mt-4 text-4xl tracking-tight"
        style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
      >
        Become a partner attorney.
      </h1>
      <p className="mt-4 text-base" style={{ color: "var(--ink-soft)" }}>
        Tell us about your practice. We review applications within one business
        day; approved attorneys get a sign-in email and onboarding next steps.
      </p>
      <div className="mt-8">
        <AttorneyApplyForm />
      </div>
    </main>
  );
}
