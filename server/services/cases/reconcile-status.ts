import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { cases } from "@/server/db/schema";
import type { Db } from "@/server/db/client";
import { AppError } from "@/lib/errors";
import { type CaseStatus } from "@/lib/case-status";
import { transitionCase } from "@/server/services/cases/transition";
import { summarizeOutputApprovals } from "@/server/services/output";

/**
 * Post-build lifecycle reconciler (ADR-006).
 *
 * Single writer for `draft_ready → in_review → approved → delivered →
 * filed` plus the admin reverse `filed → delivered`. Mirrors the
 * pattern `server/services/cases/readiness.ts` already uses for
 * `documents_pending → extracting → ready_to_build`.
 *
 * Why a reconciler and not inline status writes per mutation: the
 * post-build statuses are a function of cumulative observable state
 * (approval tally, package timestamps, filed timestamp), not single
 * events. Writing status inline at each mutation would duplicate "is
 * everything approved? has the package been compiled?" logic across
 * five procedures.
 *
 * Concurrency contract:
 *   - Caller must pass an OWNER-scoped tx (`ownerDb.transaction`).
 *     User-scoped tx is forbidden — RLS could underread the tally and
 *     produce wrong transitions silently. The type is `Db` to match
 *     `transitionCase`; the contract is enforced by convention +
 *     code review, the same way `transitionCase` does.
 *   - First statement is `select … for update` on the `cases` row to
 *     serialize concurrent reconciler calls. `transitionCase` will
 *     re-take the same lock; PG no-ops on re-locking by the same tx.
 *   - Lifecycle column writes are scheduled by callers (e.g.
 *     `downloadPackage` sets `delivered_at = now()`); the reconciler
 *     reads, decides, and transitions.
 *
 * Analytics: the reconciler does NOT emit. Callers emit
 * `case.lifecycle_transition` AFTER their `await ownerDb.transaction(...)`
 * resolves successfully — emitting from inside the tx callback would
 * fire on rolled-back transitions. The reconciler returns
 * `{from, to, changed, allApproved}`; the caller has everything
 * needed to drive both notification fan-out and analytics.
 */

export type ReconcileTrigger =
  | "output_approval_changed"
  | "output_edited"
  | "package_delivered"
  | "filed_marked"
  | "unfiled";

export type LifecycleSignals = {
  /** `total > 0 && approved === total` over current, non-deleted,
   *  non-internal outputs. Mirrors `summarizeOutputApprovals` exactly. */
  allApproved: boolean;
  packageCompiledAt: Date | null;
  deliveredAt: Date | null;
  filedAt: Date | null;
};

type Actor =
  | { type: "user"; userId: string }
  | { type: "system" }
  | { type: "computer" };

export type LifecycleRule = {
  from: CaseStatus;
  trigger: ReconcileTrigger;
  predicate: (s: LifecycleSignals) => boolean;
  to: CaseStatus;
};

/**
 * Single source of truth for the post-build (status × trigger × signal)
 * → next status mapping. The reconciler iterates top-to-bottom; first
 * matching row wins.
 *
 * Phase 1 deliberately does NOT write `needs_revision` or `package_ready`
 * (ADR-006 sub-decisions 1 + 4). The legal edges stay in
 * `lib/case-status.ts` so Phase 2 can light those statuses up by
 * appending one rule here and one row in the unit test table.
 *
 * Adding a rule is a deliberate, reviewed change — `tests/unit/
 * reconcile-status.test.ts` imports this constant directly and asserts
 * every row maps to a `canTransition`-legal edge.
 */
export const LIFECYCLE_RULES: ReadonlyArray<LifecycleRule> = [
  // First attorney interaction post-build: any save/restore drives
  // `draft_ready → in_review`, regardless of approval state.
  {
    from: "draft_ready",
    trigger: "output_edited",
    predicate: () => true,
    to: "in_review",
  },
  // Approve flips on `draft_ready` — if the same click flips the case
  // to "all approved" we skip `in_review` and land directly on
  // `approved` (state machine allows the shortcut via in_review's
  // intermediate). The legal edge from draft_ready is in_review only,
  // so we always go through in_review for the all-approved case too.
  {
    from: "draft_ready",
    trigger: "output_approval_changed",
    predicate: () => true,
    to: "in_review",
  },
  // Standard review flow.
  {
    from: "in_review",
    trigger: "output_approval_changed",
    predicate: (s) => s.allApproved,
    to: "approved",
  },
  // Backslide from approved: any unapprove or regenerate-induced
  // unapprove drops the tally and we return to in_review. Phase 1
  // does NOT write `needs_revision` here (ADR-006 sub-decision 1).
  {
    from: "approved",
    trigger: "output_approval_changed",
    predicate: (s) => !s.allApproved,
    to: "in_review",
  },
  // Package handed off. `package_ready` is collapsed (ADR-006 sub-
  // decision 4) — we go straight from approved to delivered.
  {
    from: "approved",
    trigger: "package_delivered",
    predicate: () => true,
    to: "delivered",
  },
  // Attorney marks the case filed with USCIS.
  {
    from: "delivered",
    trigger: "filed_marked",
    predicate: () => true,
    to: "filed",
  },
  // Admin operational reverse — never reachable from the attorney UI.
  {
    from: "filed",
    trigger: "unfiled",
    predicate: () => true,
    to: "delivered",
  },
];

