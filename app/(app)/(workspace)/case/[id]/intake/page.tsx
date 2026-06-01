import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { CaseHeader, CaseHeaderActions, IntakeWizard } from "@/components/case";
import {
  StoredBeneficiaryDataSchema,
  type BeneficiaryData,
} from "@/server/db/schema/zod/beneficiary";
import { deriveCaseStage } from "@/lib/case-stage";
import { canEditIntake } from "@/lib/case-status";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return { title: pageTitle(`Intake · ${id.slice(0, 4)}`) };
}

/**
 * Beneficiary intake. Renders the multi-section `IntakeWizard` (Stage
 * 11 γ) inside the workspace `CaseHeader` chrome. Locks once status
 * passes `documents_pending` — the procedure rejects writes in that
 * case, the wizard surfaces a read-only state ahead of that.
 *
 * Persisted shape stays flat (`BeneficiaryDataSchema` from
 * `server/db/schema/zod/beneficiary.ts`); the wizard only groups fields
 * into sections at the UI layer.
 */
export default async function IntakePage({
  params,
  searchParams,
}: Props): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const { id } = await params;
  const { section } = await searchParams;
  const data = await api.case.get({ caseId: id });
  if (!data) notFound();

  const locked = !canEditIntake(data.status);
  // Parse the persisted blob through the read-tolerant schema: unknown /
  // since-removed keys (e.g. legacy `currentLocation`) are stripped so a
  // pre-existing row still loads populated. The strict schema is for the
  // write boundary, not stored reads — strict here would fail the parse
  // and blank the attorney's form (open_issues #69). A genuinely
  // unparseable blob still falls back to empty so the wizard renders.
  const parsed = StoredBeneficiaryDataSchema.safeParse(
    data.beneficiaryData ?? {},
  );
  const initial: BeneficiaryData = parsed.success ? parsed.data : {};
  const beneficiary = initial;
  const meta = beneficiary.nationality ? beneficiary.nationality : undefined;
  const stage = deriveCaseStage({ status: data.status });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <CaseHeader
        caseId={data.id}
        beneficiaryName={beneficiary.fullName ?? "Unnamed beneficiary"}
        visaType={data.visaType}
        {...(meta ? { meta } : {})}
        status={data.status}
        stage={stage}
        current="intake"
        actions={<CaseHeaderActions caseId={data.id} status={data.status} />}
      />

      <IntakeWizard
        caseId={data.id}
        visaType={data.visaType}
        initial={initial}
        rowRevision={data.rowRevision}
        currentStatus={data.status}
        locked={locked}
        {...(section ? { initialSection: section } : {})}
      />
    </div>
  );
}
