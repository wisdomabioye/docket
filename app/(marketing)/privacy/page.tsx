import { APP_INFO, pageTitle } from "@/config";

export const metadata = { title: pageTitle("Privacy policy") };

/**
 * Phase 1 placeholder. Founder action: replace with reviewed privacy
 * policy. See `0006_pii_comments.sql` for PII inventory query.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 space-y-4 text-sm leading-relaxed">
      <h1
        className="text-3xl tracking-tight"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Privacy policy
      </h1>
      <p className="text-sm text-[var(--color-ink-muted)]">
        v1 · last updated {new Date().toISOString().slice(0, 10)}
      </p>
      <p>
        {APP_INFO.name} stores attorney accounts (email, name, bar
        credentials), case beneficiary data uploaded by attorneys, and the
        documents + AI drafts generated for each case. We do not sell or
        share data with third parties beyond our service providers
        (hosting, AI inference, payments).
      </p>
      <h2 className="mt-8 text-lg font-medium">Data deletion</h2>
      <p>
        Email{" "}
        <a href={`mailto:${APP_INFO.supportEmail}`} className="underline">
          {APP_INFO.supportEmail}
        </a>{" "}
        to request data deletion. Self-serve deletion ships in a future
        release.
      </p>
      <h2 className="mt-8 text-lg font-medium">Sub-processors</h2>
      <p>
        Postgres hosting, Vercel (compute), Perplexity (AI inference),
        Postmark (email), Stripe (billing). Each processes data under their
        own published terms.
      </p>
    </main>
  );
}
