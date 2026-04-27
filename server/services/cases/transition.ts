import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { caseEvents, cases } from "@/server/db/schema";
import type { Db } from "@/server/db/client";
import { AppError } from "@/lib/errors";
import {
  canTransition,
  legalNextStatuses,
  type CaseStatus,
} from "@/lib/case-status";

/**
 * The single mutation path for `cases.status`. Every status change in the
 * codebase MUST go through here. The state machine in `lib/case-status.ts`
 * is enforced; an illegal transition throws `AppError("CONFLICT", ...)`.
 *
 * Side effects:
 *   - Updates `cases.status`
 *   - Writes a `case_events` row tagged `case.status_changed`
 *
 * Caller passes the open transaction (`tx`) so the status flip and the
 * event row land atomically. Optimistic concurrency: pass `expectedRowRevision`
 * to detect concurrent edits.
 */
export async function transitionCase(args: {
  tx: Db;
  caseId: string;
  toStatus: CaseStatus;
  actor:
    | { type: "user"; userId: string }
    | { type: "system" }
    | { type: "computer" };
  reason?: string;
  expectedRowRevision?: number;
}): Promise<{ from: CaseStatus; to: CaseStatus }> {
  const { tx, caseId, toStatus } = args;

  // `for("update")` locks the row for the rest of this transaction so two
  // concurrent transitions can't both pass `canTransition` and both write
  // status_changed events. Without it, the SELECT-then-UPDATE pattern
  // races at READ COMMITTED isolation.
  const [current] = await tx
    .select({
      id: cases.id,
      status: cases.status,
      rowRevision: cases.rowRevision,
    })
    .from(cases)
    .where(and(eq(cases.id, caseId), isNull(cases.deletedAt)))
    .limit(1)
    .for("update");

  if (!current) {
    throw new AppError("NOT_FOUND", `case ${caseId} not found`);
  }

  if (
    args.expectedRowRevision !== undefined &&
    current.rowRevision !== args.expectedRowRevision
  ) {
    throw new AppError(
      "CONFLICT",
      `case was modified by another writer (revision ${current.rowRevision}, expected ${args.expectedRowRevision})`,
    );
  }

  const fromStatus = current.status as CaseStatus;
  if (fromStatus === toStatus) {
    // Idempotent no-op — same status, no event written.
    return { from: fromStatus, to: toStatus };
  }
  if (!canTransition(fromStatus, toStatus)) {
    throw new AppError(
      "CONFLICT",
      `illegal status transition ${fromStatus} → ${toStatus}; legal next: ${legalNextStatuses(fromStatus).join(", ") || "(none — terminal)"}`,
    );
  }

  await tx
    .update(cases)
    .set({ status: toStatus })
    .where(eq(cases.id, caseId));

  await tx.insert(caseEvents).values({
    caseId,
    actorType: args.actor.type,
    actorUserId: args.actor.type === "user" ? args.actor.userId : null,
    eventType: "case.status_changed",
    details: {
      from: fromStatus,
      to: toStatus,
      ...(args.reason ? { reason: args.reason } : {}),
    },
  });

  return { from: fromStatus, to: toStatus };
}
