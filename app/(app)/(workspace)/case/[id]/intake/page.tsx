import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { CaseHeader } from "@/components/case";
import { IntakeForm } from "./IntakeForm";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return { title: pageTitle(`Intake · ${id.slice(0, 4)}`) };
}

/**
 * Beneficiary intake form. Locked once status passes documents_pending
 * (the procedure rejects with CONFLICT in that case).
 *
 * Stage 11 α — wraps with `CaseHeader` so the case-level tabs strip is
 * present on every case page (matches the mockup's `case-overview.html`
 * + `documents.html` chrome). Inner `<main>` removed; the workspace
 * shell (`app/(app)/(workspace)/layout.tsx`) provides it.
 */
export default async function IntakePage({
  params,
}: Props): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const { id } = await params;
  const data = await api.case.get({ caseId: id });
  if (!data) notFound();

  const locked = data.status !== "intake" && data.status !== "documents_pending";
  const beneficiary =
    (data.beneficiaryData as { fullName?: string; nationality?: string } | null) ??
    {};
  const meta = beneficiary.nationality ? beneficiary.nationality : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <CaseHeader
        caseId={data.id}
        beneficiaryName={beneficiary.fullName ?? "Unnamed beneficiary"}
        visaType={data.visaType}
        {...(meta ? { meta } : {})}
        status={data.status}
        current="intake"
      />

      {locked ? (
        <p
          role="status"
          className="rounded-md border p-3 text-xs"
          style={{
            borderColor: "var(--warning, #b1830e)",
            background: "var(--warning-soft, rgba(177,131,14,0.08))",
            color: "var(--warning, #8a4a13)",
          }}
        >
          Read-only — beneficiary data is locked once status passes{" "}
          <code className="mono">documents_pending</code>.
        </p>
      ) : null}

      <IntakeForm
        caseId={data.id}
        initial={
          (data.beneficiaryData as Record<string, string> | null) ?? {}
        }
        rowRevision={data.rowRevision}
        currentStatus={data.status}
        locked={locked}
      />
    </div>
  );
}
