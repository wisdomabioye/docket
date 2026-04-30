import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { PageHeader } from "@/components/admin/PageHeader";
import { Badge } from "@/components/ui";
import { DataTable, Filters, type Chip, type Column } from "@/components/table";
import { ATTORNEY_STATUSES, type AttorneyStatus } from "@/lib/constants";
import { attorneyStatusVariant } from "@/lib/status-style";
import { formatDate, formatNumber } from "@/lib/utils";
import {
  buildNextHref,
  buildPrevHref,
  buildResetHref,
  formatRange,
  parsePaginationParams,
} from "@/lib/keyset-pagination";
import { parseEnum } from "@/lib/url-params";
import Link from "next/link";
import { ActivateButton } from "./ActivateButton";
import { SuspendButton } from "./SuspendButton";

// Auth + admin-role gating happens in `app/(admin)/layout.tsx` (sole
// owner of `await auth()` and the `admin.ping` probe). Pages assume an
// authenticated admin caller and call procedures directly.
const PAGE_SIZE = 25;

export const metadata = { title: pageTitle("Attorneys") };

const STATUS_CHIPS: ReadonlyArray<{
  label: string;
  status: "all" | "active" | "pending" | "suspended" | "inactive";
}> = [
  { label: "All", status: "all" },
  { label: "Active", status: "active" },
  { label: "Pending", status: "pending" },
  { label: "Suspended", status: "suspended" },
  { label: "Inactive", status: "inactive" },
];

const COLUMNS: readonly Column[] = [
  { key: "name", label: "Attorney" },
  { key: "bar", label: "Bar / States", hideBelow: "md" },
  { key: "status", label: "Status" },
  { key: "joined", label: "Joined", hideBelow: "lg" },
  { key: "actions", label: "", align: "right" },
];

export default async function AdminAttorneysPage(props: {
  searchParams: Promise<{
    status?: string;
    cursor_at?: string;
    cursor_id?: string;
    stack?: string;
  }>;
}): Promise<React.ReactElement> {
  const params = await props.searchParams;
  const status = parseEnum<AttorneyStatus>(params.status, ATTORNEY_STATUSES);
  const pagination = parsePaginationParams(params);

  const data = await api.admin.listAttorneys({
    ...(status ? { status } : {}),
    ...(pagination.cursor ? { cursor: pagination.cursor } : {}),
  });

  // Filter chip clicks reset to page 1 — keeping a stack across a filter
  // change would point at irrelevant cursors.
  const chips: Chip[] = STATUS_CHIPS.map((c) => ({
    label: c.label,
    count: c.status === "all" ? data.totals.all : data.totals[c.status],
    href: buildResetHref(
      APP_ROUTES.adminAttorneys,
      c.status === "all" ? {} : { status: c.status },
    ),
    active: (status ?? "all") === c.status,
  }));

  const filterExtras = status ? { status } : {};
  const nextHref = data.nextCursor
    ? buildNextHref(
        APP_ROUTES.adminAttorneys,
        pagination,
        data.nextCursor,
        filterExtras,
      )
    : undefined;
  const prevHref = buildPrevHref(
    APP_ROUTES.adminAttorneys,
    pagination,
    filterExtras,
  );

  const total = status ? data.totals[status] : data.totals.all;
  const range = formatRange({
    pageIndex: pagination.stack.length,
    pageSize: PAGE_SIZE,
    itemsOnPage: data.items.length,
  });

  return (
    <>
      <PageHeader
        breadcrumb={["Admin", "Attorneys"]}
        title="Attorneys"
        subtitle={`${data.totals.active} active · ${data.totals.pending} pending · ${data.totals.suspended} suspended`}
      />

      <Filters chips={chips} right={`${formatNumber(total)} total`} />

      <DataTable
        columns={COLUMNS}
        rows={data.items}
        rowKey={(r) => r.userId}
        empty={
          status === "pending"
            ? {
                title: "Nobody waiting for activation.",
                subtitle:
                  "When attorneys submit onboarding, they'll appear here.",
              }
            : { title: "No attorneys to show." }
        }
        pagination={{
          total,
          ...(range ? { range } : {}),
          ...(nextHref ? { nextHref } : {}),
          ...(prevHref ? { prevHref } : {}),
        }}
        renderCell={(row, col) => {
          switch (col.key) {
            case "name":
              return (
                <Link
                  href={`${APP_ROUTES.adminAttorneys}/${row.userId}`}
                  className="block hover:underline"
                >
                  <div className="font-medium">{row.name ?? "—"}</div>
                  <div className="mono text-xs text-[var(--ink-muted)]">
                    {row.email}
                  </div>
                </Link>
              );
            case "bar":
              return (
                <div className="text-xs">
                  <div className="mono">{row.barNumber ?? "—"}</div>
                  <div className="text-[var(--ink-muted)]">
                    {row.barStates.length > 0 ? row.barStates.join(", ") : "—"}
                  </div>
                </div>
              );
            case "status":
              return (
                <Badge variant={attorneyStatusVariant[row.status]}>
                  {row.status}
                </Badge>
              );
            case "joined":
              return (
                <span className="mono text-xs">
                  {formatDate(row.joinedAt)}
                </span>
              );
            case "actions":
              if (row.status === "pending" && row.submittedAt) {
                return <ActivateButton userId={row.userId} />;
              }
              if (row.status === "active") {
                return <SuspendButton userId={row.userId} />;
              }
              return null;
            default:
              return null;
          }
        }}
      />
    </>
  );
}


