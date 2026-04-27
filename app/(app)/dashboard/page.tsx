import { redirect } from "next/navigation";
import { auth, signOut } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";

export const metadata = { title: pageTitle("Dashboard") };

/**
 * Phase 1 placeholder. Stage 05 replaces this with the real dashboard.
 * Right now it proves the entire stack works end-to-end:
 *   Auth.js session → proxy lets it through → RSC tRPC caller →
 *   protected procedure → RLS-engaged query → returns the user's profile.
 */
export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const me = await api.me.current();
  if (!me) redirect(APP_ROUTES.authError + "?error=session-mismatch");

  // Treat null profile the same as pending — both mean "not yet activated."
  const needsOnboarding =
    !me.attorneyProfile || me.attorneyProfile.status !== "active";

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 space-y-8">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-ink-muted)]">
          Dashboard
        </p>
        <h1
          className="mt-2 text-4xl tracking-tight"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Welcome, {me.user.name ?? me.user.email}
        </h1>
      </header>

      {needsOnboarding && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Your attorney profile is pending admin activation. We&rsquo;ll email
          you when you&rsquo;re cleared to start cases.
        </p>
      )}

      <section className="space-y-2 text-sm">
        <h2 className="text-base font-medium">Account</h2>
        <dl className="grid grid-cols-[12rem_1fr] gap-y-1 text-[var(--color-ink-muted)]">
          <dt>Email</dt>
          <dd className="text-[var(--color-ink)]">{me.user.email}</dd>
          <dt>Roles</dt>
          <dd className="text-[var(--color-ink)]">
            {me.roles.join(", ") || "—"}
          </dd>
          <dt>Organizations</dt>
          <dd className="text-[var(--color-ink)]">
            {me.memberships
              .map((m) => `${m.organizationName} (${m.role})`)
              .join(", ") || "—"}
          </dd>
        </dl>
      </section>

      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: APP_ROUTES.home });
        }}
      >
        <button
          type="submit"
          className="rounded-md border border-[var(--color-ink)] px-4 py-2 text-sm"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
