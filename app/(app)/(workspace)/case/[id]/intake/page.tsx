import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { CaseHeader, IntakeWizard } from "@/components/case";
import {
  BeneficiaryDataSchema,
  type BeneficiaryData,
} from "@/server/db/schema/zod/beneficiary";

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

  const locked =
    data.status !== "intake" && data.status !== "documents_pending";
  // Parse the persisted blob through the schema so the wizard receives
  // a typed `BeneficiaryData`. Unknown / extra keys are stripped by
  // `.strict()`; an unparseable blob falls back to empty (the wizard
  // still renders so the attorney can re-fill).
  const parsed = BeneficiaryDataSchema.safeParse(data.beneficiaryData ?? {});
  const initial: BeneficiaryData = parsed.success ? parsed.data : {};
  const beneficiary = initial;
  const meta = beneficiary.nationality ? beneficiary.nationality : undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <CaseHeader
        caseId={data.id}
        beneficiaryName={beneficiary.fullName ?? "Unnamed beneficiary"}
        visaType={data.visaType}
        {...(meta ? { meta } : {})}
        status={data.status}
        current="intake"
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
