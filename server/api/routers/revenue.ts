import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  caseEvents,
  caseParticipants,
  cases,
  invoices,
  users,
} from "@/server/db/schema";
import { db as ownerDb, type Db } from "@/server/db/client";
import { bn } from "@/server/db/helpers";
import {
  adminProcedure,
  attorneyProcedure,
  protectedProcedure,
  router,
} from "@/server/api/trpc";
import {
  computeRevenueSplit,
  createMonthlyInvoice,
  listEligibleCasesForPeriod,
} from "@/server/services/stripe";
import { withAudit } from "@/server/services/audit";
import { rateLimit } from "@/server/services/ratelimit";
import { AppError, appErrorToTrpcCode, isAppError } from "@/lib/errors";

/**
 * Stage 10 revenue router. All mutations write to `cases` (revenue
 * fields) or `invoices`; all reads scope by RLS via `ctx.db` so an
 * attorney sees only their own data, an admin sees everything via
 * `is_admin()` policies.
 *
 * Money: integer cents end-to-end (USD). Computed split via
 * `computeRevenueSplit` — the only place the 15/85 math lives.
 */

const PeriodInput = z.object({
  attorneyUserId: z.uuid(),
  periodYear: z.number().int().min(2024).max(2100),
  periodMonth: z.number().int().min(1).max(12),
});

const LogFeeInput = z.object({
  caseId: z.uuid(),
  /** Cents. `0` is allowed (pro-bono → status forced to `waived`). */
  feeCents: z.number().int().min(0).max(10_000_000), // $100k cap (sanity)
});

const AdjustFeeInput = z.object({
  caseId: z.uuid(),
  feeCents: z.number().int().min(0).max(10_000_000),
  reason: z.string().min(1).max(500),
});

const ListInvoicesInput = z.object({
  attorneyUserId: z.uuid().optional(),
  status: z.enum(["draft", "open", "paid", "void", "uncollectible"]).optional(),
  cursor: z
    .object({ createdAt: z.iso.datetime(), id: z.uuid() })
    .optional(),
});

const PAGE_SIZE = 25;

