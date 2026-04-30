import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { PageHeader } from "@/components/admin/PageHeader";
import { Badge } from "@/components/ui";
import { DataTable, type Column } from "@/components/table";
import { waitlistApprovalVariant } from "@/lib/status-style";
import { formatDate, formatNumber } from "@/lib/utils";
import {
  buildNextHref,
  buildPrevHref,
  formatRange,
  parsePaginationParams,
} from "@/lib/keyset-pagination";
import { ApproveButton } from "./ApproveButton";

const PAGE_SIZE = 25;

export const metadata = { title: pageTitle("Waitlist") };

const COLUMNS: readonly Column[] = [
  { key: "email", label: "Email", mono: true },
  { key: "name", label: "Name", hideBelow: "sm" },
  { key: "source", label: "Source", hideBelow: "lg" },
  { key: "joined", label: "Joined", hideBelow: "md" },
  { key: "status", label: "Status" },
  { key: "actions", label: "", align: "right" },
];

/**
 * Waitlist + invite gate. Approving a row lets that email complete OAuth
 * sign-in. Rows stay listed even after approval so admins can audit who
 * approved whom and when.
 */
export default async function AdminWaitlistPage(props: {
  searchParams: Promise<{ cursor_at?: string; cursor_id?: string; stack?: string }>;
}): Promise<React.ReactElement> {
  const params = await props.searchParams;
  const pagination = parsePaginationParams(params);
  const data = await api.admin.listWaitlist(
    pagination.cursor ? { cursor: pagination.cursor } : {},
  );

  const entries = data.items;
  const nextHref = data.nextCursor
    ? buildNextHref(APP_ROUTES.adminWaitlist, pagination, data.nextCursor)
    : undefined;
  const prevHref = buildPrevHref(APP_ROUTES.adminWaitlist, pagination);
  const range = formatRange({
    pageIndex: pagination.stack.length,
    pageSize: PAGE_SIZE,
    itemsOnPage: entries.length,
  });

  return (
    <>
      <PageHeader
        breadcrumb={["Admin", "Waitlist"]}
        title="Waitlist"
        subtitle={
          data.totals.total === 0
            ? "Nobody on the waitlist yet."
            : `${formatNumber(data.totals.total)} total · ${formatNumber(data.totals.pending)} awaiting approval`
        }
      />

      <DataTable
        columns={COLUMNS}
        rows={entries}
        rowKey={(e) => e.id}
        empty={{
          title: "No waitlist entries yet.",
          subtitle:
            "Sign-ups from the landing page will appear here, awaiting approval.",
        }}
        pagination={{
          total: data.totals.total,
          ...(range ? { range } : {}),
          ...(nextHref ? { nextHref } : {}),
          ...(prevHref ? { prevHref } : {}),
        }}
        renderCell={(e, col) => {
          switch (col.key) {
            case "email":
              return e.email;
            case "name":
              return e.name ?? "—";
            case "source":
              return (
                <span className="text-xs text-[var(--ink-muted)]">
                  {e.source ?? "—"}
                </span>
              );
            case "joined":
              return (
                <span className="mono text-xs text-[var(--ink-muted)]">
                  {formatDate(e.createdAt)}
                </span>
              );
            case "status": {
              const isApproved = Boolean(e.approvedAt);
              return (
                <Badge variant={waitlistApprovalVariant(isApproved)}>
                  {isApproved ? "approved" : "pending"}
                </Badge>
              );
            }
            case "actions":
              return e.approvedAt ? (
                <span className="mono text-[10px] text-[var(--ink-muted)]">
                  by {e.approvedByEmail ?? "—"}
                </span>
              ) : (
                <ApproveButton entryId={e.id} />
              );
            default:
              return null;
          }
        }}
      />
    </>
  );
}
