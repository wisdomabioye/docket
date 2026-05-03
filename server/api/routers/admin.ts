import { TRPCError } from "@trpc/server";
import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { bn, keysetLt } from "@/server/db/helpers";
import { z } from "zod";
import {
  attorneyProfiles,
  attorneyStatusEnum,
  auditLog,
  caseComputeLedger,
  caseParticipants,
  caseStatusEnum,
  cases,
  organizations,
  users,
  visaTypeEnum,
  waitlistEntries,
} from "@/server/db/schema";
import { adminProcedure, router } from "@/server/api/trpc";
import { withAudit } from "@/server/services/audit";
import { getRedis } from "@/server/services/redis";
import type { Db as AdminDb } from "@/server/db/client";
import type { AttorneyStatus } from "@/lib/constants";
import { emitFromCtx } from "@/server/services/analytics/emit";
import { inngest } from "@/server/jobs/client";
import { adminInviteNotificationEvent } from "@/server/services/email/notifications";

// ─────────────────────────────────────────────────────────────────────────
// Module-level constants + helpers used by Stage 09 procedures. Declared
// above the router export so the procedure schemas can reference them.
// ─────────────────────────────────────────────────────────────────────────

const LIST_PAGE_SIZE = 25;

const PERIODS = ["7d", "30d", "MTD", "QTD", "YTD", "ALL"] as const;

/** Maps a `Period` to a Postgres interval literal. `ALL` and `MTD/QTD/YTD`
 *  use the simple "last N days" approximation in Stage 09 — Stage 10 will
 *  align these to calendar boundaries (start of month etc.) once accounting
 *  needs the exact bucketing. */
const PERIOD_INTERVAL: Record<(typeof PERIODS)[number], string | null> = {
  "7d": "7 days",
  "30d": "30 days",
  MTD: "30 days",
  QTD: "90 days",
  YTD: "365 days",
  ALL: null,
};

/** Build a human-readable message for an audit row. Falls back to the
 *  raw action when no template matches — better than empty text. */
function summarizeAuditAction(e: {
  action: string;
  details: unknown;
  targetType: string;
}): string {
  const d =
    e.details && typeof e.details === "object"
      ? (e.details as Record<string, unknown>)
      : null;
  const email = typeof d?.email === "string" ? d.email : null;
  const reason = typeof d?.reason === "string" ? d.reason : null;

  switch (e.action) {
    case "attorney.activate":
      return `Activated attorney${reason ? ` — ${reason}` : ""}`;
    case "waitlist.approve":
      return `Approved waitlist invite${email ? ` for ${email}` : ""}`;
    case "admin.bootstrap":
      return "Founder bootstrap — first admin granted via env var";
    default:
      return `${e.action} on ${e.targetType}`;
  }
}

/** Read an attorney profile by `userId` or throw NOT_FOUND. Used by
 *  both `activateAttorney` and `suspendAttorney` — the shape of the
 *  read + the error semantics are identical. Without this helper,
 *  every new admin mutation that targets an attorney would re-implement
 *  the same select + null check, drifting in subtle ways (e.g. one
 *  call site forgetting `isNull(deletedAt)`). */
async function fetchAttorneyProfileOrThrow(
  db: AdminDb,
  userId: string,
): Promise<{
  id: string;
  status: AttorneyStatus;
  submittedAt: Date | null;
}> {
  const [profile] = await db
    .select({
      id: attorneyProfiles.id,
      status: attorneyProfiles.status,
      submittedAt: attorneyProfiles.submittedAt,
    })
    .from(attorneyProfiles)
    .where(
      and(
        eq(attorneyProfiles.userId, userId),
        isNull(attorneyProfiles.deletedAt),
      ),
    )
    .limit(1);
  if (!profile) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Attorney profile not found",
    });
  }
  return profile;
}

/**
 * Admin-only procedures. Stage 09 expands this into the full admin
 * dashboard (revenue, compute, audit log browser). Stage 03 ships the
 * minimum needed to activate pending attorneys.
 */