export type ReconcileResult = {
  from: CaseStatus;
  to: CaseStatus;
  changed: boolean;
  allApproved: boolean;
};

/** Hard cap on fixed-point iterations. The longest legal Phase 1
 *  chain a single trigger can drive is `draft_ready → in_review →
 *  approved` (2 hops), so 8 is generous insurance against a future
 *  rule pair forming a cycle. Hitting it indicates a bug in
 *  `LIFECYCLE_RULES` and surfaces as a CONFLICT. */
const MAX_RECONCILE_HOPS = 8;

export async function reconcileCaseStatus(args: {
  /** Owner-scoped tx (RLS bypassed). User-scoped tx is forbidden —
   *  see header. */
  tx: Db;
  caseId: string;
  trigger: ReconcileTrigger;
  /** Threaded to `transitionCase` for the `case_events` row. */
  actor: Actor;
  /** Optional reason string forwarded to `case_events.details.reason`. */
  reason?: string;
}): Promise<ReconcileResult> {
  const { tx, caseId, trigger, actor } = args;

  // Lock the case row for the rest of the tx. Two concurrent reconciler
  // calls on the same case serialize here — only one observes the
  // pre-flip state and drives the transition; the second sees the
  // post-flip state and no-ops (or drives the next legal edge).
  const [row] = await tx
    .select({
      status: cases.status,
      packageCompiledAt: cases.packageCompiledAt,
      deliveredAt: cases.deliveredAt,
      filedAt: cases.filedAt,
    })
    .from(cases)
    .where(and(eq(cases.id, caseId), isNull(cases.deletedAt)))
    .limit(1)
    .for("update");

  if (!row) {
    throw new AppError("NOT_FOUND", `case ${caseId} not found`);
  }

  const from = row.status as CaseStatus;

  // Tally read happens inside the lock so concurrent approves can't
  // both observe `allApproved` and race the transition. Reuses the
  // same SQL `summarizeOutputApprovals` already uses for the dashboard,
  // so the tally definition (current + non-deleted, internals excluded)
  // is identical here and there.
  const tally = await summarizeOutputApprovals({
    db: tx,
    caseIds: [caseId],
  });
  const counts = tally.get(caseId) ?? { approved: 0, total: 0 };
  const allApproved = counts.total > 0 && counts.approved === counts.total;

  const signals: LifecycleSignals = {
    allApproved,
    packageCompiledAt: row.packageCompiledAt,
    deliveredAt: row.deliveredAt,
    filedAt: row.filedAt,
  };

  // Fixed-point iteration. A single trigger can drive a multi-hop chain
  // (e.g. `draft_ready + output_approval_changed` with all-approved
  // signals: hop 1 `draft_ready → in_review`; hop 2 `in_review →
  // approved`). Without iteration the case ends up stuck mid-chain.
  // Signals don't change across hops within one call — outputs and
  // timestamps are unchanged. Each rule's `from` differs from `to`
  // (asserted by `canTransition`), so progress is monotone; the hop
  // cap is belt-and-suspenders.
  let current = from;
  for (let hop = 0; hop < MAX_RECONCILE_HOPS; hop++) {
    const rule = LIFECYCLE_RULES.find(
      (r) =>
        r.from === current && r.trigger === trigger && r.predicate(signals),
    );
    if (!rule) break;

    await transitionCase({
      tx,
      caseId,
      toStatus: rule.to,
      actor,
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
    });
    current = rule.to;
  }

  if (current === from) {
    // Final-loop iteration found no rule and we never moved. The
    // `MAX_RECONCILE_HOPS` cap is asymmetric: hitting it would leave
    // `current !== from` but a rule still matching, which means a
    // cycle in `LIFECYCLE_RULES` — caught by the unit test that
    // walks every legal edge.
    return { from, to: from, changed: false, allApproved };
  }

  return { from, to: current, changed: true, allApproved };
}
