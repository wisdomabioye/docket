import { redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { TERMS_VERSION } from "@/server/auth/terms";
import {
  CONTRACTOR_AGREEMENT_BODY,
  CONTRACTOR_AGREEMENT_HASH,
  CONTRACTOR_AGREEMENT_TITLE,
  CONTRACTOR_AGREEMENT_VERSION,
} from "@/server/auth/contractor-agreement";
import { mdToSafeHtml } from "@/lib/markdown";
import { OnboardingForm } from "./OnboardingForm";
import { SignAgreementStep } from "./SignAgreementStep";

export const metadata = { title: pageTitle("Onboarding") };

/**
 * Attorney onboarding. Two-step flow:
 *
 *   Step 1 — read & e-sign the contractor agreement (rendered via
 *            `<SignAgreementStep>`).
 *   Step 2 — bar credentials + ToS acceptance (rendered via
 *            `<OnboardingForm>`).
 *
 * The server picks which step to render based on whether an active
 * contractor signature already exists for the user. This keeps the
 * resume-on-reload behavior server-authoritative — no client state
 * decides which step is current.
 *
 * Once the attorney profile is `active`, the page redirects to
 * `/dashboard`; suspended users go to the auth-error page.
 */
export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const me = await api.me.current();
  if (!me) redirect(APP_ROUTES.authError + "?error=session-mismatch");

  if (me.attorneyProfile?.status === "active") {
    redirect(APP_ROUTES.dashboard);
  }
  if (me.attorneyProfile?.status === "suspended") {
    redirect(APP_ROUTES.authError + "?error=suspended");
  }

  const signature = await api.signature.getMyContractorSignature();

  // Use the canonical "form was submitted" signal, not a derived field.
  const alreadySubmitted = Boolean(me.attorneyProfile?.submittedAt);

  return (
    <main className="mx-auto max-w-xl px-6 py-12 space-y-8">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-ink-muted)]">
          {alreadySubmitted
            ? "Review your details"
            : signature
              ? "Step 2 of 2"
              : "Step 1 of 2"}
        </p>
        <h1
          className="mt-2 text-3xl tracking-tight"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {alreadySubmitted
            ? "Awaiting admin activation"
            : signature
              ? "Tell us about your practice"
              : "Sign the contractor agreement"}
        </h1>
        <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
          {alreadySubmitted
            ? "Your details are with our team. We'll email you the moment your account is activated."
            : signature
              ? "We need your bar credentials before you can start cases."
              : "Read the agreement below and sign it electronically. We'll capture your bar credentials next."}
        </p>
      </header>

      {signature ? (
        <OnboardingForm
          defaults={{
            barNumber: me.attorneyProfile?.barNumber ?? "",
            barStates: me.attorneyProfile?.barStates ?? [],
          }}
          termsVersion={TERMS_VERSION}
          signature={{
            id: signature.id,
            signedAt: signature.signedAt.toISOString(),
            documentVersion: signature.documentVersion,
          }}
        />
      ) : (
        <SignAgreementStep
          title={CONTRACTOR_AGREEMENT_TITLE}
          // Server-side markdown → sanitized HTML so the on-screen
          // reader matches what the user actually agreed to. The
          // canonical signed form is still the markdown bytes whose
          // sha256 is `CONTRACTOR_AGREEMENT_HASH` — HTML is just
          // presentation.
          bodyHtml={mdToSafeHtml(CONTRACTOR_AGREEMENT_BODY)}
          documentVersion={CONTRACTOR_AGREEMENT_VERSION}
          contentHash={CONTRACTOR_AGREEMENT_HASH}
        />
      )}
    </main>
  );
}
