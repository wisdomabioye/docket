import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { PageHeader } from "@/components/admin/PageHeader";
import { AuditRow } from "@/components/admin/AuditRow";
import { Card, EmptyState } from "@/components/ui";
import { Filters, PageLink, type Chip } from "@/components/table";
import {
  buildNextHref,
  buildPrevHref,
  buildResetHref,
  formatRange,
  parsePaginationParams,
} from "@/lib/keyset-pagination";

const PAGE_SIZE = 25;

export const metadata = { title: pageTitle("Audit log") };

const PREFIX_CHIPS: ReadonlyArray<{ label: string; prefix: string | null }> = [
  { label: "All events", prefix: null },
  { label: "Attorney", prefix: "attorney" },
  { label: "Waitlist", prefix: "waitlist" },
  { label: "Case", prefix: "case" },
  { label: "Admin", prefix: "admin" },
];

export default async function AdminAuditLogPage(props: {
  searchParams: Promise<{
    prefix?: string;
    cursor_at?: string;
    cursor_id?: string;
    stack?: string;
  }>;
}): Promise<React.ReactElement> {
  const params = await props.searchParams;
  const prefix = params.prefix ?? null;
  const pagination = parsePaginationParams(params);

  const data = await api.admin.listAuditEvents({
    ...(prefix ? { actionPrefix: `${prefix}.` } : {}),
    ...(pagination.cursor ? { cursor: pagination.cursor } : {}),
  });

  const chips: Chip[] = PREFIX_CHIPS.map((c) => ({
    label: c.label,
    count: c.prefix
      ? data.byPrefix[c.prefix] ?? 0
      : Object.values(data.byPrefix).reduce((a, b) => a + b, 0),
    href: buildResetHref(
      APP_ROUTES.adminAuditLog,
      c.prefix ? { prefix: c.prefix } : {},
    ),
    active: prefix === c.prefix,
  }));

  const filterExtras = prefix ? { prefix } : {};
  const nextHref = data.nextCursor
    ? buildNextHref(
        APP_ROUTES.adminAuditLog,
        pagination,
        data.nextCursor,
        filterExtras,
      )
    : undefined;
  const prevHref = buildPrevHref(
    APP_ROUTES.adminAuditLog,
    pagination,
    filterExtras,
  );
  const range = formatRange({
    pageIndex: pagination.stack.length,
    pageSize: PAGE_SIZE,
    itemsOnPage: data.items.length,
  });

  return (
    <>
      <PageHeader
        breadcrumb={["Admin", "Audit log"]}
        title="Audit log"
        subtitle={`${data.total24h.toLocaleString()} events in the last 24h. Append-only, retained 7 years.`}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
        <div>
          <Filters
            chips={chips}
            right={`${data.total24h.toLocaleString()} matching · 24h window`}
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
            <AuditPagination
              {...(prevHref ? { prevHref } : {})}
              {...(nextHref ? { nextHref } : {})}
              {...(range ? { range } : {})}
              total={data.total24h}
            />
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

/** Tiny pagination footer that mirrors `DataTable`'s built-in chrome
 *  but inside the Card boundary instead of below it. The audit log
 *  doesn't use DataTable (it's an unordered list of color-coded rows),
 *  so we render the same shape here for consistency. */
function AuditPagination(props: {
  prevHref?: string;
  nextHref?: string;
  range?: string;
  total: number;
}): React.ReactElement | null {
  if (!props.prevHref && !props.nextHref && !props.range) return null;
  const summary =
    props.range && props.total !== undefined
      ? `Showing ${props.range} of ${props.total.toLocaleString()}`
      : null;
  return (
    <div
      className="flex items-center justify-between border-t px-4 py-2.5 text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]"
      style={{ borderColor: "var(--border)" }}
    >
      <span>{summary}</span>
      <span className="flex items-center gap-2">
        <PageLink {...(props.prevHref ? { href: props.prevHref } : {})} label="← Prev" />
        <PageLink {...(props.nextHref ? { href: props.nextHref } : {})} label="Next →" />
      </span>
    </div>
  );
}

