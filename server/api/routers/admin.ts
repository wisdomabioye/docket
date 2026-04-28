import { TRPCError } from "@trpc/server";
import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
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

/** Coerce a postgres-js aggregation result to `bigint`. `sum(int8)::bigint`
 *  comes back as a string under postgres-js's default type config — Drizzle's
 *  `sql<bigint>` is a TypeScript hint, not a runtime parser. Use this on
 *  every aggregated money column so the wire shape stays `bigint`. */
function bn(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") return BigInt(v);
  return 0n;
}

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

/**
 * Admin-only procedures. Stage 09 expands this into the full admin
 * dashboard (revenue, compute, audit log browser). Stage 03 ships the
 * minimum needed to activate pending attorneys.
 */

export const adminRouter = router({
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

      const [profile] = await db
        .select({
          id: attorneyProfiles.id,
          status: attorneyProfiles.status,
          submittedAt: attorneyProfiles.submittedAt,
        })
        .from(attorneyProfiles)
        .where(
          and(
            eq(attorneyProfiles.userId, input.userId),
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

      await db
        .update(attorneyProfiles)
        .set({ status: "active" })
        .where(eq(attorneyProfiles.id, profile.id));

      await db.insert(auditLog).values({
        actorType: "user",
        actorUserId: adminId,
        action: "attorney.activate",
        targetType: "user",
        targetId: input.userId,
        details: input.reason ? { reason: input.reason } : null,
      });

      return { ok: true as const };
    }),

  /**
   * Waitlist + invite gate. `listWaitlist` returns every non-deleted entry
   * newest-first with approval status joined; `approveWaitlistEntry` flips
   * `approved_at` so the email can complete OAuth sign-in.
   *
   * No pagination yet — the queue is small in early access. Add a cursor
   * once it crosses ~200 entries.
   */
  listWaitlist: adminProcedure.query(async ({ ctx }) => {
    const approver = alias(users, "approver");
    const rows = await ctx.db
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
      .where(isNull(waitlistEntries.deletedAt))
      .orderBy(desc(waitlistEntries.createdAt));
    return rows;
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
        .returning({ id: waitlistEntries.id, email: waitlistEntries.email });

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
      await db.insert(auditLog).values({
        actorType: "user",
        actorUserId: adminId,
        action: "waitlist.approve",
        targetType: "waitlist_entry",
        targetId: row.id,
        details: { email: row.email },
      });

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

    const [attorneyCounts] = await db
      .select({
        active: sql<number>`count(*) filter (where ${attorneyProfiles.status} = 'active')::int`,
        pending: sql<number>`count(*) filter (where ${attorneyProfiles.status} = 'pending')::int`,
        suspended: sql<number>`count(*) filter (where ${attorneyProfiles.status} = 'suspended')::int`,
        inactive: sql<number>`count(*) filter (where ${attorneyProfiles.status} = 'inactive')::int`,
      })
      .from(attorneyProfiles)
      .where(isNull(attorneyProfiles.deletedAt));

    const caseStatusRows = await db
      .select({
        status: cases.status,
        count: sql<number>`count(*)::int`,
      })
      .from(cases)
      .where(isNull(cases.deletedAt))
      .groupBy(cases.status);

    const casesByStatus = Object.fromEntries(
      caseStatusEnum.enumValues.map((s) => [s, 0]),
    ) as Record<(typeof caseStatusEnum.enumValues)[number], number>;
    let casesTotal = 0;
    for (const row of caseStatusRows) {
      casesByStatus[row.status] = row.count;
      casesTotal += row.count;
    }

    // Revenue: filed cases in the last 7 days. Returns zero `bigint`s if
    // no cases have `filed_at` yet (Stage 07/10 wires this up).
    const [revenue7d] = await db
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
      );

    // Recent admin-relevant events. Joins actor email so the UI doesn't
    // need a second round-trip. Limit 10 for the Ops Inbox card.
    const recent = await db
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
      .limit(10);

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
          lt(attorneyProfiles.createdAt, new Date(input.cursor.createdAt)),
        );
      }

      const rows = await db
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
        .orderBy(desc(attorneyProfiles.createdAt), desc(attorneyProfiles.id))
        .limit(LIST_PAGE_SIZE + 1);

      const hasMore = rows.length > LIST_PAGE_SIZE;
      const items = hasMore ? rows.slice(0, LIST_PAGE_SIZE) : rows;

      // Counts per status for filter chips. One query, one row.
      const [totals] = await db
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
        );

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
        status: z.enum(caseStatusEnum.enumValues).optional(),
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
      if (input.status) filters.push(eq(cases.status, input.status));
      if (input.visaType) filters.push(eq(cases.visaType, input.visaType));
      if (input.cursor) {
        filters.push(lt(cases.createdAt, new Date(input.cursor.createdAt)));
      }

      const rows = await db
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
        .limit(LIST_PAGE_SIZE + 1);

      const hasMore = rows.length > LIST_PAGE_SIZE;
      const items = hasMore ? rows.slice(0, LIST_PAGE_SIZE) : rows;

      // Status totals for the StatBand on `/admin/cases`.
      const statusRows = await db
        .select({
          status: cases.status,
          count: sql<number>`count(*)::int`,
        })
        .from(cases)
        .where(isNull(cases.deletedAt))
        .groupBy(cases.status);

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
        filters.push(lt(auditLog.createdAt, new Date(input.cursor.createdAt)));
      }

      const rows = await db
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
        .limit(LIST_PAGE_SIZE + 1);

      const hasMore = rows.length > LIST_PAGE_SIZE;
      const items = hasMore ? rows.slice(0, LIST_PAGE_SIZE) : rows;

      // Prefix-bucket totals for the legend (last 24h to keep cheap).
      const prefixRows = await db
        .select({
          action: auditLog.action,
          count: sql<number>`count(*)::int`,
        })
        .from(auditLog)
        .where(sql`${auditLog.createdAt} >= now() - interval '24 hours'`)
        .groupBy(auditLog.action);

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

      const [totals] = await db
        .select({
          grossCents: sql<bigint>`coalesce(sum(${cases.caseFeeCents}), 0)::bigint`,
          docketCents: sql<bigint>`coalesce(sum(${cases.docketShareCents}), 0)::bigint`,
          attorneyCents: sql<bigint>`coalesce(sum(${cases.attorneyShareCents}), 0)::bigint`,
          filings: sql<number>`count(*)::int`,
        })
        .from(cases)
        .where(and(...filters));

      const byVisa = await db
        .select({
          visa: cases.visaType,
          cents: sql<bigint>`coalesce(sum(${cases.docketShareCents}), 0)::bigint`,
          count: sql<number>`count(*)::int`,
        })
        .from(cases)
        .where(and(...filters))
        .groupBy(cases.visaType)
        .orderBy(desc(sql`coalesce(sum(${cases.docketShareCents}), 0)`));

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
});
