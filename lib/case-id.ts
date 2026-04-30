/**
 * Single source of truth for case-id presentation. Three earlier copies
 * (Caseline, CaseHeader, AttorneyTopbar) drifted into two visual
 * formats — `CASE-1111` vs `Case 11111111`. Centralised here so a
 * future format change ripples through every UI surface.
 *
 * Keep both helpers tiny and pure — no React, no domain imports — so
 * they're trivially unit-testable and safe to import from anywhere.
 */

/**
 * Compact short id for tabular contexts: `CASE-1111`. The 4-char
 * upper-cased prefix mirrors the mockups' `.caseline .sub` slot. The
 * UUID's first 4 hex chars are 65,536 buckets — enough for the dozens
 * of cases per attorney without collisions in any single sidebar /
 * dashboard view; full UUID still rules in URLs and the database.
 */
export function shortCaseId(uuid: string): string {
  return `CASE-${uuid.slice(0, 4).toUpperCase()}`;
}

/**
 * Human-prose label for breadcrumbs / titles where "CASE-1111" reads
 * too coded. Returns `Case 1111` (same 4-char prefix, same case as
 * `shortCaseId`, just unprefixed and with a space). Replaces the
 * legacy `Case xxxxxxxx` 8-char form so every UI surface uses the
 * same identifier.
 */
export function shortCaseLabel(uuid: string): string {
  return `Case ${uuid.slice(0, 4).toUpperCase()}`;
}
