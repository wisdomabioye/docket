import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  attorneyProfiles,
  caseEvents,
  caseParticipants,
  cases,
  organizationMembers,
  organizations,
  userRoles,
  users,
} from "@/server/db/schema";
import { protectedProcedure, router } from "@/server/api/trpc";
import { bn, extractBeneficiaryFullName } from "@/server/db/helpers";
import { PIPELINE_STATUSES } from "@/lib/pipeline";
import { deriveCaseStage } from "@/lib/case-stage";
import {
  DRAFTS_AWAITING_REVIEW_STATUSES,
  INACTIVE_STATUSES,
  TODAY_ACTIONABLE_STATUSES,
  type CaseStatus,
} from "@/lib/case-status";

/**
 * `me.*` — first protected router. Smoke-tests the entire stack:
 * Auth.js session → tRPC context → withDb middleware → RLS-engaged query.
 *
 * Stage 11 added the dashboard-feed procedures: `pipelineCounts` (sidebar
 * badges), `dashboardKpis` (KPI strip), `todayTasks` (right-rail) and
 * `activityFeed`. All RLS-scoped to the caller; the `case_participants`
 * join is the additional guard against a non-primary attorney leaking
 * data through a misconfigured policy.
 */

// Pipeline buckets imported from `lib/pipeline.ts` so the sidebar
// labels, the `?stage=...` URL filter, and these aggregate counts all
// agree on which case statuses belong together. Status arrays
// (`INACTIVE_STATUSES`, `TODAY_ACTIONABLE_STATUSES`,
// `DRAFTS_AWAITING_REVIEW_STATUSES`) live in `lib/case-status.ts` so
// future status additions land in one file.

const TODAY_TASK_LIMIT = 6;
const ACTIVITY_FEED_LIMIT = 8;

