import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";

export const metadata = { title: pageTitle("Dashboard") };

/**
 * Attorney dashboard — case list + new-case CTA.
 * Suspended / inactive accounts go straight to the error page (not via
 * onboarding) to avoid a two-hop redirect.
 */
export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const me = await api.me.current();
  if (!me) redirect(APP_ROUTES.authError + "?error=session-mismatch");

  const status = me.attorneyProfile?.status;
  if (status === "suspended" || status === "inactive") {
    redirect(APP_ROUTES.authError + `?error=${status}`);
  }
  if (status !== "active") redirect(APP_ROUTES.onboarding);

  const cases = await api.case.list({});

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 space-y-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-ink-muted)]">
            Dashboard
          </p>
          <h1
            className="mt-2 text-3xl tracking-tight"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {me.user.name ?? me.user.email}
          </h1>
        </div>
        <Link
          href={APP_ROUTES.newCase}
          className="rounded-md border border-[var(--color-ink)] bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-[var(--color-cream)]"
        >
          + New case
        </Link>
      </header>

      <section>
        <h2 className="text-sm uppercase tracking-wide text-[var(--color-ink-muted)]">
          Cases
        </h2>
        {cases.items.length === 0 ? (
          <p className="mt-3 rounded-md border border-[var(--color-ink)]/10 bg-white p-6 text-center text-sm text-[var(--color-ink-muted)]">
            No cases yet.{" "}
            <Link href={APP_ROUTES.newCase} className="underline">
              Open your first case
            </Link>
            .
          </p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
              <tr>
                <th className="pb-2 font-medium">Beneficiary</th>
                <th className="pb-2 font-medium">Visa</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {cases.items.map((c) => {
                const bene =
                  (c.beneficiaryData as { fullName?: string } | null) ?? {};
                return (
                  <tr
                    key={c.id}
                    className="border-t border-[var(--color-ink)]/10 hover:bg-[var(--color-ink)]/5"
                  >
                    <td className="py-3">
                      <Link
                        href={APP_ROUTES.case(c.id)}
                        className="underline-offset-2 hover:underline"
                      >
                        {bene.fullName ?? "Unnamed"}
                      </Link>
                    </td>
                    <td className="py-3 font-mono text-xs">{c.visaType}</td>
                    <td className="py-3 text-xs capitalize">
                      {c.status.replace(/_/g, " ")}
                    </td>
                    <td className="py-3 text-xs text-[var(--color-ink-muted)]">
                      {new Date(c.updatedAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <footer className="pt-6 border-t border-[var(--color-ink)]/10">
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: APP_ROUTES.home });
          }}
        >
          <button
            type="submit"
            className="text-xs text-[var(--color-ink-muted)] underline"
          >
            Sign out
          </button>
        </form>
      </footer>
    </main>
  );
}
