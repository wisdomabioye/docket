import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { OUTPUT_TYPE_DISPLAY, readRecommenderName } from "@/lib/output-types";
import { Badge, Card } from "@/components/ui";
import { DisclaimerBanner } from "@/components/output";
import { PackageDownloadButton } from "./PackageDownloadButton";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return { title: pageTitle(`Package · ${id.slice(0, 8)}`) };
}

/**
 * Stage 08 package page. Lists every approved current output in the
 * canonical filing order (matches `packageOrderRank` in the PDF
 * service) and exposes a "Download package" button. The button is
 * hidden when zero outputs are approved (server-side compile would
 * also reject; this is just the friendlier UX). Clicking the button
 * fires `output.downloadPackage` and opens the signed URL in a new tab.
 *
 * What ships in Phase 1 (vs. the mockup):
 *   - Approved-output list with type label + subtitle.
 *   - Disclaimer banner (mandate).
 *   - Download CTA → signed URL.
 * Deferred to later stages: pre-flight checks, fee calc, attorney
 * signature block, file-with-USCIS button.
 */
export default async function PackagePage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const { id } = await params;
  const caseRow = await api.case.get({ caseId: id });
  if (!caseRow) notFound();

  const outputs = await api.output.list({ caseId: id });
  const approved = outputs.filter((o) => o.attorneyApproved);
  const beneficiary = (caseRow.beneficiaryData as
    | { fullName?: string }
    | null) ?? {};
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
    <main className="mx-auto max-w-4xl px-6 py-10 space-y-8">
      <header>
        <p
          className="text-xs uppercase tracking-[0.3em]"
          style={{ color: "var(--ink-muted)" }}
        >
          Case · {caseRow.visaType}
        </p>
        <h1
          className="mt-2 text-2xl tracking-tight"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Filing package · {beneficiary.fullName ?? "Unnamed beneficiary"}
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-muted)" }}>
          {approved.length > 0
            ? `${approved.length} approved output${approved.length === 1 ? "" : "s"} ready to bundle.`
            : "Approve at least one output before downloading the package."}
        </p>
      </header>

      <DisclaimerBanner />

      <Card title="What's included">
        {sorted.length === 0 ? (
          <p className="py-4 text-sm" style={{ color: "var(--ink-muted)" }}>
            No outputs approved yet.{" "}
            <Link
              href={APP_ROUTES.caseOutputs(id)}
              className="underline"
              style={{ color: "var(--ink-soft)" }}
            >
              Review outputs →
            </Link>
          </p>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {sorted.map((o, idx) => {
              const subtitle = readRecommenderName({
                outputType: o.outputType,
                metadata: o.metadata,
              });
              return (
                <li
                  key={o.id}
                  className="flex items-center justify-between py-2.5"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="text-[11px] uppercase tracking-wider"
                      style={{
                        color: "var(--ink-muted)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <p
                        className="text-sm font-medium"
                        style={{ color: "var(--ink)" }}
                      >
                        {OUTPUT_TYPE_DISPLAY[o.outputType]}
                        {subtitle ? (
                          <span
                            className="ml-2 text-xs font-normal"
                            style={{ color: "var(--ink-muted)" }}
                          >
                            · {subtitle}
                          </span>
                        ) : null}
                      </p>
                      <p
                        className="mt-0.5 text-[11px]"
                        style={{
                          color: "var(--ink-muted)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        v{o.outputVersion}
                      </p>
                    </div>
                  </div>
                  <Badge variant="success">Approved</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {sorted.length > 0 ? (
        <div className="flex justify-end">
          <PackageDownloadButton caseId={id} />
        </div>
      ) : null}
    </main>
  );
}

