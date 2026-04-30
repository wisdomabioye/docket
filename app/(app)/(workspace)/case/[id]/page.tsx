import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { Card } from "@/components/ui";
import { CaseHeader } from "@/components/case";
import { RevenuePanel } from "@/components/revenue/RevenuePanel";
import { formatDate, formatRelative } from "@/lib/utils";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return { title: pageTitle(`Case ${id.slice(0, 8)}`) };
}

/**
 * Stage 11 case overview. Composes `CaseHeader` (eyebrow + title +
 * status badge + tabs) + a 2-column body: left column has Beneficiary
 * + Workflow detail cards + recent activity; right rail holds the
 * `RevenuePanel`.
 *
 * Lives inside the workspace shell (`app/(app)/(workspace)/layout.tsx`),
 * so this page only renders the inner content — no second `<main>`.
 */
export default async function CaseDetailPage({
  params,
}: Props): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const { id } = await params;
  const data = await api.case.get({ caseId: id });
  if (!data) notFound();

  const beneficiary =
    (data.beneficiaryData as {
      fullName?: string;
      nationality?: string;
    } | null) ?? {};

  const meta = beneficiary.nationality ? beneficiary.nationality : undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <CaseHeader
        caseId={data.id}
        beneficiaryName={beneficiary.fullName ?? "Unnamed beneficiary"}
        visaType={data.visaType}
        {...(meta ? { meta } : {})}
        status={data.status}
        current="overview"
        actions={<CaseHeaderActions caseId={data.id} status={data.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="space-y-6">
          <Card title="Beneficiary">
            <FieldRow label="Name" value={beneficiary.fullName} />
            <FieldRow label="Nationality" value={beneficiary.nationality} />
            <Link
              href={APP_ROUTES.caseIntake(data.id)}
              className="mt-3 inline-block text-xs underline-offset-2 hover:underline"
            >
              Edit intake →
            </Link>
          </Card>

          <Card title="Workflow">
            <FieldRow label="Status" value={data.status.replace(/_/g, " ")} />
            <FieldRow label="Visa type" value={data.visaType} />
            <FieldRow label="Review SLA" value={`${data.reviewSlaHours}h`} />
            <FieldRow label="Created" value={formatDate(data.createdAt)} />
          </Card>

          <Card title="Recent activity">
            {data.events.length === 0 ? (
              <p
                className="text-sm"
                style={{ color: "var(--ink-muted)" }}
              >
                No events yet.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.events.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-baseline justify-between gap-4 border-b py-1.5 last:border-0"
                    style={{
                      borderColor: "var(--border, rgba(0,0,0,0.06))",
                    }}
                  >
                    <span className="mono text-xs">{e.eventType}</span>
                    <span
                      className="text-xs"
                      style={{ color: "var(--ink-muted)" }}
                    >
                      {formatRelative(e.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-6">
          <RevenuePanel
            caseId={data.id}
            initial={{
              feeCents: Number(data.caseFeeCents ?? 0n),
              docketShareCents: Number(data.docketShareCents ?? 0n),
              attorneyShareCents: Number(data.attorneyShareCents ?? 0n),
              revenueStatus: data.revenueStatus,
            }}
          />
        </aside>
      </div>
    </div>
  );
}

/**
 * Stage 11 case-header actions row — `⇣ Package` (always available
 * deep-link) + status-aware primary CTA. Mockup `case-overview.html`
 * l. 110-114 renders both as static buttons; we make the primary
 * stage-aware so the wording matches the case's lifecycle position.
 *
 *   pre-build (intake → ready_to_build / build_failed)  → "Build →"
 *   post-build (building → approved)                    → "Review drafts →"
 *   terminal (package_ready → archived)                 → no primary
 */
function CaseHeaderActions(props: {
  caseId: string;
  status: string;
}): React.ReactElement {
  const primary = primaryActionFor(props.status, props.caseId);
  return (
    <div className="flex items-center gap-2">
      <Link
        href={APP_ROUTES.casePackage(props.caseId)}
        className="rounded-md border px-3 py-1.5 text-xs font-medium"
        style={{
          borderColor: "var(--border, rgba(0,0,0,0.15))",
          color: "var(--ink)",
          background: "var(--surface, white)",
        }}
      >
        ⇣ Package
      </Link>
      {primary ? (
        <Link
          href={primary.href}
          className="rounded-md border px-3 py-1.5 text-xs font-medium text-[var(--cream)]"
          style={{
            borderColor: "var(--ink)",
            background: "var(--ink)",
          }}
        >
          {primary.label}
        </Link>
      ) : null}
    </div>
  );
}

function primaryActionFor(
  status: string,
  caseId: string,
): { label: string; href: string } | null {
  switch (status) {
    case "intake":
    case "documents_pending":
    case "extracting":
    case "ready_to_build":
    case "build_failed":
      return { label: "Build →", href: APP_ROUTES.caseBuild(caseId) };
    case "building":
    case "draft_ready":
    case "in_review":
    case "needs_revision":
    case "approved":
      return { label: "Review drafts →", href: APP_ROUTES.caseOutputs(caseId) };
    default:
      return null;
  }
}

function FieldRow(props: {
  label: string;
  value?: string | null | undefined;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 py-1 text-sm">
      <span
        className="text-xs uppercase tracking-wider"
        style={{ color: "var(--ink-muted)" }}
      >
        {props.label}
      </span>
      <span>{props.value || "—"}</span>
    </div>
  );
}