export const adminRouter = router({
  /**
   * Cheapest possible admin probe. The layout calls this once per page
   * load to gate access; an admin gets `{ ok: true }`, a non-admin gets
   * `FORBIDDEN` from `adminProcedure`. No DB scans, no joins — just the
   * `is_admin()` SECURITY DEFINER check that `adminProcedure` already
   * runs. Cheaper than `listPendingAttorneys` (the prior probe) which
   * hit two tables for data we discarded.
   */
  ping: adminProcedure.query(() => ({ ok: true as const })),

  /** Attorneys waiting for activation — most recent submissions first. */
  listPendingAttorneys: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        barNumber: attorneyProfiles.barNumber,
        barStates: attorneyProfiles.barStates,
        submittedAt: attorneyProfiles.submittedAt,
        agreementSignedAt: attorneyProfiles.agreementSignedAt,
      })
      .from(attorneyProfiles)
      .innerJoin(users, eq(users.id, attorneyProfiles.userId))
      .where(
        and(
          eq(attorneyProfiles.status, "pending"),
          isNotNull(attorneyProfiles.submittedAt),
          isNull(attorneyProfiles.deletedAt),
          // Hide soft-deleted users even if their profile is intact.
          isNull(users.deletedAt),
        ),
      )
      .orderBy(desc(attorneyProfiles.submittedAt));
    return rows;
  }),

  activateAttorney: adminProcedure
    .input(
      z.object({
        userId: z.uuid(),
        // `.min(1)` rejects the empty string up front. Without it,
        // `reason: ""` would silently coerce to null details.
        reason: z.string().min(1).max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db, userId: adminId } = ctx;
      const profile = await fetchAttorneyProfileOrThrow(db, input.userId);

      if (profile.status === "active") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Attorney is already active",
        });
      }
      if (!profile.submittedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Attorney has not submitted onboarding yet",
        });
      }

      return await withAudit(
        {
          db,
          adminId,
          action: "attorney.activate",
          targetType: "user",
          targetId: input.userId,
          ...(input.reason !== undefined
            ? { detailsFrom: () => ({ reason: input.reason }) }
            : {}),
        },
        async () => {
          await db
            .update(attorneyProfiles)
            .set({ status: "active" })
            .where(eq(attorneyProfiles.id, profile.id));
          // Two emits: the lifecycle "activated" milestone AND the
          // generic "status_changed" so dashboards that watch transitions
          // (pending → active, suspended → active, etc.) see all of them.
          //
          // Identity: `attorney_id` / `target_attorney_id` is `users.id`
          // (the same identity used by `posthog.identify()` and across
          // RLS / audit log) — NOT `attorneyProfiles.id`, which would
          // make these events unjoinable with the rest of the user
          // event stream in PostHog.
          emitFromCtx(ctx, {
            name: "attorney.activated",
            properties: { attorney_id: input.userId },
          });
          emitFromCtx(ctx, {
            name: "admin.attorney_status_changed",
            properties: {
              target_attorney_id: input.userId,
              from_status: profile.status,
              to_status: "active",
            },
          });
          return { ok: true as const };
        },
      );
    }),

  /**
   * Waitlist + invite gate. Newest-first paginated stream of non-deleted
   * entries with approver email joined; `approveWaitlistEntry` flips the
   * row from pending → approved.
   *
   * Keyset cursor `(createdAt, id)` matches the other admin listings.
   */
  listWaitlist: adminProcedure
    .input(
      z
        .object({
          cursor: z
            .object({
              createdAt: z.iso.datetime(),
              id: z.uuid(),
            })
            .optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const { db } = ctx;
      const approver = alias(users, "approver");

      const filters = [isNull(waitlistEntries.deletedAt)];
      if (input?.cursor) {
        filters.push(
          keysetLt(waitlistEntries.createdAt, waitlistEntries.id, input.cursor),
        );
      }

      // Items + totals — independent reads, fan out.
      const [rows, countsRows] = await Promise.all([
        db
          .select({
            id: waitlistEntries.id,
            email: waitlistEntries.email,
            name: waitlistEntries.name,
            source: waitlistEntries.source,
            createdAt: waitlistEntries.createdAt,
            approvedAt: waitlistEntries.approvedAt,
            approvedByEmail: approver.email,
          })
          .from(waitlistEntries)
          .leftJoin(approver, eq(approver.id, waitlistEntries.approvedBy))
          .where(and(...filters))
          .orderBy(desc(waitlistEntries.createdAt), desc(waitlistEntries.id))
          .limit(LIST_PAGE_SIZE + 1),

        db
          .select({
            total: sql<number>`count(*)::int`,
            pending: sql<number>`count(*) filter (where ${waitlistEntries.approvedAt} is null)::int`,
            approved: sql<number>`count(*) filter (where ${waitlistEntries.approvedAt} is not null)::int`,
          })
          .from(waitlistEntries)
          .where(isNull(waitlistEntries.deletedAt)),
      ]);

      const hasMore = rows.length > LIST_PAGE_SIZE;
      const items = hasMore ? rows.slice(0, LIST_PAGE_SIZE) : rows;
      const counts = countsRows[0];

      const last = items[items.length - 1];
      const nextCursor =
        hasMore && last
          ? { createdAt: last.createdAt.toISOString(), id: last.id }
          : null;

      return {
        items: items.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          approvedAt: r.approvedAt?.toISOString() ?? null,
        })),
        totals: counts ?? { total: 0, pending: 0, approved: 0 },
        nextCursor,
      };
    }),

  approveWaitlistEntry: adminProcedure
    .input(z.object({ entryId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { db, userId: adminId } = ctx;

      // Atomic guard: only flip the row if it's still un-approved AND
      // not soft-deleted. `returning` tells us whether anything changed,
      // so we can distinguish "not found" from "already approved" without
      // a separate read+write race.
      const updated = await db
        .update(waitlistEntries)
        .set({ approvedAt: sql`now()`, approvedBy: adminId })
        .where(
          and(
            eq(waitlistEntries.id, input.entryId),
            isNull(waitlistEntries.approvedAt),
            isNull(waitlistEntries.deletedAt),
          ),
        )
        .returning({
          id: waitlistEntries.id,
          email: waitlistEntries.email,
          name: waitlistEntries.name,
        });

      if (updated.length === 0) {
        // Disambiguate by re-reading. Cheap; runs only on the unhappy path.
        const [existing] = await db
          .select({
            id: waitlistEntries.id,
            approvedAt: waitlistEntries.approvedAt,
            deletedAt: waitlistEntries.deletedAt,
          })
          .from(waitlistEntries)
          .where(eq(waitlistEntries.id, input.entryId))
          .limit(1);

        if (!existing || existing.deletedAt) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Waitlist entry not found",
          });
        }
        throw new TRPCError({
          code: "CONFLICT",
          message: "Waitlist entry is already approved",
        });
      }

      const row = updated[0]!;
      // Wrap the audit insert in `withAudit` for parity with the other
      // admin mutations. The row update already committed above; we
      // just write the log for the now-completed action.
      await withAudit(
        {
          db,
          adminId,
          action: "waitlist.approve",
          targetType: "waitlist_entry",
          targetId: row.id,
          detailsFrom: () => ({ email: row.email }),
        },
        async () => row,
      );

      // Best-effort invite email. The listener resolves the inviter's
      // display name from `invitedByUserId`; we pass `adminId` not
      // because the email needs to mention them, but so a future
      // change-of-copy can ("Invited by Sarah") without a schema bump.
      try {
        await inngest.send({
          name: adminInviteNotificationEvent.name,
          data: {
            inviteeEmail: row.email,
            inviteeName: row.name ?? "",
            invitedByUserId: adminId,
          },
        });
      } catch (err) {
        console.error("[notification.admin.invite] emit failed", {
          waitlistEntryId: row.id,
          err,
        });
      }

      return { ok: true as const };
    }),

  // ─────────────────────────────────────────────────────────────────────
  // Stage 09 — admin dashboard reads.
  //
  // Pattern: every read is `adminProcedure` (FORBIDDEN if not admin), uses
  // `ctx.db` (RLS engaged but `is_admin()` policies cross-org access),
  // pages with keyset cursors `(createdAt, id)` consistent with
  // `case.list`. Money is `bigint` end-to-end (superjson handles).
  //
  // Empty-state aware: revenue / compute return zero-shaped responses
  // until Stage 07/10 backfills the underlying ledger entries. Pages
  // render `EmptyState` cards based on `total === 0`, not on a missing
  // field.
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Dashboard overview KPIs + recent ops events. One round-trip for the
   * `/admin` page. Counts are cheap (covered by existing partial unique +
   * status indexes); revenue/compute aggregates fall back to zeros until
   * the relevant ledger has rows.
   */
  getOverviewMetrics: adminProcedure.query(async ({ ctx }) => {
    const { db } = ctx;

    // Four independent reads — fan out in parallel. The whole procedure
    // becomes a single round-trip's worth of latency instead of four.
    const [attorneyCountsRows, caseStatusRows, revenue7dRows, recent] =
      await Promise.all([
        db
          .select({
            active: sql<number>`count(*) filter (where ${attorneyProfiles.status} = 'active')::int`,
            pending: sql<number>`count(*) filter (where ${attorneyProfiles.status} = 'pending')::int`,
            suspended: sql<number>`count(*) filter (where ${attorneyProfiles.status} = 'suspended')::int`,
            inactive: sql<number>`count(*) filter (where ${attorneyProfiles.status} = 'inactive')::int`,
          })
          .from(attorneyProfiles)
          .where(isNull(attorneyProfiles.deletedAt)),

        db
          .select({
            status: cases.status,
            count: sql<number>`count(*)::int`,
          })
          .from(cases)
          .where(isNull(cases.deletedAt))
          .groupBy(cases.status),

        // Filed cases in the last 7 days. Returns zero `bigint`s if no
        // cases have `filed_at` yet (Stage 07/10 wires this up).
        db
          .select({
            grossCents: sql<bigint>`coalesce(sum(${cases.caseFeeCents}), 0)::bigint`,
            docketShareCents: sql<bigint>`coalesce(sum(${cases.docketShareCents}), 0)::bigint`,
            filings: sql<number>`count(*)::int`,
          })
          .from(cases)
          .where(
            and(
              isNull(cases.deletedAt),
              isNotNull(cases.filedAt),
              sql`${cases.filedAt} >= now() - interval '7 days'`,
            ),
          ),

        // Recent admin-relevant events. Joins actor email so the UI
        // doesn't need a second round-trip. Limit 10 for the Ops Inbox.
        db
          .select({
            id: auditLog.id,
            action: auditLog.action,
            targetType: auditLog.targetType,
            targetId: auditLog.targetId,
            details: auditLog.details,
            ipAddress: auditLog.ipAddress,
            createdAt: auditLog.createdAt,
            actorEmail: users.email,
          })
          .from(auditLog)
          .leftJoin(users, eq(users.id, auditLog.actorUserId))
          .orderBy(desc(auditLog.createdAt))
          .limit(10),
      ]);

    const attorneyCounts = attorneyCountsRows[0];
    const revenue7d = revenue7dRows[0];

    const casesByStatus = Object.fromEntries(
      caseStatusEnum.enumValues.map((s) => [s, 0]),
    ) as Record<(typeof caseStatusEnum.enumValues)[number], number>;
    let casesTotal = 0;
    for (const row of caseStatusRows) {
      casesByStatus[row.status] = row.count;
      casesTotal += row.count;
    }

    return {
      attorneys: attorneyCounts ?? {
        active: 0,
        pending: 0,
        suspended: 0,
        inactive: 0,
      },
      cases: { total: casesTotal, byStatus: casesByStatus },
      revenue7d: {
        grossCents: bn(revenue7d?.grossCents),
        docketShareCents: bn(revenue7d?.docketShareCents),
        filings: revenue7d?.filings ?? 0,
      },
      recentEvents: recent.map((e) => ({
        id: e.id,
        timestamp: e.createdAt.toISOString(),
        action: e.action,
        message: summarizeAuditAction(e),
        actorEmail: e.actorEmail,
        ipAddress: e.ipAddress,
      })),
    };
  }),

  /**
   * Full attorney list — one row per `attorney_profiles`, joined to
   * `users` for name/email. Replaces `listPendingAttorneys` for browse;
   * the latter stays for the layout's auth probe + the existing pending
   * page until that surface is restyled.
   *
   * NOTE: case-count and revenue-per-attorney columns shown in the mockup
   * require GROUP BY joins that don't have indexes yet. open_issues #18
   * tracks the index addition + the column population. Until then the
   * shape includes those fields as zeros so the page can render the table
   * without conditional columns.
   */
  listAttorneys: adminProcedure
    .input(
      z.object({
        status: z.enum(attorneyStatusEnum.enumValues).optional(),
        cursor: z
          .object({
            createdAt: z.iso.datetime(),
            id: z.uuid(),
          })
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { db } = ctx;

      const filters = [
        isNull(attorneyProfiles.deletedAt),
        isNull(users.deletedAt),
      ];
      if (input.status) {
        filters.push(eq(attorneyProfiles.status, input.status));
      }
      if (input.cursor) {
        filters.push(
          keysetLt(
            attorneyProfiles.createdAt,
            attorneyProfiles.id,
            input.cursor,
          ),
        );
      }

      // Items + status totals — independent reads, fan out.
      const [rows, totalsRows] = await Promise.all([
        db
          .select({
            userId: users.id,
            name: users.name,
            email: users.email,
            barNumber: attorneyProfiles.barNumber,
            barStates: attorneyProfiles.barStates,
            status: attorneyProfiles.status,
            createdAt: attorneyProfiles.createdAt,
            submittedAt: attorneyProfiles.submittedAt,
            profileId: attorneyProfiles.id,
          })
          .from(attorneyProfiles)
          .innerJoin(users, eq(users.id, attorneyProfiles.userId))
          .where(and(...filters))
          .orderBy(
            desc(attorneyProfiles.createdAt),
            desc(attorneyProfiles.id),
          )
          .limit(LIST_PAGE_SIZE + 1),

        // Counts per status for filter chips — does NOT inherit the
        // status filter (chips show all-time counts regardless of which
        // chip is active).
        db
          .select({
            all: sql<number>`count(*)::int`,
            active: sql<number>`count(*) filter (where ${attorneyProfiles.status} = 'active')::int`,
            pending: sql<number>`count(*) filter (where ${attorneyProfiles.status} = 'pending')::int`,
            suspended: sql<number>`count(*) filter (where ${attorneyProfiles.status} = 'suspended')::int`,
            inactive: sql<number>`count(*) filter (where ${attorneyProfiles.status} = 'inactive')::int`,
          })
          .from(attorneyProfiles)
          .innerJoin(users, eq(users.id, attorneyProfiles.userId))
          .where(
            and(isNull(attorneyProfiles.deletedAt), isNull(users.deletedAt)),
          ),
      ]);

      const hasMore = rows.length > LIST_PAGE_SIZE;
      const items = hasMore ? rows.slice(0, LIST_PAGE_SIZE) : rows;
      const totals = totalsRows[0];

      const last = items[items.length - 1];
      const nextCursor =
        hasMore && last
          ? { createdAt: last.createdAt.toISOString(), id: last.profileId }
          : null;

      return {
        items: items.map((r) => ({
          userId: r.userId,
          name: r.name,
          email: r.email,
          barNumber: r.barNumber,
          barStates: r.barStates,
          status: r.status,
          joinedAt: r.createdAt.toISOString(),
          submittedAt: r.submittedAt?.toISOString() ?? null,
          activeCases: 0, // Stage 10: aggregate from case_participants + cases.status
          filedCases: 0,
        })),
        totals: totals ?? {
          all: 0,
          active: 0,
          pending: 0,
          suspended: 0,
          inactive: 0,
        },
        nextCursor,
      };
    }),

  /**
   * Cross-org case list for admins. RLS bypass via the `cases_admin`
   * policy. `primaryAttorney` joins through `case_participants` filtering
   * for `role='attorney' AND is_primary=true AND removed_at IS NULL`.
   */
  listAllCases: adminProcedure
    .input(
      z.object({
        // Array so the StatBand groupings on `/admin/cases` (Drafting =
        // ready_to_build + building + build_failed + draft_ready, etc.)
        // can match the count they advertise. Single-status lookups pass
        // a one-element array.
        status: z.array(z.enum(caseStatusEnum.enumValues)).min(1).optional(),
        visaType: z.enum(visaTypeEnum.enumValues).optional(),
        cursor: z
          .object({
            createdAt: z.iso.datetime(),
            id: z.uuid(),
          })
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { db } = ctx;
      const primary = alias(caseParticipants, "primary_attorney");
      const attorney = alias(users, "attorney_user");
      const org = alias(organizations, "org");

      const filters = [isNull(cases.deletedAt)];
      if (input.status?.length) {
        filters.push(inArray(cases.status, input.status));
      }
      if (input.visaType) filters.push(eq(cases.visaType, input.visaType));
      if (input.cursor) {
        filters.push(keysetLt(cases.createdAt, cases.id, input.cursor));
      }

      // Items + StatBand totals — independent reads, fan out.
      const [rows, statusRows] = await Promise.all([
        db
          .select({
            id: cases.id,
            visaType: cases.visaType,
            status: cases.status,
            beneficiaryData: cases.beneficiaryData,
            caseFeeCents: cases.caseFeeCents,
            docketShareCents: cases.docketShareCents,
            filedAt: cases.filedAt,
            createdAt: cases.createdAt,
            updatedAt: cases.updatedAt,
            orgName: org.name,
            attorneyId: attorney.id,
            attorneyName: attorney.name,
            attorneyEmail: attorney.email,
          })
          .from(cases)
          .leftJoin(
            primary,
            and(
              eq(primary.caseId, cases.id),
              eq(primary.role, "attorney"),
              eq(primary.isPrimary, true),
              isNull(primary.removedAt),
            ),
          )
          .leftJoin(attorney, eq(attorney.id, primary.userId))
          .leftJoin(org, eq(org.id, cases.organizationId))
          .where(and(...filters))
          .orderBy(desc(cases.createdAt), desc(cases.id))
          .limit(LIST_PAGE_SIZE + 1),

        // StatBand totals — does NOT inherit the active filter (cells
        // show all-time per-status counts regardless of which is active).
        db
          .select({
            status: cases.status,
            count: sql<number>`count(*)::int`,
          })
          .from(cases)
          .where(isNull(cases.deletedAt))
          .groupBy(cases.status),
      ]);

      const hasMore = rows.length > LIST_PAGE_SIZE;
      const items = hasMore ? rows.slice(0, LIST_PAGE_SIZE) : rows;

      const byStatus = Object.fromEntries(
        caseStatusEnum.enumValues.map((s) => [s, 0]),
      ) as Record<(typeof caseStatusEnum.enumValues)[number], number>;
      let total = 0;
      for (const r of statusRows) {
        byStatus[r.status] = r.count;
        total += r.count;
      }

      const last = items[items.length - 1];
      const nextCursor =
        hasMore && last
          ? { createdAt: last.createdAt.toISOString(), id: last.id }
          : null;

      return {
        items: items.map((r) => ({
          id: r.id,
          visaType: r.visaType,
          status: r.status,
          beneficiaryName:
            (r.beneficiaryData as { fullName?: string } | null)?.fullName ??
            null,
          orgName: r.orgName,
          primaryAttorney: r.attorneyId
            ? {
                id: r.attorneyId,
                name: r.attorneyName,
                email: r.attorneyEmail,
              }
            : null,
          caseFeeCents: r.caseFeeCents,
          docketShareCents: r.docketShareCents,
          filedAt: r.filedAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
        totals: { total, byStatus },
        nextCursor,
      };
    }),

  /**
   * Audit log stream — paginated, optionally filtered by action prefix
   * (e.g. `"attorney."`, `"waitlist."`). The legend counts in the right
   * rail use a separate cheap aggregation grouped by the prefix bucket.
   */
  listAuditEvents: adminProcedure
    .input(
      z.object({
        actionPrefix: z.string().min(1).max(64).optional(),
        cursor: z
          .object({
            createdAt: z.iso.datetime(),
            id: z.uuid(),
          })
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { db } = ctx;

      const filters = [];
      if (input.actionPrefix) {
        filters.push(sql`${auditLog.action} like ${input.actionPrefix + "%"}`);
      }
      if (input.cursor) {
        filters.push(keysetLt(auditLog.createdAt, auditLog.id, input.cursor));
      }

      // Total matching the active filter (used by the pagination footer
      // to render "Showing X–Y of Z"). Last 24h scope keeps the count
      // cheap; pagination through older events is supported via cursor
      // even though the displayed total reflects the 24h window.
      const totalFilters = [
        sql`${auditLog.createdAt} >= now() - interval '24 hours'`,
      ];
      if (input.actionPrefix) {
        totalFilters.push(
          sql`${auditLog.action} like ${input.actionPrefix + "%"}`,
        );
      }

      // Three independent reads — fan out.
      const [rows, prefixRows, totalRows] = await Promise.all([
        db
          .select({
            id: auditLog.id,
            action: auditLog.action,
            targetType: auditLog.targetType,
            targetId: auditLog.targetId,
            details: auditLog.details,
            ipAddress: auditLog.ipAddress,
            createdAt: auditLog.createdAt,
            actorEmail: users.email,
          })
          .from(auditLog)
          .leftJoin(users, eq(users.id, auditLog.actorUserId))
          .where(filters.length > 0 ? and(...filters) : undefined)
          .orderBy(desc(auditLog.createdAt))
          .limit(LIST_PAGE_SIZE + 1),

        // Prefix-bucket totals for the legend (last 24h to keep cheap).
        db
          .select({
            action: auditLog.action,
            count: sql<number>`count(*)::int`,
          })
          .from(auditLog)
          .where(sql`${auditLog.createdAt} >= now() - interval '24 hours'`)
          .groupBy(auditLog.action),

        db
          .select({ total: sql<number>`count(*)::int` })
          .from(auditLog)
          .where(and(...totalFilters)),
      ]);

      const hasMore = rows.length > LIST_PAGE_SIZE;
      const items = hasMore ? rows.slice(0, LIST_PAGE_SIZE) : rows;
      const totalRow = totalRows[0];

      const byPrefix: Record<string, number> = {};
      for (const r of prefixRows) {
        const prefix = r.action.includes(".")
          ? (r.action.split(".")[0] ?? r.action)
          : r.action;
        byPrefix[prefix] = (byPrefix[prefix] ?? 0) + r.count;
      }

      const last = items[items.length - 1];
      const nextCursor =
        hasMore && last
          ? { createdAt: last.createdAt.toISOString(), id: last.id }
          : null;

      return {
        items: items.map((e) => ({
          id: e.id,
          timestamp: e.createdAt.toISOString(),
          action: e.action,
          message: summarizeAuditAction(e),
          actorEmail: e.actorEmail,
          ipAddress: e.ipAddress,
        })),
        byPrefix,
        total24h: totalRow?.total ?? 0,
        nextCursor,
      };
    }),

  /**
   * Revenue rollup. Sums `case_fee_cents` / `docket_share_cents` for
   * cases with `filed_at` in the requested window. Returns zero-shaped
   * response when no cases have been filed (Stage 10 populates).
   */
  getRevenueMetrics: adminProcedure
    .input(z.object({ period: z.enum(PERIODS).default("MTD") }))
    .query(async ({ ctx, input }) => {
      const { db } = ctx;
      const interval = PERIOD_INTERVAL[input.period];

      const filters = [isNull(cases.deletedAt), isNotNull(cases.filedAt)];
      if (interval) {
        filters.push(
          sql`${cases.filedAt} >= now() - interval '${sql.raw(interval)}'`,
        );
      }

      // Two independent reads with the same WHERE — fan out.
      const [totalsRows, byVisa] = await Promise.all([
        db
          .select({
            grossCents: sql<bigint>`coalesce(sum(${cases.caseFeeCents}), 0)::bigint`,
            docketCents: sql<bigint>`coalesce(sum(${cases.docketShareCents}), 0)::bigint`,
            attorneyCents: sql<bigint>`coalesce(sum(${cases.attorneyShareCents}), 0)::bigint`,
            filings: sql<number>`count(*)::int`,
          })
          .from(cases)
          .where(and(...filters)),

        db
          .select({
            visa: cases.visaType,
            cents: sql<bigint>`coalesce(sum(${cases.docketShareCents}), 0)::bigint`,
            count: sql<number>`count(*)::int`,
          })
          .from(cases)
          .where(and(...filters))
          .groupBy(cases.visaType)
          .orderBy(desc(sql`coalesce(sum(${cases.docketShareCents}), 0)`)),
      ]);
      const totals = totalsRows[0];

      return {
        period: input.period,
        totals: {
          grossCents: bn(totals?.grossCents),
          docketCents: bn(totals?.docketCents),
          attorneyCents: bn(totals?.attorneyCents),
          filings: totals?.filings ?? 0,
        },
        byVisa: byVisa.map((r) => ({
          visa: r.visa,
          cents: bn(r.cents),
          count: r.count,
        })),
      };
    }),

  /**
   * Compute spend rollup. Sums `case_compute_ledger.amount_cents` over
   * the requested window. Category breakdown is a placeholder until
   * Stage 10 adds a `compute_category` column; today every entry rolls
   * up into a single bucket.
   */
  getComputeMetrics: adminProcedure
    .input(z.object({ period: z.enum(PERIODS).default("MTD") }))
    .query(async ({ ctx, input }) => {
      const { db } = ctx;
      const interval = PERIOD_INTERVAL[input.period];

      const filters = [];
      if (interval) {
        filters.push(
          sql`${caseComputeLedger.occurredAt} >= now() - interval '${sql.raw(interval)}'`,
        );
      }

      const [totals] = await db
        .select({
          totalCents: sql<bigint>`coalesce(sum(${caseComputeLedger.amountCents}), 0)::bigint`,
          entries: sql<number>`count(*)::int`,
        })
        .from(caseComputeLedger)
        .where(filters.length > 0 ? and(...filters) : undefined);

      return {
        period: input.period,
        totals: {
          totalCents: bn(totals?.totalCents),
          entries: totals?.entries ?? 0,
        },
        // Stage 10: when `compute_category` lands, populate per-category
        // sums. For now everything rolls into a single bucket.
        byCategory: {
          inferenceCents: 0n,
          embeddingsCents: 0n,
          ocrCents: 0n,
          storageCents: 0n,
        },
      };
    }),

  // ─────────────────────────────────────────────────────────────────────
  // Stage 09 — additional procedures (suspend, attorney detail,
  // breakdowns, computer health timeline, admin-viewed-case audit).
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Suspend an attorney. Sets `attorney_profiles.status = 'suspended'`.
   * Idempotent on already-suspended (returns CONFLICT). Active cases
   * remain accessible (RLS doesn't gate on profile status); the
   * attorney just can't start new builds — `attorneyProcedure` rejects
   * non-active profiles.
   *
   * Spec §15.4 mandate. Reason text required (audit trail) — unlike
   * activate where it's optional.
   */
  suspendAttorney: adminProcedure
    .input(
      z.object({
        userId: z.uuid(),
        reason: z.string().min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db, userId: adminId } = ctx;
      const profile = await fetchAttorneyProfileOrThrow(db, input.userId);

      if (profile.status === "suspended") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Attorney is already suspended",
        });
      }

      return await withAudit(
        {
          db,
          adminId,
          action: "attorney.suspend",
          targetType: "user",
          targetId: input.userId,
          detailsFrom: () => ({
            reason: input.reason,
            previousStatus: profile.status,
          }),
        },
        async () => {
          await db
            .update(attorneyProfiles)
            .set({ status: "suspended" })
            .where(eq(attorneyProfiles.id, profile.id));
          // `target_attorney_id` is the user id (matches PostHog
          // distinctId + the rest of the user event stream). See the
          // sibling note in `activateAttorney` for the rationale.
          emitFromCtx(ctx, {
            name: "admin.attorney_status_changed",
            properties: {
              target_attorney_id: input.userId,
              from_status: profile.status,
              to_status: "suspended",
            },
          });
          return { ok: true as const };
        },
      );
    }),

  /**
   * Full attorney detail for the admin drawer / detail page. Joins the
   * user row, attorney profile, and the most recent N cases the
   * attorney participates in.
   *
   * Pure read — no audit row. (Spec §22 reserves the "viewed attorney"
   * audit for a future privacy-tightening. Phase 1 doesn't track view
   * events for attorneys.)
   */
  getAttorney: adminProcedure
    .input(z.object({ userId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const { db } = ctx;

      const [row] = await db
        .select({
          userId: users.id,
          name: users.name,
          email: users.email,
          createdAt: users.createdAt,
          profileId: attorneyProfiles.id,
          status: attorneyProfiles.status,
          barNumber: attorneyProfiles.barNumber,
          barStates: attorneyProfiles.barStates,
          submittedAt: attorneyProfiles.submittedAt,
          agreementSignedAt: attorneyProfiles.agreementSignedAt,
        })
        .from(users)
        .leftJoin(
          attorneyProfiles,
          and(
            eq(attorneyProfiles.userId, users.id),
            isNull(attorneyProfiles.deletedAt),
          ),
        )
        .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
        .limit(1);

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Most recent 10 cases the attorney participates in.
      const recentCases = await db
        .select({
          id: cases.id,
          visaType: cases.visaType,
          status: cases.status,
          updatedAt: cases.updatedAt,
        })
        .from(cases)
        .innerJoin(
          caseParticipants,
          and(
            eq(caseParticipants.caseId, cases.id),
            isNull(caseParticipants.removedAt),
          ),
        )
        .where(
          and(
            eq(caseParticipants.userId, input.userId),
            isNull(cases.deletedAt),
          ),
        )
        .orderBy(desc(cases.updatedAt))
        .limit(10);

      return {
        userId: row.userId,
        name: row.name,
        email: row.email,
        joinedAt: row.createdAt,
        // When the leftJoin matched a profile row, `status` is non-null
        // (NOT NULL column with a default). TS infers `status: status |
        // null` from the join, so we narrow on both fields together.
        profile:
          row.profileId && row.status
            ? {
                id: row.profileId,
                status: row.status,
                barNumber: row.barNumber,
                barStates: row.barStates ?? [],
                submittedAt: row.submittedAt,
                agreementSignedAt: row.agreementSignedAt,
              }
            : null,
        recentCases,
      };
    }),

  /**
   * Per-attorney revenue breakdown — top 10 attorneys by docket-share
   * cents in the period. Complements `getRevenueMetrics` (which gives
   * totals + per-visa). Pages joining the two queries get both
   * breakdowns without a payload-bloating mega-query.
   */
  getRevenueByAttorney: adminProcedure
    .input(z.object({ period: z.enum(PERIODS).default("MTD") }))
    .query(async ({ ctx, input }) => {
      const { db } = ctx;
      const interval = PERIOD_INTERVAL[input.period];

      const filters = [isNull(cases.deletedAt), isNotNull(cases.filedAt)];
      if (interval) {
        filters.push(
          sql`${cases.filedAt} >= now() - interval '${sql.raw(interval)}'`,
        );
      }

      const rows = await db
        .select({
          userId: users.id,
          email: users.email,
          name: users.name,
          docketCents: sql<bigint>`coalesce(sum(${cases.docketShareCents}), 0)::bigint`,
          attorneyCents: sql<bigint>`coalesce(sum(${cases.attorneyShareCents}), 0)::bigint`,
          filings: sql<number>`count(*)::int`,
        })
        .from(cases)
        .innerJoin(
          caseParticipants,
          and(
            eq(caseParticipants.caseId, cases.id),
            eq(caseParticipants.isPrimary, true),
            isNull(caseParticipants.removedAt),
          ),
        )
        .innerJoin(users, eq(users.id, caseParticipants.userId))
        .where(and(...filters))
        .groupBy(users.id, users.email, users.name)
        .orderBy(desc(sql`coalesce(sum(${cases.docketShareCents}), 0)`))
        .limit(10);

      return {
        period: input.period,
        items: rows.map((r) => ({
          userId: r.userId,
          email: r.email,
          name: r.name,
          docketCents: bn(r.docketCents),
          attorneyCents: bn(r.attorneyCents),
          filings: r.filings,
        })),
      };
    }),

  /**
   * Top-N case spend + per-attorney aggregate from the compute ledger.
   * Drives `/admin/compute`'s "where the money goes" tables. Period
   * applies to ledger entry timestamps (when the spend happened), not
   * case creation.
   */
  getComputeBreakdown: adminProcedure
    .input(z.object({ period: z.enum(PERIODS).default("MTD") }))
    .query(async ({ ctx, input }) => {
      const { db } = ctx;
      const interval = PERIOD_INTERVAL[input.period];

      const ledgerFilters = [];
      if (interval) {
        ledgerFilters.push(
          sql`${caseComputeLedger.occurredAt} >= now() - interval '${sql.raw(interval)}'`,
        );
      }

      const [topCases, byAttorney] = await Promise.all([
        // Top 10 cases by spend in window.
        db
          .select({
            caseId: cases.id,
            visaType: cases.visaType,
            spentCents: sql<bigint>`coalesce(sum(${caseComputeLedger.amountCents}), 0)::bigint`,
            entries: sql<number>`count(*)::int`,
          })
          .from(caseComputeLedger)
          .innerJoin(cases, eq(cases.id, caseComputeLedger.caseId))
          .where(
            ledgerFilters.length > 0
              ? and(...ledgerFilters, isNull(cases.deletedAt))
              : isNull(cases.deletedAt),
          )
          .groupBy(cases.id, cases.visaType)
          .orderBy(
            desc(sql`coalesce(sum(${caseComputeLedger.amountCents}), 0)`),
          )
          .limit(10),

        // Per-attorney rollup (joined via the case's primary participant).
        db
          .select({
            userId: users.id,
            email: users.email,
            name: users.name,
            spentCents: sql<bigint>`coalesce(sum(${caseComputeLedger.amountCents}), 0)::bigint`,
            cases: sql<number>`count(distinct ${cases.id})::int`,
          })
          .from(caseComputeLedger)
          .innerJoin(cases, eq(cases.id, caseComputeLedger.caseId))
          .innerJoin(
            caseParticipants,
            and(
              eq(caseParticipants.caseId, cases.id),
              eq(caseParticipants.isPrimary, true),
              isNull(caseParticipants.removedAt),
            ),
          )
          .innerJoin(users, eq(users.id, caseParticipants.userId))
          .where(
            ledgerFilters.length > 0
              ? and(...ledgerFilters, isNull(cases.deletedAt))
              : isNull(cases.deletedAt),
          )
          .groupBy(users.id, users.email, users.name)
          .orderBy(
            desc(sql`coalesce(sum(${caseComputeLedger.amountCents}), 0)`),
          )
          .limit(10),
      ]);

      return {
        period: input.period,
        topCases: topCases.map((r) => ({
          caseId: r.caseId,
          visaType: r.visaType,
          spentCents: bn(r.spentCents),
          entries: r.entries,
        })),
        byAttorney: byAttorney.map((r) => ({
          userId: r.userId,
          email: r.email,
          name: r.name,
          spentCents: bn(r.spentCents),
          cases: r.cases,
        })),
      };
    }),

  /**
   * Computer-health snapshot. Reads the single `computer:health:status`
   * key the Stage 07 cron writes (every 5 min). Phase 1 ships a
   * snapshot, not a multi-point timeline — Stage 11 polish would
   * persist a small `computer_health_events` table for the sparkline.
   *
   * Returns:
   *   - `status`: "up" | "down" | "unknown" (Redis missing or empty).
   *   - `checkedAt`: ISO timestamp of the cron's last write.
   *   - `lastError`: optional error string when the cron last saw down.
   *
   * Defense in depth: rejects when Redis isn't configured (no false
   * "up" / "down" answer). The `/admin/compute` page renders the
   * "unknown" branch as a placeholder.
   */
  getComputerHealthSnapshot: adminProcedure.query(async () => {
    const redis = getRedis();
    if (!redis) {
      return {
        status: "unknown" as const,
        checkedAt: null as string | null,
        lastError: null as string | null,
      };
    }
    const cached = await redis.get<{
      status: "up" | "down";
      checkedAt: string;
      lastError?: string;
    }>("computer:health:status");
    if (!cached) {
      return {
        status: "unknown" as const,
        checkedAt: null as string | null,
        lastError: null as string | null,
      };
    }
    return {
      status: cached.status,
      checkedAt: cached.checkedAt,
      lastError: cached.lastError ?? null,
    };
  }),

  /**
   * Admin reads a case detail. Pure read but writes an
   * `admin_viewed_case` audit row so attorneys can see when an admin
   * has accessed their case data (spec §15.4 + edge case in 09 spec).
   * Returns the same shape as `case.get` minus the events tail (admin
   * gets a focused detail; events come from `listAuditEvents`).
   */
  viewCase: adminProcedure
    .input(z.object({ caseId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { db, userId: adminId } = ctx;

      const [row] = await db
        .select({
          id: cases.id,
          organizationId: cases.organizationId,
          visaType: cases.visaType,
          status: cases.status,
          beneficiaryData: cases.beneficiaryData,
          caseFeeCents: cases.caseFeeCents,
          docketShareCents: cases.docketShareCents,
          revenueStatus: cases.revenueStatus,
          createdAt: cases.createdAt,
          updatedAt: cases.updatedAt,
        })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), isNull(cases.deletedAt)))
        .limit(1);
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Case not found",
        });
      }

      // Audit even in the read path — attorney can see when an admin
      // accessed their case data. Wrapped via withAudit so a phantom
      // log row never lands if the row above 404'd.
      await withAudit(
        {
          db,
          adminId,
          action: "admin.viewed_case",
          targetType: "case",
          targetId: row.id,
        },
        async () => row,
      );

      return row;
    }),
});
