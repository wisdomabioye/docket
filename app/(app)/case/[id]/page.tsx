import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { RevenuePanel } from "@/components/revenue/RevenuePanel";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return { title: pageTitle(`Case ${id.slice(0, 8)}`) };
}

/**
 * Stage 05 case detail (Overview tab). Subsequent stages add Documents
 * (06), Build (07), Outputs (08) tabs.
 */
export default async function CaseDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const { id } = await params;
  const data = await api.case.get({ caseId: id });
  if (!data) notFound();

  const beneficiary =
    (data.beneficiaryData as { fullName?: string; nationality?: string } | null) ??
    {};

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 space-y-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-ink-muted)]">
            Case · {data.visaType}
          </p>
          <h1
            className="mt-2 text-2xl tracking-tight"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {beneficiary.fullName ?? "Unnamed beneficiary"}
          </h1>
          {beneficiary.nationality && (
            <p className="text-sm text-[var(--color-ink-muted)]">
              {beneficiary.nationality}
            </p>
          )}
        </div>
        <StatusPill status={data.status} />
      </header>

      <nav className="flex gap-4 border-b border-[var(--color-ink)]/10 text-sm">
        <span className="border-b-2 border-[var(--color-ink)] py-2 font-medium">
          Overview
        </span>
        <Link
          href={APP_ROUTES.caseIntake(data.id)}
          className="py-2 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          Intake
        </Link>
        <Link
          href={APP_ROUTES.caseDocuments(data.id)}
          className="py-2 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          Documents
        </Link>
        <Link
          href={APP_ROUTES.caseOutputs(data.id)}
          className="py-2 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          Outputs
        </Link>
      </nav>

      <section className="grid gap-6 sm:grid-cols-2">
        <Card title="Beneficiary">
          <Field label="Name" value={beneficiary.fullName} />
          <Field label="Nationality" value={beneficiary.nationality} />
          <Link
            href={APP_ROUTES.caseIntake(data.id)}
            className="mt-3 inline-block text-xs underline"
          >
            Edit intake →
          </Link>
        </Card>
        <Card title="Workflow">
          <Field label="Status" value={data.status} />
          <Field label="Visa type" value={data.visaType} />
          <Field label="Review SLA" value={`${data.reviewSlaHours}h`} />
          <Field
            label="Created"
            value={new Date(data.createdAt).toLocaleDateString()}
          />
        </Card>
      </section>

      <RevenuePanel
        caseId={data.id}
        initial={{
          feeCents: Number(data.caseFeeCents ?? 0n),
          docketShareCents: Number(data.docketShareCents ?? 0n),
          attorneyShareCents: Number(data.attorneyShareCents ?? 0n),
          revenueStatus: data.revenueStatus,
        }}
      />

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
          Recent activity
        </h2>
        <ul className="mt-3 space-y-2 text-sm">
          {data.events.length === 0 && (
            <li className="text-[var(--color-ink-muted)]">No events yet.</li>
          )}
          {data.events.map((e) => (
            <li
              key={e.id}
              className="flex justify-between border-b border-[var(--color-ink)]/5 py-2"
            >
              <span>
                <span className="font-mono text-xs">{e.eventType}</span>
                <span className="ml-2 text-xs text-[var(--color-ink-muted)]">
                  {e.actorType}
                </span>
              </span>
              <span className="text-xs text-[var(--color-ink-muted)]">
                {new Date(e.createdAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[var(--color-ink)]/10 bg-white p-4">
      <h3 className="mb-3 text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
        {title}
      </h3>
      <div className="space-y-2 text-sm">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value?: string | null | undefined;
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2">
      <span className="text-xs text-[var(--color-ink-muted)]">{label}</span>
      <span>{value || "—"}</span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--color-ink)]/20 px-3 py-1 text-xs font-medium capitalize">
      {status.replace(/_/g, " ")}
    </span>
  );
}
