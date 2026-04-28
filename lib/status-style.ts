import type { BadgeVariant } from "@/components/ui/Badge";
import type { CaseStatus } from "@/lib/case-status";
import type { AttorneyStatus } from "@/lib/constants";

/**
 * Status → `BadgeVariant` mappings. Centralized here (not inline in
 * pages) so the same status renders with the same color across surfaces:
 * dashboard KPIs, list tables, audit log message tags, etc.
 *
 * Adding a new enum value: TypeScript fails the `Record` constraint
 * until you map the new key, so visual treatment can't drift.
 */

export const attorneyStatusVariant: Record<AttorneyStatus, BadgeVariant> = {
  active: "success",
  pending: "warning",
  suspended: "error",
  inactive: "neutral",
};

export const caseStatusVariant: Record<CaseStatus, BadgeVariant> = {
  intake: "neutral",
  documents_pending: "neutral",
  extracting: "neutral",
  ready_to_build: "accent",
  building: "accent",
  build_failed: "warning",
  draft_ready: "accent",
  in_review: "warning",
  needs_revision: "warning",
  approved: "success",
  package_ready: "success",
  delivered: "success",
  filed: "success",
  archived: "neutral",
};

/** Waitlist approval is binary (approved vs awaiting). */
export function waitlistApprovalVariant(approved: boolean): BadgeVariant {
  return approved ? "success" : "warning";
}
