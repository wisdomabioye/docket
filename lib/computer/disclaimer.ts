/**
 * Mandatory disclaimer rendered on every generated output.
 *
 * Stage 07 spec §10 + open_issues #25: attorney is the quality bar; we
 * neither auto-verify legal citations nor make accuracy claims. The
 * disclaimer must appear in the system prompt so the model never
 * forgets, AND in the rendered output (Stage 08) so the attorney sees
 * it before sharing.
 */
export const DISCLAIMER =
  "AI-generated. Attorney review required. Verify all citations.";
