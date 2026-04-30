import { redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { NewCaseForm } from "./NewCaseForm";

export const metadata = { title: pageTitle("New case") };

/**
 * Create-case form. Redirect to the new case's intake page on success.
 */
export default async function NewCasePage() {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const me = await api.me.current();
  if (!me) redirect(APP_ROUTES.authError + "?error=session-mismatch");
  if (me.attorneyProfile?.status !== "active") {
    redirect(APP_ROUTES.onboarding);
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-12 space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-ink-muted)]">
          New case
        </p>
        <h1
          className="mt-2 text-3xl tracking-tight"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Open a case file
        </h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          You can fill in beneficiary details on the next screen.
        </p>
      </header>
      <NewCaseForm />
    </main>
  );
}
