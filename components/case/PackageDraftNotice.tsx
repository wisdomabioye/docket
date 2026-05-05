import Link from "next/link";
import { APP_ROUTES } from "@/config";

/**
 * Amber notice banner shown on the package page when the case has
 * recommenders without matching signed-letter uploads. Renders only
 * when `recommenderCount > 0` and `signedLetterCount < recommenderCount`
 * — callers render `null` (i.e. don't render this) otherwise.
 *
 * Why a separate banner instead of relying on the preflight advisory
 * row: the advisory row says *what's missing*; this banner says *what
 * happens if you download now*. Different jobs, both worth saying.
 */
export type PackageDraftNoticeProps = {
  caseId: string;
  recommenderCount: number;
  signedLetterCount: number;
};

export function PackageDraftNotice(
  props: PackageDraftNoticeProps,
): React.ReactElement | null {
  if (props.recommenderCount === 0) return null;
  if (props.signedLetterCount >= props.recommenderCount) return null;

  const missing = props.recommenderCount - props.signedLetterCount;
  return (
    <section
      role="status"
      aria-label="Signed recommendation letters pending"
      data-component="package-draft-notice"
      className="rounded-md border p-4"
      style={{
        borderColor: "var(--warning, #b1830e)",
        background: "var(--warning-soft, #fbf3df)",
      }}
    >
      <p
        className="text-[10px] uppercase tracking-[0.22em]"
        style={{ color: "var(--warning, #8a4a13)" }}
      >
        Drafts only — do not file
      </p>
      <h3
        className="mt-1 text-base font-medium"
        style={{ color: "var(--ink)" }}
      >
        Signed recommendation letters not yet uploaded
      </h3>
      <p
        className="mt-2 text-sm leading-relaxed"
        style={{ color: "var(--ink-soft, var(--ink))" }}
      >
        {props.signedLetterCount} of {props.recommenderCount} signed letter
        {props.recommenderCount === 1 ? "" : "s"} uploaded.{" "}
        {missing} recommendation letter
        {missing === 1 ? "" : "s"} still pending. Until every signed letter
        is uploaded on the Documents tab, downloaded packages will include
        the AI-drafted templates with a <b>DRAFT — UNSIGNED</b> watermark
        and a <b>DRAFT</b> badge on the cover.
      </p>
      <div className="mt-3 flex flex-wrap gap-4 text-xs">
        <Link
          href={APP_ROUTES.caseDocuments(props.caseId)}
          className="underline-offset-2 hover:underline"
          style={{ color: "var(--ink)" }}
        >
          Upload signed letters →
        </Link>
      </div>
    </section>
  );
}
