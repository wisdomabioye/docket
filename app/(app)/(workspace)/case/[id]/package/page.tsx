import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { OUTPUT_TYPE_DISPLAY, readRecommenderName } from "@/lib/output-types";
import { Badge, Card } from "@/components/ui";
import { CaseHeader } from "@/components/case";
import { DisclaimerBanner } from "@/components/output";
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
  const caseRow = await api.case.get({ caseId: id });
  if (!caseRow) notFound();

  const outputs = await api.output.list({ caseId: id });
  const approved = outputs.filter((o) => o.attorneyApproved);
  const beneficiary =
    (caseRow.beneficiaryData as {
      fullName?: string;
      nationality?: string;
    } | null) ?? {};
  const meta = beneficiary.nationality ? beneficiary.nationality : undefined;

  const packageOrder: ReadonlyArray<string> = [
    "petition_letter",
    "personal_statement",
    "recommendation_letter_template",
    "criteria_analysis",
    "evidence_plan",
    "exhibit_index",
  ];
  const sorted = [...approved].sort((a, b) => {
    const ra = packageOrder.indexOf(a.outputType);
    const rb = packageOrder.indexOf(b.outputType);
    const rankA = ra === -1 ? packageOrder.length : ra;
    const rankB = rb === -1 ? packageOrder.length : rb;
    if (rankA !== rankB) return rankA - rankB;
    return (a.subgroupKey ?? "").localeCompare(b.subgroupKey ?? "");
  });

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

      <Card title="Approved outputs">
        {sorted.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            Nothing to bundle — approve drafts on the Outputs tab first.
          </p>
        ) : (
          <ul className="space-y-3">
            {sorted.map((o, idx) => (
              <li
                key={o.id}
                className="grid grid-cols-[2rem_1fr_auto] items-baseline gap-3 border-b py-2 last:border-0"
                style={{ borderColor: "var(--border, rgba(0,0,0,0.06))" }}
              >
                <span
                  className="mono text-[10px] uppercase tracking-wider"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <div>
                  <p className="text-sm font-medium">
                    {OUTPUT_TYPE_DISPLAY[o.outputType]}
                    {(() => {
                      const rec = readRecommenderName({
                        outputType: o.outputType,
                        metadata: o.metadata,
                      });
                      return rec ? ` · ${rec}` : "";
                    })()}
                  </p>
                  <p
                    className="mt-0.5 text-xs"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    v{o.outputVersion} · approved
                  </p>
                </div>
                <Badge variant="success">Ready</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {sorted.length > 0 ? (
        <Card title="Download" flush>
          <div className="flex items-center justify-between gap-3 px-4 py-4">
            <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
              The signed URL opens in a new tab and expires in five minutes.
            </p>
            <PackageDownloadButton caseId={id} />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
