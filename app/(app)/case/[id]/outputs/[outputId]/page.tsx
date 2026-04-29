import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { OUTPUT_TYPE_DISPLAY } from "@/lib/output-types";
import { OutputDetailPanel } from "./OutputDetailPanel";

type Props = {
  params: Promise<{ id: string; outputId: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { id, outputId } = await params;
  return {
    title: pageTitle(`Output · ${id.slice(0, 8)} · ${outputId.slice(0, 8)}`),
  };
}

/**
 * Stage 08 output detail. Fetches the case + output server-side, then
 * hands a hydrated initial snapshot to the client panel which manages
 * editor state, save/regenerate/approve mutations, and version-history
 * polling.
 *
 * Three-column layout per `Docket-Meridian-UI/hifi/output-detail.html`:
 * left context rail, center editor, right rail with status + version
 * history + actions.
 */
export default async function OutputDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const { id, outputId } = await params;
  const [caseRow, output] = await Promise.all([
    api.case.get({ caseId: id }),
    api.output.get({ outputId }),
  ]);
  if (!caseRow || !output) notFound();
  // Sanity: output must belong to the case in the URL. RLS would have
  // hidden cross-case access already, but a malformed URL (own case A,
  // own output id from case B) is still possible.
  if (output.caseId !== id) notFound();

  const beneficiary = (caseRow.beneficiaryData as
    | { fullName?: string }
    | null) ?? {};
  const display = OUTPUT_TYPE_DISPLAY[output.outputType];

  return (
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
  );
}
