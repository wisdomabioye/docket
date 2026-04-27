import { redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { TERMS_VERSION } from "@/server/auth/terms";
import { OnboardingForm } from "./OnboardingForm";

export const metadata = { title: pageTitle("Onboarding") };

/**
 * Attorney onboarding form. Submitted state → admin reviews → admin
 * activates → dashboard becomes the landing page.
 *
 * Once active, this page redirects to /dashboard.
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

  // Use the canonical "form was submitted" signal, not a derived field.
  const alreadySubmitted = Boolean(me.attorneyProfile?.submittedAt);

  return (
    <main className="mx-auto max-w-xl px-6 py-12 space-y-8">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-ink-muted)]">
          {alreadySubmitted ? "Review your details" : "Welcome"}
        </p>
        <h1
          className="mt-2 text-3xl tracking-tight"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {alreadySubmitted
            ? "Awaiting admin activation"
            : "Tell us about your practice"}
        </h1>
        <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
          {alreadySubmitted
            ? "Your details are with our team. We'll email you the moment your account is activated."
            : "We need bar credentials and your contractor agreement before you can start cases."}
        </p>
      </header>

      <OnboardingForm
        defaults={{
          barNumber: me.attorneyProfile?.barNumber ?? "",
          barStates: me.attorneyProfile?.barStates ?? [],
        }}
        termsVersion={TERMS_VERSION}
      />
    </main>
  );
}
