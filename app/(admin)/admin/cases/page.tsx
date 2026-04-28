import Link from "next/link";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatBand, type StatCell } from "@/components/admin/StatBand";
import { Badge } from "@/components/ui";
import { DataTable, type Column } from "@/components/table";
import { type CaseStatus } from "@/lib/case-status";
import { VISA_TYPES, type VisaType } from "@/lib/constants";
import { caseStatusVariant } from "@/lib/status-style";
import { formatCents } from "@/lib/utils";
import { parseEnum } from "@/lib/url-params";
import {
  buildNextHref,
  buildPrevHref,
  buildResetHref,
  formatRange,
  parsePaginationParams,
} from "@/lib/keyset-pagination";

const PAGE_SIZE = 25;

export const metadata = { title: pageTitle("All cases") };

// Stat-band groupings for the cases page. The `key` is the URL param
// value used when the cell is clicked; the `statuses` array is BOTH
// what we count for the cell's value AND what we filter by when active.
// (Pre-fix bug: count summed N statuses but filter applied to 1 — the
// click would shrink the displayed list well below the advertised count.)
type StatusGroupKey =
  | "all"
  | "intake"
  | "extracting"
  | "drafting"
  | "review"
  | "filed";

const STAT_GROUPS: ReadonlyArray<{
  key: StatusGroupKey;
  label: string;
  statuses: readonly CaseStatus[];
}> = [
  { key: "all", label: "All", statuses: [] },
  {
    key: "intake",
    label: "Intake",
    statuses: ["intake", "documents_pending"],
  },
  { key: "extracting", label: "Extracting", statuses: ["extracting"] },
  {
    key: "drafting",
    label: "Drafting",
    statuses: ["ready_to_build", "building", "build_failed", "draft_ready"],
  },
  {
    key: "review",
    label: "Review",
    statuses: ["in_review", "needs_revision", "approved", "package_ready"],
  },
  {
    key: "filed",
    label: "Filed",
    statuses: ["delivered", "filed", "archived"],
  },
];

const GROUP_BY_KEY: Record<StatusGroupKey, readonly CaseStatus[]> =
  Object.fromEntries(STAT_GROUPS.map((g) => [g.key, g.statuses])) as Record<
    StatusGroupKey,
    readonly CaseStatus[]
  >;

const VALID_GROUP_KEYS: ReadonlySet<string> = new Set(
  STAT_GROUPS.map((g) => g.key),
);

const COLUMNS: readonly Column[] = [
  { key: "id", label: "Case", mono: true },
  { key: "beneficiary", label: "Beneficiary" },
  { key: "visa", label: "Visa", hideBelow: "sm" },
  { key: "stage", label: "Stage" },
  { key: "attorney", label: "Attorney", hideBelow: "lg" },
  { key: "fee", label: "Fee · Share", align: "right", hideBelow: "md" },
];

export default async function AdminCasesPage(props: {
  searchParams: Promise<{
    group?: string;
    visa?: string;
    cursor_at?: string;
    cursor_id?: string;
    stack?: string;
  }>;
}): Promise<React.ReactElement> {
  const params = await props.searchParams;
  const groupKey: StatusGroupKey =
    params.group && VALID_GROUP_KEYS.has(params.group)
      ? (params.group as StatusGroupKey)
      : "all";
  const statusesForFilter = GROUP_BY_KEY[groupKey];
  const visa = parseEnum<VisaType>(params.visa, VISA_TYPES);
  const pagination = parsePaginationParams(params);

  const data = await api.admin.listAllCases({
    ...(statusesForFilter.length > 0
      ? { status: [...statusesForFilter] }
      : {}),
    ...(visa ? { visaType: visa } : {}),
    ...(pagination.cursor ? { cursor: pagination.cursor } : {}),
  });

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
    href: buildResetHref(
      APP_ROUTES.adminCases,
      g.key === "all" ? {} : { group: g.key },
    ),
    active: groupKey === g.key,
  }));

  const filterExtras: Record<string, string | undefined> = {
    ...(groupKey !== "all" ? { group: groupKey } : {}),
    ...(visa ? { visa } : {}),
  };
  const nextHref = data.nextCursor
    ? buildNextHref(
        APP_ROUTES.adminCases,
        pagination,
        data.nextCursor,
        filterExtras,
      )
    : undefined;
  const prevHref = buildPrevHref(
    APP_ROUTES.adminCases,
    pagination,
    filterExtras,
  );

  // Group total = sum of its statuses; click+count are now consistent.
  const totalForFilter =
    statusesForFilter.length === 0
      ? data.totals.total
      : statusesForFilter.reduce(
          (acc, s) => acc + (data.totals.byStatus[s] ?? 0),
          0,
        );
  const range = formatRange({
    pageIndex: pagination.stack.length,
    pageSize: PAGE_SIZE,
    itemsOnPage: data.items.length,
  });

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
          total: totalForFilter,
          ...(range ? { range } : {}),
          ...(nextHref ? { nextHref } : {}),
          ...(prevHref ? { prevHref } : {}),
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
                <Badge variant={caseStatusVariant[c.status]}>
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


