import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { CaseHeader, CaseHeaderActions } from "@/components/case";
import { OutputCard } from "@/components/output";
import { EmptyState } from "@/components/ui";
import { Filters, type Chip } from "@/components/table";
import { deriveCaseStage } from "@/lib/case-stage";
import { OutputsAutoRefresh } from "./OutputsAutoRefresh";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ filter?: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return { title: pageTitle(`Outputs · ${id.slice(0, 4)}`) };
}

/**
 * Stage 08 + Stage 11 α outputs grid.
 *
 * Lists every current output (one per `(output_type, subgroup)` bucket)
 * for a case as a card grid. Each card links to the per-output detail
 * page. Empty state when no outputs exist.
 *
 * Stage 11 α additions:
 *   - Wrapped in `CaseHeader` so the case-tab strip + status badge
 *     match every other case page.
 *   - URL-state sub-filter chips (`?filter=all|review|approved`) so
 *     the attorney can scope the grid to "things needing review" or
 *     "already-approved" without leaving the page. Mirrors mockup
 *     `outputs.html .tabs` (l. 21-29) — `Exhibits` / `Forms` deferred
 *     until those output types ship.
 */

const FILTER_KEYS = ["all", "review", "approved"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

function parseFilter(value: unknown): FilterKey {
  if (typeof value !== "string") return "all";
  return (FILTER_KEYS as ReadonlyArray<string>).includes(value)
    ? (value as FilterKey)
    : "all";
}

export default async function OutputsPage({
  params,
  searchParams,
}: Props): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const activeFilter = parseFilter(sp.filter);

  const caseRow = await api.case.get({ caseId: id });
  if (!caseRow) notFound();

  const outputs = await api.output.list({ caseId: id });
  const beneficiary =
    (caseRow.beneficiaryData as {
      fullName?: string;
      nationality?: string;
    } | null) ?? {};
  const meta = beneficiary.nationality ? beneficiary.nationality : undefined;

  const approvedCount = outputs.filter((o) => o.attorneyApproved).length;
  const reviewCount = outputs.length - approvedCount;
  const totalCount = outputs.length;

  // Apply the chip filter. Defined here (not in the tRPC procedure) so
  // an empty filter result still renders the chip strip + the case
  // header — the user can switch chips without re-fetching the case.
  const filtered = outputs.filter((o) => {
    if (activeFilter === "approved") return o.attorneyApproved;
    if (activeFilter === "review") return !o.attorneyApproved;
    return true;
  });

  const chips: Chip[] = [
    {
      label: `All (${totalCount})`,
      href: APP_ROUTES.caseOutputs(id),
      active: activeFilter === "all",
    },
    {
      label: `Needs review (${reviewCount})`,
      href: `${APP_ROUTES.caseOutputs(id)}?filter=review`,
      active: activeFilter === "review",
    },
    {
      label: `Approved (${approvedCount})`,
      href: `${APP_ROUTES.caseOutputs(id)}?filter=approved`,
      active: activeFilter === "approved",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <CaseHeader
        caseId={caseRow.id}
        beneficiaryName={beneficiary.fullName ?? "Unnamed beneficiary"}
        visaType={caseRow.visaType}
        {...(meta ? { meta } : {})}
        status={caseRow.status}
        stage={deriveCaseStage({
          status: caseRow.status,
          // Reuse the counts already computed for the chip strip —
          // no extra round-trip.
          approvals: { approved: approvedCount, total: totalCount },
        })}
        current="outputs"
        actions={
          <CaseHeaderActions caseId={caseRow.id} status={caseRow.status} />
        }
      />

      <OutputsAutoRefresh
        caseId={caseRow.id}
        initialStatus={caseRow.status}
        initialOutputCount={outputs.length}
      />

      <header>
        <p
          className="text-xs uppercase tracking-[0.3em]"
          style={{ color: "var(--ink-muted)" }}
        >
          Outputs
        </p>
        <h2
          className="mt-2 text-2xl tracking-tight"
          style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
        >
          Drafts &amp; review
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>
          {totalCount > 0
            ? `${totalCount} output${totalCount === 1 ? "" : "s"} · ${approvedCount} approved · ${reviewCount} awaiting review`
            : caseRow.status === "building"
              ? "Build in progress — drafts will appear here as Computer finishes each one."
              : "No outputs yet — kick off a build to draft this case."}
        </p>
      </header>

      {totalCount > 0 ? <Filters chips={chips} /> : null}

      {totalCount === 0 ? (
        caseRow.status === "building" ? (
          <EmptyState
            title="Building drafts…"
            subtitle="Computer is generating the petition letter, personal statement, evidence plan, and exhibit index. Drafts will appear here as soon as each one is ready — usually within a few minutes."
          />
        ) : (
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
        )
      ) : filtered.length === 0 ? (
        <EmptyState
          title={
            activeFilter === "approved"
              ? "Nothing approved yet"
              : "Nothing awaiting review"
          }
          subtitle={
            activeFilter === "approved"
              ? "Approve drafts on the All tab to fill this list."
              : "All current drafts are approved."
          }
        />
      ) : (
        <section className="grid gap-3.5 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item, idx) => (
            <OutputCard
              key={item.id}
              caseId={id}
              item={item}
              sequence={idx + 1}
            />
          ))}
        </section>
      )}
    </div>
  );
}
