import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { OUTPUT_TYPE_DISPLAY } from "@/lib/output-types";
import { CaseHeader } from "@/components/case";
import { OutputDetailPanel } from "./OutputDetailPanel";

type Props = {
  params: Promise<{ id: string; outputId: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { id, outputId } = await params;
  return {
    title: pageTitle(`Output · ${id.slice(0, 4)} · ${outputId.slice(0, 4)}`),
  };
}

/**
 * Stage 08 + Stage 11 α output detail. Fetches the case + output
 * server-side, then hands a hydrated initial snapshot to the client
 * panel which manages editor state, save/regenerate/approve mutations,
 * and version-history polling.
 *
 * Three-column editor layout per `Docket-Meridian-UI/hifi/output-detail.html`
 * lives inside `OutputDetailPanel`.
 *
 * Stage 11 α: wrapped in `CaseHeader` so the case-tab strip + status
 * badge are present on every case-scoped page; the panel below renders
 * the editor + rails.
 */
export default async function OutputDetailPage({
  params,
}: Props): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const { id, outputId } = await params;
  const [caseRow, output] = await Promise.all([
    api.case.get({ caseId: id }),
    api.output.get({ outputId }),
  ]);
  if (!caseRow || !output) notFound();
  // Sanity: output must belong to the case in the URL. RLS already
  // hides cross-case access; a malformed URL (own case A, own output
  // id from case B) is still possible.
  if (output.caseId !== id) notFound();

  const beneficiary =
    (caseRow.beneficiaryData as
      | { fullName?: string; nationality?: string }
      | null) ?? {};
  const meta = beneficiary.nationality ? beneficiary.nationality : undefined;
  const display = OUTPUT_TYPE_DISPLAY[output.outputType];

  return (
    <div className="space-y-6">
      <div className="mx-auto max-w-6xl">
        <CaseHeader
          caseId={caseRow.id}
          beneficiaryName={beneficiary.fullName ?? "Unnamed beneficiary"}
          visaType={caseRow.visaType}
          {...(meta ? { meta } : {})}
          status={caseRow.status}
          current="outputs"
        />
      </div>

      <OutputDetailPanel
        caseId={id}
        caseLabel={
          beneficiary.fullName
            ? `${beneficiary.fullName} · ${caseRow.visaType}`
            : caseRow.visaType
        }
        typeDisplayName={display}
        initialOutput={{
          id: output.id,
          outputType: output.outputType,
          outputVersion: output.outputVersion,
          subgroupKey: output.subgroupKey,
          content: output.content ?? "",
          attorneyApproved: output.attorneyApproved,
          approvedAt:
            output.approvedAt instanceof Date
              ? output.approvedAt.toISOString()
              : null,
          updatedAt:
            output.updatedAt instanceof Date
              ? output.updatedAt.toISOString()
              : new Date().toISOString(),
        }}
      />
    </div>
  );
}
