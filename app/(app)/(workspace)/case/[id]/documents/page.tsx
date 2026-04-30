import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { CaseHeader } from "@/components/case";
import { DocumentsPanel } from "./DocumentsPanel";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return { title: pageTitle(`Documents · ${id.slice(0, 4)}`) };
}

/**
 * Per-case documents tab. Drop-zone for upload + list of existing files
 * with extraction status pills.
 *
 * Stage 11 α — wraps with `CaseHeader` so the tab strip + status pill
 * are present (mockup `documents.html` shows the same `.case-hdr` +
 * `.tabs` block as `case-overview.html`). Inner `<main>` dropped; the
 * workspace shell owns it.
 */
export default async function DocumentsPage({
  params,
}: Props): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const { id } = await params;
  const caseRow = await api.case.get({ caseId: id });
  if (!caseRow) notFound();

  const docs = await api.document.list({ caseId: id });
  const beneficiary =
    (caseRow.beneficiaryData as {
      fullName?: string;
      nationality?: string;
    } | null) ?? {};
  const meta = beneficiary.nationality ? beneficiary.nationality : undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <CaseHeader
        caseId={caseRow.id}
        beneficiaryName={beneficiary.fullName ?? "Unnamed beneficiary"}
        visaType={caseRow.visaType}
        {...(meta ? { meta } : {})}
        status={caseRow.status}
        current="documents"
      />

      <DocumentsPanel
        caseId={id}
        initialDocs={docs.map((d) => ({
          ...d,
          sizeBytes: Number(d.sizeBytes),
          createdAt: d.createdAt.toISOString(),
          extractedAt: d.extractedAt ? d.extractedAt.toISOString() : null,
        }))}
      />
    </div>
  );
}
