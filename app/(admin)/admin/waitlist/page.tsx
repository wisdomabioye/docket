import { redirect } from "next/navigation";
import Link from "next/link";
import { TRPCError } from "@trpc/server";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { ApproveButton } from "./ApproveButton";

export const metadata = { title: pageTitle("Waitlist") };

/**
 * Waitlist + invite gate. Approving a row lets that email complete OAuth
 * sign-in. Rows stay listed even after approval so admins can audit who
 * approved whom and when.
 */
export default async function AdminWaitlistPage() {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  let entries: Awaited<ReturnType<typeof api.admin.listWaitlist>>;
  try {
    entries = await api.admin.listWaitlist();
  } catch (err) {
    if (err instanceof TRPCError && err.code === "FORBIDDEN") {
      redirect(APP_ROUTES.dashboard);
    }
    throw err;
  }

  const pendingCount = entries.filter((e) => !e.approvedAt).length;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 space-y-8">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-ink-muted)]">
          Admin
        </p>
        <h1
          className="mt-2 text-3xl tracking-tight"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Waitlist
        </h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          {entries.length === 0
            ? "Nobody on the waitlist yet."
            : `${entries.length} total · ${pendingCount} awaiting approval.`}
        </p>
        <nav className="mt-4 flex gap-4 text-xs">
          <Link
            href={APP_ROUTES.adminAttorneys}
            className="text-[var(--color-ink-muted)] underline"
          >
            Pending attorneys →
          </Link>
        </nav>
      </header>

      {entries.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
            <tr>
              <th className="pb-2 font-medium">Email</th>
              <th className="pb-2 font-medium">Name</th>
              <th className="pb-2 font-medium">Source</th>
              <th className="pb-2 font-medium">Joined</th>
              <th className="pb-2 font-medium">Approved</th>
              <th className="pb-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-[var(--color-ink)]/10">
                <td className="py-3 font-mono text-xs">{e.email}</td>
                <td className="py-3 text-xs">{e.name ?? "—"}</td>
                <td className="py-3 text-xs">{e.source ?? "—"}</td>
                <td className="py-3 text-xs text-[var(--color-ink-muted)]">
                  {new Date(e.createdAt).toLocaleDateString()}
                </td>
                <td className="py-3 text-xs">
                  {e.approvedAt ? (
                    <span>
                      {new Date(e.approvedAt).toLocaleDateString()}
                      {e.approvedByEmail ? (
                        <span className="ml-1 text-[var(--color-ink-muted)]">
                          by {e.approvedByEmail}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-[var(--color-ink-muted)]">—</span>
                  )}
                </td>
                <td className="py-3 text-right">
                  {e.approvedAt ? null : <ApproveButton entryId={e.id} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
