import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { caseParticipants } from "@/server/db/schema";
import type { Db } from "@/server/db/client";

/**
 * Per-case visibility helpers — the application-layer gate that
 * complements RLS. Per CLAUDE.md §6.9 ("RLS is the safety net, not the
 * gate"), every attorney-scoped read must filter explicitly by
 * participant membership. The `is_admin()` policy bypass in
 * `0005_rls.sql` means a global admin sees every row through RLS
 * alone; these helpers stop that leak on attorney routes while
 * leaving the admin console (which intentionally queries unfiltered
 * via `is_admin()`) unchanged.
 *
 * Role-agnostic by design — `case_participants.role` may be
 * `attorney`, `paralegal`, `applicant`, or `observer`, all of which
 * are legitimate viewers. Phase 2 will add applicants as participants
 * on their own cases; this contract already covers that path.
 */

/**
 * Predicate: user is an active participant on the case. Returns the
 * raw boolean so callers can decide between "throw NOT_FOUND" (single
 * reads) and "return empty" (list aggregates).
 */
export async function isUserCaseParticipant(
  db: Db,
  caseId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: caseParticipants.id })
    .from(caseParticipants)
    .where(
      and(
        eq(caseParticipants.caseId, caseId),
        eq(caseParticipants.userId, userId),
        isNull(caseParticipants.removedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}
