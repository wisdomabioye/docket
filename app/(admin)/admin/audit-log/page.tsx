import Link from "next/link";
import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { PageHeader } from "@/components/admin/PageHeader";
import { AuditRow } from "@/components/admin/AuditRow";
import { Card, EmptyState } from "@/components/ui";
import { Filters, type Chip } from "@/components/table";

export const metadata = { title: pageTitle("Audit log") };

const PREFIX_CHIPS: ReadonlyArray<{ label: string; prefix: string | null }> = [
  { label: "All events", prefix: null },
  { label: "Attorney", prefix: "attorney" },
  { label: "Waitlist", prefix: "waitlist" },
  { label: "Case", prefix: "case" },
  { label: "Admin", prefix: "admin" },
];

export default async function AdminAuditLogPage(props: {
  searchParams: Promise<{ prefix?: string; cursor_at?: string; cursor_id?: string }>;
}): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const params = await props.searchParams;
  const prefix = params.prefix ?? null;
  const cursor =
    params.cursor_at && params.cursor_id
      ? { createdAt: params.cursor_at, id: params.cursor_id }
      : undefined;

  let data: Awaited<ReturnType<typeof api.admin.listAuditEvents>>;
  try {
    data = await api.admin.listAuditEvents({
      ...(prefix ? { actionPrefix: `${prefix}.` } : {}),
      ...(cursor ? { cursor } : {}),
    });
  } catch (err) {
    if (err instanceof TRPCError && err.code === "FORBIDDEN") {
      redirect(APP_ROUTES.dashboard);
    }
    throw err;
  }

  const chips: Chip[] = PREFIX_CHIPS.map((c) => ({
    label: c.label,
    count: c.prefix ? data.byPrefix[c.prefix] ?? 0 : Object.values(data.byPrefix).reduce((a, b) => a + b, 0),
    href: c.prefix
      ? `${APP_ROUTES.adminAuditLog}?prefix=${c.prefix}`
      : APP_ROUTES.adminAuditLog,
    active: prefix === c.prefix,
  }));

  const lastRow = data.items[data.items.length - 1];
  const nextHref =
    data.nextCursor && lastRow
      ? buildHref(APP_ROUTES.adminAuditLog, {
          ...(prefix ? { prefix } : {}),
          cursor_at: data.nextCursor.createdAt,
          cursor_id: data.nextCursor.id,
        })
      : undefined;

  return (
    <>
      <PageHeader
        breadcrumb={["Admin", "Audit log"]}
        title="Audit log"
        subtitle="Append-only record of every admin and attorney mutation. Retained 7 years."
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
        <div>
          <Filters
            chips={chips}
            right={`${data.items.length} on this page`}
          />
          <Card flush>
            {data.items.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No events for this filter."
                  subtitle="Adjust the filter or check back as activity accumulates."
                />
              </div>
            ) : (
              <ul>
                {data.items.map((e) => (
                  <AuditRow key={e.id} event={e} />
                ))}
              </ul>
            )}
            {nextHref ? (
              <div
                className="border-t px-4 py-2.5 text-right"
                style={{ borderColor: "var(--border)" }}
              >
                <Link
                  href={nextHref}
                  className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                >
                  Load more ↓
                </Link>
              </div>
            ) : null}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card title="Last 24 hours">
            {Object.keys(data.byPrefix).length === 0 ? (
              <p className="text-xs text-[var(--ink-muted)]">
                No events in the last 24 hours.
              </p>
            ) : (
              <dl className="space-y-1.5 text-xs">
                {Object.entries(data.byPrefix)
                  .sort(([, a], [, b]) => b - a)
                  .map(([key, count]) => (
                    <div key={key} className="flex justify-between gap-3">
                      <dt className="capitalize text-[var(--ink-muted)]">
                        {key}
                      </dt>
                      <dd className="mono">{count.toLocaleString()}</dd>
                    </div>
                  ))}
              </dl>
            )}
          </Card>

          <Card title="Retention">
            <p className="text-xs leading-relaxed text-[var(--ink-muted)]">
              Case-linked events: <strong className="text-[var(--ink)]">7 years</strong>. Infra/system events: 18 months. All entries encrypted at rest. Hash-chain verification ships in a later stage.
            </p>
          </Card>
        </aside>
      </div>
    </>
  );
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
