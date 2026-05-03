import "server-only";

/**
 * Rough wall-clock estimate (minutes) for a build, displayed in the
 * `case.build_started` email. The model is intentionally simple — the
 * email copy already sets expectation as approximate ("around N minutes").
 *
 *   baseline 5 min + 30 sec per uploaded document
 *
 * Clamp 5..30 so a doc-less or doc-heavy case doesn't return absurd
 * copy (the build pipeline itself enforces budget caps; a 60-doc case
 * still completes in single-digit minutes thanks to the per-output
 * fan-out).
 *
 * Stays alongside the notification events because it's the only caller
 * of this formula and the only reader of the resulting `etaMinutes`
 * payload field — keeping them adjacent prevents drift.
 */
export function buildEtaMinutes(documentCount: number): number {
  const raw = Math.round(5 + documentCount * 0.5);
  if (raw < 5) return 5;
  if (raw > 30) return 30;
  return raw;
}
