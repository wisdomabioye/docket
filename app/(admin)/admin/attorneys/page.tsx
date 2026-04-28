import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { PageHeader } from "@/components/admin/PageHeader";
import { Badge } from "@/components/ui";
import { DataTable, Filters, type Chip, type Column } from "@/components/table";
import { ActivateButton } from "./ActivateButton";

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

const STATUS_VARIANT = {
  active: "success",
  pending: "warning",
  suspended: "error",
  inactive: "neutral",
} as const;

export default async function AdminAttorneysPage(props: {
  searchParams: Promise<{
    status?: string;
    cursor_at?: string;
    cursor_id?: string;
  }>;
}): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const params = await props.searchParams;
  const status = parseStatus(params.status);
  const cursor =
    params.cursor_at && params.cursor_id
      ? { createdAt: params.cursor_at, id: params.cursor_id }
      : undefined;

  const data = await callOrBounce(() =>
    api.admin.listAttorneys({
      ...(status ? { status } : {}),
      ...(cursor ? { cursor } : {}),
    }),
  );

  const chips: Chip[] = STATUS_CHIPS.map((c) => ({
    label: c.label,
    count: c.status === "all" ? data.totals.all : data.totals[c.status],
    href:
      c.status === "all"
        ? APP_ROUTES.adminAttorneys
        : `${APP_ROUTES.adminAttorneys}?status=${c.status}`,
    active: (status ?? "all") === c.status,
  }));

  const lastRow = data.items[data.items.length - 1];
  const nextHref =
    data.nextCursor && lastRow
      ? buildHref(APP_ROUTES.adminAttorneys, {
          status,
          cursor_at: data.nextCursor.createdAt,
          cursor_id: data.nextCursor.id,
        })
      : undefined;

  return (
    <>
      <PageHeader
        breadcrumb={["Admin", "Attorneys"]}
        title="Attorneys"
        subtitle={`${data.totals.active} active · ${data.totals.pending} pending · ${data.totals.suspended} suspended`}
      />

      <Filters chips={chips} right={`${data.items.length} on this page`} />

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
          ...(nextHref ? { nextHref } : {}),
        }}
        renderCell={(row, col) => {
          switch (col.key) {
            case "name":
              return (
                <div>
                  <div className="font-medium">{row.name ?? "—"}</div>
                  <div className="mono text-xs text-[var(--ink-muted)]">
                    {row.email}
                  </div>
                </div>
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
                <Badge variant={STATUS_VARIANT[row.status]}>{row.status}</Badge>
              );
            case "joined":
              return (
                <span className="mono text-xs">
                  {new Date(row.joinedAt).toLocaleDateString()}
                </span>
              );
            case "actions":
              return row.status === "pending" && row.submittedAt ? (
                <ActivateButton userId={row.userId} />
              ) : null;
            default:
              return null;
          }
        }}
      />
    </>
  );
}

function parseStatus(
  raw: string | undefined,
): "active" | "pending" | "suspended" | "inactive" | undefined {
  if (
    raw === "active" ||
    raw === "pending" ||
    raw === "suspended" ||
    raw === "inactive"
  ) {
    return raw;
  }
  return undefined;
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

async function callOrBounce<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TRPCError && err.code === "FORBIDDEN") {
      redirect(APP_ROUTES.dashboard);
    }
    throw err;
  }
}
