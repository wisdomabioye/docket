import { APP_INFO, pageTitle } from "@/config";

export const metadata = { title: pageTitle("Terms of service") };

/**
 * Phase 1 placeholder. Founder action: replace with reviewed legal copy
 * before launch. See `docs/decisions.md` for compliance review status.
 */
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 space-y-4 text-sm leading-relaxed">
      <h1
        className="text-3xl tracking-tight"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Terms of service
      </h1>
      <p className="text-sm text-[var(--color-ink-muted)]">
        v1 · last updated {new Date().toISOString().slice(0, 10)}
      </p>
      <p>
        These terms govern your use of {APP_INFO.name}. Placeholder copy —
        legal review pending. Contact{" "}
        <a href={`mailto:${APP_INFO.supportEmail}`} className="underline">
          {APP_INFO.supportEmail}
        </a>{" "}
        with questions.
      </p>
      <h2 className="mt-8 text-lg font-medium">Account</h2>
      <p>
        You must be a U.S.-licensed immigration attorney in good standing to
        use this service.
      </p>
      <h2 className="mt-8 text-lg font-medium">Revenue split</h2>
      <p>
        85% to attorney, 15% to {APP_INFO.name}. Billed monthly per case.
      </p>
      <h2 className="mt-8 text-lg font-medium">Liability</h2>
      <p>
        AI-generated drafts are not legal advice. Attorney is responsible for
        review and filing.
      </p>
    </main>
  );
}
