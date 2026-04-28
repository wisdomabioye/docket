import Link from "next/link";
import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatBand, type StatCell } from "@/components/admin/StatBand";
import { Badge } from "@/components/ui";
import { DataTable, type Column } from "@/components/table";
import { CASE_STATUSES, type CaseStatus } from "@/lib/case-status";
import { VISA_TYPES, type VisaType } from "@/lib/constants";
import { formatCents } from "@/lib/utils";

export const metadata = { title: pageTitle("All cases") };

// Stat-band groupings for the cases page. Statuses typed against
// `CaseStatus` so a typo or removed enum value fails typecheck. The
// `filter` field maps to a single canonical CaseStatus URL param —
// clicking the cell narrows the table to that status.
const STAT_GROUPS: ReadonlyArray<{
  label: string;
  statuses: readonly CaseStatus[];
  filter?: CaseStatus;
}> = [
  { label: "All", statuses: [] },
  {
    label: "Intake",
    statuses: ["intake", "documents_pending"],
    filter: "intake",
  },
  { label: "Extracting", statuses: ["extracting"], filter: "extracting" },
  {
    label: "Drafting",
    statuses: ["ready_to_build", "building", "build_failed", "draft_ready"],
    filter: "building",
  },
  {
    label: "Review",
    statuses: ["in_review", "needs_revision", "approved", "package_ready"],
    filter: "in_review",
  },
  {
    label: "Filed",
    statuses: ["delivered", "filed", "archived"],
    filter: "filed",
  },
];

const COLUMNS: readonly Column[] = [
  { key: "id", label: "Case", mono: true },
  { key: "beneficiary", label: "Beneficiary" },
  { key: "visa", label: "Visa", hideBelow: "sm" },
  { key: "stage", label: "Stage" },
  { key: "attorney", label: "Attorney", hideBelow: "lg" },
  { key: "fee", label: "Fee · Share", align: "right", hideBelow: "md" },
];

const STATUS_TONE: Record<CaseStatus, "neutral" | "accent" | "success" | "warning"> = {
  intake: "neutral",
  documents_pending: "neutral",
  extracting: "neutral",
  ready_to_build: "accent",
  building: "accent",
  draft_ready: "accent",
  in_review: "warning",
  needs_revision: "warning",
  approved: "success",
  package_ready: "success",
  delivered: "success",
  filed: "success",
  archived: "neutral",
  build_failed: "warning",
};

export default async function AdminCasesPage(props: {
  searchParams: Promise<{ status?: string; visa?: string; cursor_at?: string; cursor_id?: string }>;
}): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const params = await props.searchParams;
  const status = parseStatus(params.status);
  const visa = parseVisa(params.visa);
  const cursor =
    params.cursor_at && params.cursor_id
      ? { createdAt: params.cursor_at, id: params.cursor_id }
      : undefined;

  let data: Awaited<ReturnType<typeof api.admin.listAllCases>>;
  try {
    data = await api.admin.listAllCases({
      ...(status ? { status } : {}),
      ...(visa ? { visaType: visa } : {}),
      ...(cursor ? { cursor } : {}),
    });
  } catch (err) {
    if (err instanceof TRPCError && err.code === "FORBIDDEN") {
      redirect(APP_ROUTES.dashboard);
    }
    throw err;
  }

  const cells: StatCell[] = STAT_GROUPS.map((g) => ({
    label: g.label,
    value: (
      g.statuses.length === 0
        ? data.totals.total
        : g.statuses.reduce(
            (acc, s) => acc + (data.totals.byStatus[s] ?? 0),
            0,
          )
    ).toLocaleString(),
    href: g.filter
      ? `${APP_ROUTES.adminCases}?status=${g.filter}`
      : APP_ROUTES.adminCases,
    active: status === g.filter || (!status && g.statuses.length === 0),
  }));

  const lastRow = data.items[data.items.length - 1];
  const nextHref =
    data.nextCursor && lastRow
      ? buildHref(APP_ROUTES.adminCases, {
          status,
          visa,
          cursor_at: data.nextCursor.createdAt,
          cursor_id: data.nextCursor.id,
        })
      : undefined;

  return (
    <>
      <PageHeader
        breadcrumb={["Admin", "Cases"]}
        title="All cases"
        subtitle={`${data.totals.total.toLocaleString()} across the platform`}
      />

      <StatBand cells={cells} />

      <DataTable
        columns={COLUMNS}
        rows={data.items}
        rowKey={(c) => c.id}
        empty={{
          title: "No cases match this filter.",
          subtitle: "Cases created across all orgs appear here once they exist.",
        }}
        pagination={{
          ...(nextHref ? { nextHref } : {}),
        }}
        renderCell={(c, col) => {
          switch (col.key) {
            case "id":
              return (
                <Link
                  href={APP_ROUTES.case(c.id)}
                  className="hover:underline"
                  title={c.id}
                >
                  {c.id.slice(0, 8)}
                </Link>
              );
            case "beneficiary":
              return (
                <div>
                  <div>{c.beneficiaryName ?? "—"}</div>
                  <div className="text-xs text-[var(--ink-muted)]">
                    {c.orgName ?? "—"}
                  </div>
                </div>
              );
            case "visa":
              return <span className="mono text-xs">{c.visaType}</span>;
            case "stage":
              return (
                <Badge variant={STATUS_TONE[c.status] ?? "neutral"}>
                  {c.status.replace(/_/g, " ")}
                </Badge>
              );
            case "attorney":
              return c.primaryAttorney ? (
                <div className="text-xs">
                  <div>{c.primaryAttorney.name ?? "—"}</div>
                  <div className="mono text-[var(--ink-muted)]">
                    {c.primaryAttorney.email}
                  </div>
                </div>
              ) : (
                <span className="text-xs text-[var(--ink-muted)]">—</span>
              );
            case "fee":
              return (
                <div className="text-xs">
                  <div>{formatCents(c.caseFeeCents)}</div>
                  <div className="text-[var(--ink-muted)]">
                    {formatCents(c.docketShareCents)}
                  </div>
                </div>
              );
            default:
              return null;
          }
        }}
      />
    </>
  );
}

// Type-safe URL-param parsers — narrow against the canonical enum arrays
// in lib/constants + lib/case-status. Adding a new status/visa in those
// modules automatically widens these without code change.
const CASE_STATUS_SET = new Set<string>(CASE_STATUSES);
const VISA_TYPE_SET = new Set<string>(VISA_TYPES);

function parseStatus(raw: string | undefined): CaseStatus | undefined {
  return raw && CASE_STATUS_SET.has(raw) ? (raw as CaseStatus) : undefined;
}

function parseVisa(raw: string | undefined): VisaType | undefined {
  return raw && VISA_TYPE_SET.has(raw) ? (raw as VisaType) : undefined;
}

function buildHref(
  base: string,
  params: Record<string, string | undefined>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