export const meRouter = router({
  current: protectedProcedure.query(async ({ ctx }) => {
    const { db, userId } = ctx;

    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        timezone: users.timezone,
        locale: users.locale,
      })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (!user) {
      // RLS denied or row truly missing. Either way the session is bad.
      return null;
    }

    const roles = await db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, userId));

    const memberships = await db
      .select({
        organizationId: organizationMembers.organizationId,
        role: organizationMembers.role,
        organizationName: organizations.name,
        organizationSlug: organizations.slug,
      })
      .from(organizationMembers)
      .innerJoin(
        organizations,
        eq(organizationMembers.organizationId, organizations.id),
      )
      .where(
        and(
          eq(organizationMembers.userId, userId),
          isNull(organizationMembers.removedAt),
        ),
      );

    const [profile] = await db
      .select({
        status: attorneyProfiles.status,
        barNumber: attorneyProfiles.barNumber,
        barStates: attorneyProfiles.barStates,
        submittedAt: attorneyProfiles.submittedAt,
        agreementSignedAt: attorneyProfiles.agreementSignedAt,
      })
      .from(attorneyProfiles)
      .where(
        and(
          eq(attorneyProfiles.userId, userId),
          isNull(attorneyProfiles.deletedAt),
        ),
      )
      .limit(1);

    return {
      user,
      roles: roles.map((r) => r.role),
      memberships,
      attorneyProfile: profile ?? null,
    };
  }),

  /**
   * Pipeline count badges shown in the attorney sidebar. Single SQL
   * round-trip — five `COUNT(*) FILTER (WHERE status IN ...)` aggregates
   * over the caller's primary-attorney cases.
   *
   * Returns zero counts for an attorney with no cases (vs. throwing) so
   * the sidebar renders consistently from day one.
   */
  pipelineCounts: protectedProcedure.query(async ({ ctx }) => {
    const { db, userId } = ctx;

    const [row] = await db
      .select({
        intake: sql<number>`count(*) filter (where ${cases.status} in ${statusTupleSql(PIPELINE_STATUSES.intake)})::int`,
        documents: sql<number>`count(*) filter (where ${cases.status} in ${statusTupleSql(PIPELINE_STATUSES.documents)})::int`,
        drafting: sql<number>`count(*) filter (where ${cases.status} in ${statusTupleSql(PIPELINE_STATUSES.drafting)})::int`,
        review: sql<number>`count(*) filter (where ${cases.status} in ${statusTupleSql(PIPELINE_STATUSES.review)})::int`,
        filed: sql<number>`count(*) filter (where ${cases.status} in ${statusTupleSql(PIPELINE_STATUSES.filed)})::int`,
      })
      .from(cases)
      .innerJoin(
        caseParticipants,
        and(
          eq(caseParticipants.caseId, cases.id),
          eq(caseParticipants.userId, userId),
          eq(caseParticipants.isPrimary, true),
          isNull(caseParticipants.removedAt),
        ),
      )
      .where(isNull(cases.deletedAt));

    return {
      intake: row?.intake ?? 0,
      documents: row?.documents ?? 0,
      drafting: row?.drafting ?? 0,
      review: row?.review ?? 0,
      filed: row?.filed ?? 0,
    };
  }),

  /**
   * Dashboard headline KPIs. Four metrics:
   *   - activeCases:      not-archived count.
   *   - draftsAwaitingReview: cases in `draft_ready` / `needs_revision`.
   *   - filedThisQuarter: cases with `filedAt >= start_of_quarter`.
   *   - revenueMtdCents:  sum of `docket_share_cents` for cases filed
   *                       in the current month, regardless of revenue
   *                       status (paid + invoiced + pending all count).
   *
   * One round-trip; aggregates returned as integers / bigint via `bn()`.
   */
  dashboardKpis: protectedProcedure.query(async ({ ctx }) => {
    const { db, userId } = ctx;
    const now = new Date();
    // Inline as SQL timestamp literals — postgres-js can't bind a JS
    // `Date` through a raw `sql\`\`` template fragment (the operator
    // helpers like `gte` work, but they don't compose inside `count(*)
    // FILTER (...)`). Server-derived ISO strings are safe to inline.
    const startOfQuarterLit = sql.raw(
      `'${quarterStartUtc(now).toISOString()}'::timestamptz`,
    );
    const startOfMonthLit = sql.raw(
      `'${monthStartUtc(now).toISOString()}'::timestamptz`,
    );

    const [row] = await db
      .select({
        activeCases: sql<number>`count(*) filter (where ${cases.status} not in ${statusTupleSql(INACTIVE_STATUSES)})::int`,
        draftsAwaitingReview: sql<number>`count(*) filter (where ${cases.status} in ${statusTupleSql(DRAFTS_AWAITING_REVIEW_STATUSES)})::int`,
        filedThisQuarter: sql<number>`count(*) filter (where ${cases.filedAt} >= ${startOfQuarterLit})::int`,
        revenueMtdCents: sql<bigint>`coalesce(sum(${cases.docketShareCents}) filter (where ${cases.filedAt} >= ${startOfMonthLit}), 0)::bigint`,
      })
      .from(cases)
      .innerJoin(
        caseParticipants,
        and(
          eq(caseParticipants.caseId, cases.id),
          eq(caseParticipants.userId, userId),
          eq(caseParticipants.isPrimary, true),
          isNull(caseParticipants.removedAt),
        ),
      )
      .where(isNull(cases.deletedAt));

    return {
      activeCases: row?.activeCases ?? 0,
      draftsAwaitingReview: row?.draftsAwaitingReview ?? 0,
      filedThisQuarter: row?.filedThisQuarter ?? 0,
      revenueMtdCents: bn(row?.revenueMtdCents),
    };
  }),

  /**
   * Right-rail "Today" list. Up to `TODAY_TASK_LIMIT` cases that need
   * the attorney to act — drafts ready, intake-stalled documents, or
   * a build that failed. Sorted by SLA-overdue first, then most-recent
   * activity.
   *
   * The label/sub copy is derived per-status so a caller (server
   * component) can render without further lookups; future Stage 11
   * polish may introduce a real `case_tasks` table, at which point
   * this procedure switches to that table without a UI change.
   */
  todayTasks: protectedProcedure.query(async ({ ctx }) => {
    const { db, userId } = ctx;
    const rows = await db
      .select({
        id: cases.id,
        status: cases.status,
        beneficiaryData: cases.beneficiaryData,
        reviewSlaHours: cases.reviewSlaHours,
        updatedAt: cases.updatedAt,
        // Hours since updatedAt — used to flag "overdue" entries.
        ageHours: sql<number>`extract(epoch from (now() - ${cases.updatedAt}))::numeric / 3600`,
      })
      .from(cases)
      .innerJoin(
        caseParticipants,
        and(
          eq(caseParticipants.caseId, cases.id),
          eq(caseParticipants.userId, userId),
          eq(caseParticipants.isPrimary, true),
          isNull(caseParticipants.removedAt),
        ),
      )
      .where(
        and(
          isNull(cases.deletedAt),
          inArray(cases.status, [...TODAY_ACTIONABLE_STATUSES]),
        ),
      )
      .orderBy(
        // Overdue first (age > sla), then most-recently updated. Boolean
        // expression sorts true before false under DESC.
        sql`((extract(epoch from (now() - ${cases.updatedAt}))::numeric / 3600) > ${cases.reviewSlaHours}) desc`,
        desc(cases.updatedAt),
      )
      .limit(TODAY_TASK_LIMIT);

    return rows.map((r) => {
      const ageHours = Number(r.ageHours);
      const overdue = ageHours > (r.reviewSlaHours ?? 72);
      const beneficiary = extractBeneficiaryFullName(r.beneficiaryData);
      const stage = deriveCaseStage({ status: r.status });
      const who = beneficiary ?? "Unnamed beneficiary";
      // Today rail is action-oriented: prefer the stage's CTA copy
      // for the label ("Upload evidence · {who}") and fall back to
      // the stage name when no CTA exists. `TODAY_ACTIONABLE_STATUSES`
      // is curated to statuses that DO have a nextAction, so the
      // fallback path should be unreachable in practice — kept for
      // type safety.
      const action = stage.nextAction ?? stage.label;
      return {
        id: r.id,
        status: r.status,
        beneficiary,
        overdue,
        label: `${action} · ${who}`,
        sub: stage.sub,
      };
    });
  }),

  /**
   * Right-rail recent-activity feed. Newest `ACTIVITY_FEED_LIMIT`
   * `case_events` rows across all cases the caller is a participant of.
   * RLS scopes the events to the caller's cases via the
   * `case_events_participant_read` policy (0005_rls.sql).
   */
  activityFeed: protectedProcedure.query(async ({ ctx }) => {
    const { db, userId } = ctx;
    const rows = await db
      .select({
        id: caseEvents.id,
        caseId: caseEvents.caseId,
        actorType: caseEvents.actorType,
        eventType: caseEvents.eventType,
        createdAt: caseEvents.createdAt,
        beneficiaryData: cases.beneficiaryData,
      })
      .from(caseEvents)
      .innerJoin(cases, eq(cases.id, caseEvents.caseId))
      .innerJoin(
        caseParticipants,
        and(
          eq(caseParticipants.caseId, cases.id),
          eq(caseParticipants.userId, userId),
          isNull(caseParticipants.removedAt),
        ),
      )
      .where(
        and(isNull(cases.deletedAt), isNotNull(caseEvents.createdAt)),
      )
      .orderBy(desc(caseEvents.createdAt))
      .limit(ACTIVITY_FEED_LIMIT);

    return rows.map((r) => ({
      id: r.id,
      caseId: r.caseId,
      actorType: r.actorType,
      eventType: r.eventType,
      beneficiary: extractBeneficiaryFullName(r.beneficiaryData),
      createdAt: r.createdAt,
    }));
  }),
});

/** Inline `IN (...)` tuple literal for the count-filter clauses.
 *  Drizzle's `inArray` doesn't compose inside `count(*) FILTER`, so
 *  we render the tuple ourselves. Input type is constrained to
 *  `CaseStatus[]` — the only legal interpolations are enum values from
 *  `caseStatusEnum`, sourced via `lib/case-status.ts` or
 *  `lib/pipeline.ts`. That keeps user data out by construction; the
 *  `sql.raw` interpolation is safe under this contract. */
function statusTupleSql(
  statuses: ReadonlyArray<CaseStatus>,
): ReturnType<typeof sql> {
  return sql.raw(`(${statuses.map((s) => `'${s}'`).join(",")})`);
}

function quarterStartUtc(now: Date): Date {
  const quarterMonth = Math.floor(now.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(now.getUTCFullYear(), quarterMonth, 1));
}

function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

