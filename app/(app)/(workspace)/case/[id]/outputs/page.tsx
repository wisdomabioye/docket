import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { OutputCard } from "@/components/output";
import { EmptyState } from "@/components/ui";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return { title: pageTitle(`Outputs · ${id.slice(0, 8)}`) };
}

/**
 * Stage 08 outputs grid. Lists every current output (one per
 * `(output_type, subgroup)` bucket) for a case as a card grid. Each
 * card links to the per-output detail page. Empty state when no
 * outputs exist (case hasn't been built yet → CTA back to the build
 * page from Stage 07).
 *
 * Slim projection — `output.list` returns metadata only (no `content`
 * payload). The card renders content-length from the SQL-side count.
 */
export default async function OutputsPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const { id } = await params;
  const caseRow = await api.case.get({ caseId: id });
  if (!caseRow) notFound();

  const outputs = await api.output.list({ caseId: id });
  const beneficiary = (caseRow.beneficiaryData as
    | { fullName?: string }
    | null) ?? {};

  const approvedCount = outputs.filter((o) => o.attorneyApproved).length;
  const totalCount = outputs.length;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10 space-y-8">
      <header>
        <p
          className="text-xs uppercase tracking-[0.3em]"
          style={{ color: "var(--ink-muted)" }}
        >
          Case · {caseRow.visaType}
        </p>
        <h1
          className="mt-2 text-2xl tracking-tight"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Outputs · {beneficiary.fullName ?? "Unnamed beneficiary"}
        </h1>
        <p
          className="mt-2 text-sm"
          style={{ color: "var(--ink-muted)" }}
        >
          {totalCount > 0
            ? `${totalCount} output${totalCount === 1 ? "" : "s"} · ${approvedCount} approved`
            : "No outputs yet — kick off a build to draft this case."}
        </p>
      </header>

      {totalCount > 0 && approvedCount > 0 ? (
        <div className="flex justify-end">
          <Link
            href={APP_ROUTES.casePackage(id)}
            className="rounded-sm border px-4 py-2 text-sm font-medium"
            style={{
              borderColor: "var(--border-strong)",
              background: "var(--ink)",
              color: "var(--white)",
            }}
          >
            Package for filing →
          </Link>
        </div>
      ) : null}

      {outputs.length === 0 ? (
        <EmptyState
          title="No outputs drafted yet"
          subtitle="Run a build to generate the petition letter, personal statement, evidence plan, and exhibit index."
          cta={
            <Link
              href={APP_ROUTES.caseBuild(id)}
              className="rounded-sm border px-4 py-2 text-sm font-medium"
              style={{ borderColor: "var(--border-strong)" }}
            >
              Go to build →
            </Link>
          }
        />
      ) : (
        <section
          className="grid gap-3.5 md:grid-cols-2 lg:grid-cols-3"
        >
          {outputs.map((item, idx) => (
            <OutputCard
              key={item.id}
              caseId={id}
              item={item}
              sequence={idx + 1}
            />
          ))}
        </section>
      )}
    </main>
  );
}
