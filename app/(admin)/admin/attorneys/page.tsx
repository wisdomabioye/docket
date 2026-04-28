import { redirect } from "next/navigation";
import Link from "next/link";
import { TRPCError } from "@trpc/server";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { ActivateButton } from "./ActivateButton";

export const metadata = { title: pageTitle("Pending attorneys") };

/**
 * Stage 03 minimum admin view: list pending attorneys + one-click activate.
 * Stage 09 expands into the polished `/admin/*` dashboard suite.
 */
export default async function AdminAttorneysPage() {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  // FORBIDDEN → not an admin, bounce to dashboard. Anything else (DB
  // error, network blip) propagates so we don't silently swallow it.
  let pending: Awaited<
    ReturnType<typeof api.admin.listPendingAttorneys>
  >;
  try {
    pending = await api.admin.listPendingAttorneys();
  } catch (err) {
    if (err instanceof TRPCError && err.code === "FORBIDDEN") {
      redirect(APP_ROUTES.dashboard);
    }
    throw err;
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 space-y-8">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-ink-muted)]">
          Admin
        </p>
        <h1
          className="mt-2 text-3xl tracking-tight"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Pending attorneys
        </h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          {pending.length === 0
            ? "Nobody waiting."
            : `${pending.length} awaiting activation.`}
        </p>
        <nav className="mt-4 flex gap-4 text-xs">
          <Link
            href={APP_ROUTES.adminWaitlist}
            className="text-[var(--color-ink-muted)] underline"
          >
            ← Waitlist
          </Link>
        </nav>
      </header>

      {pending.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
            <tr>
              <th className="pb-2 font-medium">Name</th>
              <th className="pb-2 font-medium">Bar #</th>
              <th className="pb-2 font-medium">States</th>
              <th className="pb-2 font-medium">Submitted</th>
              <th className="pb-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {pending.map((p) => (
              <tr key={p.userId} className="border-t border-[var(--color-ink)]/10">
                <td className="py-3">
                  <div>{p.name ?? "—"}</div>
                  <div className="text-xs text-[var(--color-ink-muted)]">
                    {p.email}
                  </div>
                </td>
                <td className="py-3 font-mono text-xs">{p.barNumber ?? "—"}</td>
                <td className="py-3 text-xs">
                  {p.barStates.join(", ") || "—"}
                </td>
                <td className="py-3 text-xs">
                  {p.submittedAt
                    ? new Date(p.submittedAt).toLocaleDateString()
                    : "—"}
                </td>
                <td className="py-3 text-right">
                  <ActivateButton userId={p.userId} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
