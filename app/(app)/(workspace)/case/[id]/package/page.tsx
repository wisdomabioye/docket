import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { Card } from "@/components/ui";
import {
  CaseHeader,
  PackageAssemblyCard,
  PackageDraftNotice,
  PreflightCard,
  type PackageAssemblyItem,
} from "@/components/case";
import { DisclaimerBanner } from "@/components/output";
import {
  packageKeyFor,
  packageOrderRank,
} from "@/server/services/pdf/package";
import { PackageDownloadButton } from "./PackageDownloadButton";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return { title: pageTitle(`Package · ${id.slice(0, 4)}`) };
}

/**
 * Stage 08 + Stage 11 α package page. Lists every approved current
 * output in canonical filing order (matches `packageOrderRank` in the
 * PDF service) and exposes a "Download package" button. The button
 * hides when zero outputs are approved.
 *
 * Stage 11 α: wrapped in `CaseHeader` so the tab strip + status badge
 * are present. The mockup's pre-flight checks card + drag-to-reorder
 * + cost rail land in Phase β/γ.
 */
export default async function PackagePage({
  params,
}: Props): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const { id } = await params;
  const [caseRow, outputs, preflight, letterCoverage] = await Promise.all([
    api.case.get({ caseId: id }),
    api.output.list({ caseId: id }),
    api.case.preflight({ caseId: id }),
    api.case.recommenderLetterCoverage({ caseId: id }),
  ]);
  if (!caseRow) notFound();
  const approved = outputs.filter((o) => o.attorneyApproved);
  const beneficiary =
    (caseRow.beneficiaryData as {
      fullName?: string;
      nationality?: string;
    } | null) ?? {};
  const meta = beneficiary.nationality ? beneficiary.nationality : undefined;

  // Mirror the PDF service's order resolution: saved order wins,
  // missing keys fall through to the canonical rank. Keeping the
  // resolution identical here means what the attorney sees in the
  // assembly card is exactly what the compiler will lay out.
  const savedOrder = caseRow.packageOrder ?? null;
  const sorted = [...approved].sort((a, b) => {
    const aKey = packageKeyFor({
      outputType: a.outputType,
      subgroupKey: a.subgroupKey,
    });
    const bKey = packageKeyFor({
      outputType: b.outputType,
      subgroupKey: b.subgroupKey,
    });
    if (savedOrder) {
      const ai = savedOrder.indexOf(aKey);
      const bi = savedOrder.indexOf(bKey);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
    }
    const r = packageOrderRank(a.outputType) - packageOrderRank(b.outputType);
    if (r !== 0) return r;
    return (a.subgroupKey ?? "").localeCompare(b.subgroupKey ?? "");
  });

  const assemblyItems: ReadonlyArray<PackageAssemblyItem> = sorted.map((o) => ({
    key: packageKeyFor({
      outputType: o.outputType,
      subgroupKey: o.subgroupKey,
    }),
    outputType: o.outputType,
    outputVersion: o.outputVersion,
    subgroupKey: o.subgroupKey,
    metadata: o.metadata,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <CaseHeader
        caseId={caseRow.id}
        beneficiaryName={beneficiary.fullName ?? "Unnamed beneficiary"}
        visaType={caseRow.visaType}
        {...(meta ? { meta } : {})}
        status={caseRow.status}
        current="package"
      />

      <header>
        <p
          className="text-xs uppercase tracking-[0.3em]"
          style={{ color: "var(--ink-muted)" }}
        >
          Package &amp; file
        </p>
        <h2
          className="mt-2 text-2xl tracking-tight"
          style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
        >
          Filing package
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>
          {approved.length > 0
            ? `${approved.length} approved output${approved.length === 1 ? "" : "s"} ready to bundle.`
            : "No approved outputs yet — approve drafts on the Outputs tab to enable download."}
        </p>
      </header>

      <DisclaimerBanner />

      <PackageDraftNotice
        caseId={id}
        recommenderCount={letterCoverage.recommenderCount}
        signedLetterCount={letterCoverage.signedLetterCount}
      />

      <PreflightCard allOk={preflight.allOk} gates={preflight.gates} />

      <PackageAssemblyCard caseId={id} initialItems={assemblyItems} />

      {sorted.length > 0 ? (
        <Card title="Download" flush>
          <div className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p
              className="text-sm"
              style={{
                color: preflight.allOk ? "var(--ink-soft)" : "var(--warning, #8a4a13)",
              }}
            >
              {preflight.allOk
                ? "The signed URL opens in a new tab and expires in five minutes."
                : "Resolve the pre-flight gates above before downloading the package."}
            </p>
            <PackageDownloadButton caseId={id} disabled={!preflight.allOk} />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