export const revenueRouter = router({
  /**
   * Attorney logs the case fee they charged the client. Only the
   * primary attorney on the case may call this (RLS scopes the row;
   * the participant join in the where-clause is the additional guard).
   * Refuses to mutate after the case has been invoiced — the
   * `revenue.adjustCaseFee` admin path is the escape hatch.
   *
   *   feeCents = 0 → forces `revenue_status = waived` (pro-bono).
   *   feeCents > 0 + previously waived → flips back to `pending`.
   *   feeCents > 0 + previously pending → stays `pending` (re-priced).
   *   case currently `invoiced` / `paid` → CONFLICT.
   */
  logCaseFee: attorneyProcedure
    .input(LogFeeInput)
    .mutation(async ({ ctx, input }) => {
      const { db, userId } = ctx;

      const rl = await rateLimit("revenue.logFee", userId);
      if (!rl.success) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many fee updates (${rl.limit}/min). Try again shortly.`,
        });
      }

      // RLS-engaged read: we ALSO require the caller is the case's
      // primary attorney participant. Even though RLS hides cases the
      // user can't see, an attorney could be a non-primary participant
      // (e.g. paralegal) and shouldn't bill on the case.
      const [row] = await db
        .select({
          id: cases.id,
          revenueStatus: cases.revenueStatus,
          status: cases.status,
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
        .where(and(eq(cases.id, input.caseId), isNull(cases.deletedAt)))
        .limit(1);
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Case not found, or you are not the primary attorney.",
        });
      }
      if (
        row.revenueStatus === "invoiced" ||
        row.revenueStatus === "paid"
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            row.revenueStatus === "paid"
              ? "Case is already paid — admin can adjust via revenue.adjustCaseFee."
              : "Case is already invoiced — admin can adjust via revenue.adjustCaseFee.",
        });
      }

      const split = computeRevenueSplit(input.feeCents);
      const nextStatus: "waived" | "pending" =
        input.feeCents === 0 ? "waived" : "pending";

      try {
        await ownerDb.transaction(async (tx) => {
          await tx
            .update(cases)
            .set({
              caseFeeCents: BigInt(split.feeCents),
              docketShareCents: BigInt(split.docketShareCents),
              attorneyShareCents: BigInt(split.attorneyShareCents),
              revenueStatus: nextStatus,
            })
            .where(eq(cases.id, input.caseId));
          await tx.insert(caseEvents).values({
            caseId: input.caseId,
            actorType: "user",
            actorUserId: userId,
            eventType: "case.fee_logged",
            details: {
              feeCents: split.feeCents,
              docketShareCents: split.docketShareCents,
              attorneyShareCents: split.attorneyShareCents,
              status: nextStatus,
            },
          });
        });
      } catch (err) {
        rethrow(err);
      }

      return {
        ok: true as const,
        feeCents: split.feeCents,
        docketShareCents: split.docketShareCents,
        attorneyShareCents: split.attorneyShareCents,
        status: nextStatus,
      };
    }),

  /**
   * Admin escape hatch — adjust a case's fee even after invoicing.
   * Doesn't touch Stripe (admin handles edits in the Stripe dashboard
   * if needed); just rewrites the columns + writes an audit row.
   *
   * Required `reason` becomes the audit detail so the trail explains
   * why the post-invoice change happened.
   */
  adjustCaseFee: adminProcedure
    .input(AdjustFeeInput)
    .mutation(async ({ ctx, input }) => {
      const { db, userId: adminId } = ctx;

      const rl = await rateLimit("revenue.adjust", adminId);
      if (!rl.success) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Adjust rate limit reached (${rl.limit}/min).`,
        });
      }

      const [existing] = await db
        .select({
          id: cases.id,
          previousFeeCents: cases.caseFeeCents,
          previousStatus: cases.revenueStatus,
        })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), isNull(cases.deletedAt)))
        .limit(1);
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Case not found.",
        });
      }

      const split = computeRevenueSplit(input.feeCents);
      // Pro-bono adjust → waived. Non-zero adjust on a previously
      // waived/pending row stays pending (admin can re-bill in a
      // future invoice). Adjust on `paid` keeps `paid` (the money
      // moved; admin's adjustment is bookkeeping only — Stripe
      // remains source of truth for the actual transfer).
      const nextStatus =
        input.feeCents === 0
          ? "waived"
          : existing.previousStatus === "paid"
            ? "paid"
            : existing.previousStatus === "invoiced"
              ? "invoiced"
              : "pending";

      try {
        await ownerDb.transaction(async (tx) =>
          withAudit(
            {
              db: tx as unknown as Db,
              adminId,
              action: "revenue.admin_adjust",
              targetType: "case",
              targetId: input.caseId,
              detailsFrom: () => ({
                reason: input.reason,
                // Nullish — not truthy — check: a previously-waived case
                // has feeCents = 0n, which is falsy. Logging null there
                // would conflate "never had a fee" with "fee was zero
                // (pro-bono)" in the audit history.
                previousFeeCents:
                  existing.previousFeeCents != null
                    ? existing.previousFeeCents.toString()
                    : null,
                previousStatus: existing.previousStatus,
                feeCents: split.feeCents,
                docketShareCents: split.docketShareCents,
                attorneyShareCents: split.attorneyShareCents,
              }),
            },
            async () => {
              await tx
                .update(cases)
                .set({
                  caseFeeCents: BigInt(split.feeCents),
                  docketShareCents: BigInt(split.docketShareCents),
                  attorneyShareCents: BigInt(split.attorneyShareCents),
                  revenueStatus: nextStatus,
                })
                .where(eq(cases.id, input.caseId));
              return { ok: true as const };
            },
          ),
        );
      } catch (err) {
        rethrow(err);
      }

      return {
        ok: true as const,
        feeCents: split.feeCents,
        docketShareCents: split.docketShareCents,
        attorneyShareCents: split.attorneyShareCents,
        status: nextStatus,
      };
    }),

  /**
   * Eligible-cases preview for the admin invoice UI. Same shape as
   * the service-layer `listEligibleCasesForPeriod` but BigInt fields
   * coerced to strings (superjson handles bigint, but consumer-side
   * components are simpler with strings).
   */
  eligibleCasesForPeriod: adminProcedure
    .input(PeriodInput)
    .query(async ({ ctx, input }) => {
      const { db } = ctx;
      try {
        const items = await listEligibleCasesForPeriod({
          db,
          attorneyUserId: input.attorneyUserId,
          periodYear: input.periodYear,
          periodMonth: input.periodMonth,
        });
        const totalDocketCents = items.reduce(
          (sum, c) => sum + Number(c.docketShareCents),
          0,
        );
        return {
          items: items.map((c) => ({
            id: c.id,
            visaType: c.visaType,
            beneficiaryFullName: c.beneficiaryFullName,
            caseFeeCents: c.caseFeeCents.toString(),
            docketShareCents: c.docketShareCents.toString(),
            attorneyShareCents: c.attorneyShareCents.toString(),
            filedAt: c.filedAt,
          })),
          totalDocketCents,
        };
      } catch (err) {
        rethrow(err);
      }
    }),

  /**
   * Admin generates the monthly invoice. Idempotent on the `(attorney,
   * year, month)` key — a duplicate click returns CONFLICT. Returns
   * the new `invoices` row id and the Stripe-hosted URL (the admin UI
   * deep-links).
   */
  adminGenerateInvoice: adminProcedure
    .input(PeriodInput)
    .mutation(async ({ ctx, input }) => {
      const { userId: adminId } = ctx;

      const rl = await rateLimit("revenue.generateInvoice", adminId);
      if (!rl.success) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Generate-invoice rate limit reached (${rl.limit}/min).`,
        });
      }

      try {
        const result = await withAudit(
          {
            db: ownerDb,
            adminId,
            action: "revenue.invoice_generated",
            targetType: "user",
            targetId: input.attorneyUserId,
            detailsFrom: (r: { invoiceId: string; totalCents: number; caseIds: ReadonlyArray<string> }) => ({
              invoiceId: r.invoiceId,
              totalCents: r.totalCents,
              caseCount: r.caseIds.length,
              periodYear: input.periodYear,
              periodMonth: input.periodMonth,
            }),
          },
          async () =>
            createMonthlyInvoice({
              db: ownerDb,
              attorneyUserId: input.attorneyUserId,
              periodYear: input.periodYear,
              periodMonth: input.periodMonth,
            }),
        );
        return result;
      } catch (err) {
        rethrow(err);
      }
    }),

  /**
   * Admin invoice list. Optional filters; keyset cursor paginated.
   * Joins the attorney's email so the table doesn't need a second
   * query per row.
   */
  adminListInvoices: adminProcedure
    .input(ListInvoicesInput)
    .query(async ({ ctx, input }) => {
      const { db } = ctx;
      const filters = [isNull(invoices.deletedAt)];
      if (input.attorneyUserId) {
        filters.push(eq(invoices.attorneyId, input.attorneyUserId));
      }
      if (input.status) filters.push(eq(invoices.status, input.status));
      if (input.cursor) {
        const cursorAt = new Date(input.cursor.createdAt);
        filters.push(
          or(
            lt(invoices.createdAt, cursorAt),
            and(eq(invoices.createdAt, cursorAt), lt(invoices.id, input.cursor.id)),
          )!,
        );
      }
      const rows = await db
        .select({
          id: invoices.id,
          attorneyId: invoices.attorneyId,
          attorneyEmail: users.email,
          attorneyName: users.name,
          stripeInvoiceId: invoices.stripeInvoiceId,
          periodYear: invoices.periodYear,
          periodMonth: invoices.periodMonth,
          totalCents: invoices.totalCents,
          status: invoices.status,
          hostedInvoiceUrl: invoices.hostedInvoiceUrl,
          lastFailureReason: invoices.lastFailureReason,
          createdAt: invoices.createdAt,
        })
        .from(invoices)
        .innerJoin(users, eq(users.id, invoices.attorneyId))
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(invoices.createdAt), desc(invoices.id))
        .limit(PAGE_SIZE + 1);

      const hasMore = rows.length > PAGE_SIZE;
      const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
      const nextCursor =
        hasMore && items.length > 0
          ? {
              createdAt: items[items.length - 1]!.createdAt.toISOString(),
              id: items[items.length - 1]!.id,
            }
          : null;
      return { items, nextCursor };
    }),

  /**
   * Attorney's own invoice list — RLS-scoped, so this returns only
   * the caller's invoices. Renders on /settings billing tab. Same
   * keyset-cursor shape as `adminListInvoices` but without the
   * attorney-name join (the caller is always the row's attorney).
   */
  myInvoices: protectedProcedure
    .input(
      z.object({
        cursor: z
          .object({ createdAt: z.iso.datetime(), id: z.uuid() })
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { db, userId } = ctx;
      const filters = [eq(invoices.attorneyId, userId), isNull(invoices.deletedAt)];
      if (input.cursor) {
        const cursorAt = new Date(input.cursor.createdAt);
        filters.push(
          or(
            lt(invoices.createdAt, cursorAt),
            and(eq(invoices.createdAt, cursorAt), lt(invoices.id, input.cursor.id)),
          )!,
        );
      }
      const rows = await db
        .select({
          id: invoices.id,
          stripeInvoiceId: invoices.stripeInvoiceId,
          periodYear: invoices.periodYear,
          periodMonth: invoices.periodMonth,
          totalCents: invoices.totalCents,
          status: invoices.status,
          hostedInvoiceUrl: invoices.hostedInvoiceUrl,
          createdAt: invoices.createdAt,
        })
        .from(invoices)
        .where(and(...filters))
        .orderBy(desc(invoices.createdAt), desc(invoices.id))
        .limit(PAGE_SIZE + 1);

      const hasMore = rows.length > PAGE_SIZE;
      const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
      const nextCursor =
        hasMore && items.length > 0
          ? {
              createdAt: items[items.length - 1]!.createdAt.toISOString(),
              id: items[items.length - 1]!.id,
            }
          : null;
      return { items, nextCursor };
    }),

  /**
   * Attorney's own monthly summary. Six months of buckets + lifetime
   * totals. No admin path — admin sees the global breakdown via
   * `admin.getRevenueByAttorney`.
   */
  attorneySummary: protectedProcedure.query(async ({ ctx }) => {
    const { db, userId } = ctx;
    // Lifetime totals filed under the caller as primary attorney.
    const baseFilters = and(
      eq(caseParticipants.userId, userId),
      eq(caseParticipants.isPrimary, true),
      isNull(caseParticipants.removedAt),
      isNull(cases.deletedAt),
    );

    const sixMonthsAgo = (() => {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCMonth(d.getUTCMonth() - 5); // include current month + 5 prior
      return d;
    })();

    const [totalsRow] = await db
      .select({
        pendingCents: sql<bigint>`coalesce(sum(${cases.docketShareCents}) filter (where ${cases.revenueStatus} = 'pending'), 0)::bigint`,
        invoicedCents: sql<bigint>`coalesce(sum(${cases.docketShareCents}) filter (where ${cases.revenueStatus} = 'invoiced'), 0)::bigint`,
        paidCents: sql<bigint>`coalesce(sum(${cases.docketShareCents}) filter (where ${cases.revenueStatus} = 'paid'), 0)::bigint`,
        attorneyShareCents: sql<bigint>`coalesce(sum(${cases.attorneyShareCents}), 0)::bigint`,
        filings: sql<number>`count(*) filter (where ${cases.filedAt} is not null)::int`,
      })
      .from(cases)
      .innerJoin(caseParticipants, eq(caseParticipants.caseId, cases.id))
      .where(baseFilters);

    const monthRows = await db
      .select({
        year: sql<number>`extract(year from ${cases.filedAt})::int`,
        month: sql<number>`extract(month from ${cases.filedAt})::int`,
        feeCents: sql<bigint>`coalesce(sum(${cases.caseFeeCents}), 0)::bigint`,
        docketCents: sql<bigint>`coalesce(sum(${cases.docketShareCents}), 0)::bigint`,
        attorneyCents: sql<bigint>`coalesce(sum(${cases.attorneyShareCents}), 0)::bigint`,
        filings: sql<number>`count(*)::int`,
      })
      .from(cases)
      .innerJoin(caseParticipants, eq(caseParticipants.caseId, cases.id))
      .where(
        and(
          baseFilters,
          gte(cases.filedAt, sixMonthsAgo),
        ),
      )
      .groupBy(
        sql`extract(year from ${cases.filedAt})`,
        sql`extract(month from ${cases.filedAt})`,
      )
      .orderBy(
        sql`extract(year from ${cases.filedAt}) desc`,
        sql`extract(month from ${cases.filedAt}) desc`,
      );

    return {
      totals: {
        // `sql<bigint>` is a TS hint, not a runtime parser; postgres-js
        // returns aggregate columns as strings. `bn()` normalizes to
        // bigint so the wire shape matches the type.
        pendingCents: bn(totalsRow?.pendingCents),
        invoicedCents: bn(totalsRow?.invoicedCents),
        paidCents: bn(totalsRow?.paidCents),
        attorneyShareCents: bn(totalsRow?.attorneyShareCents),
        filings: totalsRow?.filings ?? 0,
      },
      months: monthRows.map((r) => ({
        year: r.year,
        month: r.month,
        feeCents: bn(r.feeCents),
        docketCents: bn(r.docketCents),
        attorneyCents: bn(r.attorneyCents),
        filings: r.filings,
      })),
    };
  }),
});

/** Map service-layer `AppError` to TRPC at the boundary. The router
 *  uses this in every mutation's catch — keeps the error mapping in
 *  one place. `isAppError` covers both the runtime instance check and
 *  the structural-shape fallback for cross-realm `AppError`s. */
function rethrow(err: unknown): never {
  if (err instanceof TRPCError) throw err;
  if (isAppError(err) || err instanceof AppError) {
    throw new TRPCError({
      code: appErrorToTrpcCode(err.code),
      message: err.message,
    });
  }
  throw err;
}
