import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { RevenueCard } from "@/components/revenue/RevenueCard";
import { AppPageHeader, SignOutForm } from "@/components/layout";
import { PendingApprovalCard } from "@/components/onboarding";

export const metadata = { title: pageTitle("Dashboard") };

/**
 * Attorney dashboard — case list + new-case CTA.
 *
 * Status routing per Stage 03:
 *   - no profile yet            → redirect to /onboarding
 *   - status='pending'          → render PendingApprovalCard inline (NOT redirect)
 *   - status∈{suspended,inactive} → redirect to /auth/error
 *   - status='active'           → render the case list
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
  if (!me.attorneyProfile) redirect(APP_ROUTES.onboarding);
  if (status === "pending") {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12 space-y-8">
        <AppPageHeader
          eyebrow="Dashboard"
          title={me.user.name ?? me.user.email}
        />
        <PendingApprovalCard
          email={me.user.email}
          submittedAt={me.attorneyProfile.submittedAt}
        />
        <footer className="pt-6 border-t border-[var(--color-ink)]/10">
          <SignOutForm />
        </footer>
      </main>
    );
  }
  if (status !== "active") redirect(APP_ROUTES.onboarding);

  const cases = await api.case.list({});
  const approvals =
    cases.items.length === 0
      ? ({} as Record<string, { approved: number; total: number }>)
      : await api.output.summarize({
          caseIds: cases.items.map((c) => c.id),
        });

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 space-y-8">
      <AppPageHeader
        eyebrow="Dashboard"
        title={me.user.name ?? me.user.email}
        actions={
          <Link
            href={APP_ROUTES.newCase}
            className="rounded-md border border-[var(--color-ink)] bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-[var(--color-cream)]"
          >
            + New case
          </Link>
        }
      />

      <RevenueCard />

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
                <th className="pb-2 font-medium">Outputs</th>
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
                    <td className="py-3 text-xs">
                      {(() => {
                        const tally = approvals[c.id];
                        if (!tally || tally.total === 0) {
                          return (
                            <span className="text-[var(--color-ink-muted)]">
                              —
                            </span>
                          );
                        }
                        return (
                          <span
                            className="font-mono"
                            style={{
                              color:
                                tally.approved === tally.total
                                  ? "var(--success, var(--color-ink))"
                                  : "var(--color-ink)",
                            }}
                          >
                            {tally.approved} of {tally.total}
                          </span>
                        );
                      })()}
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
        <SignOutForm />
      </footer>
    </main>
  );
}
