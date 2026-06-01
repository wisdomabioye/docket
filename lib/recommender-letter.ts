/**
 * Single source of truth for the recommendation-letter loop — both the
 * explanatory copy AND the enforcement tokens the copy promises.
 *
 * The loop:
 *   Docket drafts a TEMPLATE → the attorney emails it to the recommender
 *   → the recommender signs it on their own letterhead → the attorney
 *   uploads the SIGNED PDF under Documents → the watermark + cover badge
 *   drop and the package is filing-ready.
 *
 * Docket does NOT send the email — the attorney does. Every surface (the
 * output-editor note, the build preview, the package notice, the preflight
 * advisory, the required-docs hint) reads its copy from here, and the PDF
 * service (`pdf/index.tsx`) reads the watermark + badge tokens — so the
 * copy can never promise a string the PDF doesn't actually stamp.
 *
 * Pure strings only — safe to import in both server and client code.
 */

/** Diagonal watermark phrase stamped on unsigned recommendation-letter
 *  pages. The PDF appends its own "· Do not file" suffix. */
export const RECOMMENDER_LETTER_WATERMARK = "DRAFT — UNSIGNED";

/** Caps badge placed on the package cover while any letter is unsigned. */
export const RECOMMENDER_LETTER_DRAFT_BADGE = "DRAFT";

/** One-line hint — e.g. the required-docs "after build" group. */
export const RECOMMENDER_LETTER_HINT =
  "Email each template to its recommender to sign, then upload the signed PDF under Documents.";

/** What happens if you download before every letter is signed — shared by
 *  the package notice and the preflight advisory detail so they match. */
export const RECOMMENDER_LETTER_DRAFT_CONSEQUENCE = `Unsigned letters ship watermarked “${RECOMMENDER_LETTER_WATERMARK}” with a ${RECOMMENDER_LETTER_DRAFT_BADGE} cover badge.`;

/**
 * Per-template instruction shown in the output editor — the start of the
 * loop, where the attorney first holds the draft. `recommender` is the
 * recommender's display name when known; falls back to "the recommender".
 */
export function recommenderLetterInstruction(
  recommender?: string | null,
): string {
  const who =
    recommender && recommender.trim() ? recommender.trim() : "the recommender";
  return `This is a template — email it to ${who} to sign on their letterhead, then upload the signed PDF under Documents. ${RECOMMENDER_LETTER_DRAFT_CONSEQUENCE}`;
}
