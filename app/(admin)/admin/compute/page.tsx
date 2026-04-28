import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { PageHeader } from "@/components/admin/PageHeader";
import { KpiCard, KpiGrid } from "@/components/kpi";
import { Card, EmptyState } from "@/components/ui";
import { Filters, type Chip } from "@/components/table";
import { formatCents } from "@/lib/utils";

export const metadata = { title: pageTitle("Compute & models") };

const PERIOD_CHIPS: ReadonlyArray<{
  label: string;
  period: "7d" | "30d" | "MTD" | "QTD";
}> = [
  { label: "7d", period: "7d" },
  { label: "30d", period: "30d" },
  { label: "MTD", period: "MTD" },
  { label: "QTD", period: "QTD" },
];

export default async function AdminComputePage(props: {
  searchParams: Promise<{ period?: string }>;
}): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const params = await props.searchParams;
  const period = parsePeriod(params.period) ?? "MTD";

  let data: Awaited<ReturnType<typeof api.admin.getComputeMetrics>>;
  try {
    data = await api.admin.getComputeMetrics({ period });
  } catch (err) {
    if (err instanceof TRPCError && err.code === "FORBIDDEN") {
      redirect(APP_ROUTES.dashboard);
    }
    throw err;
  }

  const empty = data.totals.entries === 0;
  const chips: Chip[] = PERIOD_CHIPS.map((c) => ({
    label: c.label,
    href: `${APP_ROUTES.adminCompute}?period=${c.period}`,
    active: period === c.period,
  }));

  return (
    <>
      <PageHeader
        breadcrumb={["Admin", "Compute & models"]}
        title="Compute & models"
        subtitle="Inference and document-extraction spend, sourced from the case compute ledger."
      />

      <Filters chips={chips} right={`Period: ${period}`} />

      <KpiGrid cols={2}>
        <KpiCard
          label={`Total spend · ${period}`}
          value={formatCents(data.totals.totalCents)}
          empty={empty}
          sub={empty ? "Awaiting first build" : `${data.totals.entries} ledger entries`}
        />
        <KpiCard
          label="Avg cost / entry"
          value={
            data.totals.entries > 0
              ? formatCents(data.totals.totalCents / BigInt(data.totals.entries))
              : "—"
          }
          empty={empty}
          sub={empty ? "—" : "Across all model calls"}
        />
      </KpiGrid>

      <div className="mt-6">
        <Card title={`Cost by category · ${period}`}>
          <EmptyState
            title="Category breakdown awaits a schema migration."
            subtitle="The compute ledger doesn't yet split inference vs. embeddings vs. OCR vs. storage. Tracked under open_issues #18 — populated once Stage 07 attaches a `compute_category` to each entry."
          />
        </Card>
      </div>
    </>
  );
}

function parsePeriod(raw: string | undefined): "7d" | "30d" | "MTD" | "QTD" | undefined {
  return raw === "7d" || raw === "30d" || raw === "MTD" || raw === "QTD"
    ? raw
    : undefined;
}
