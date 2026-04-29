import "server-only";
import { and, desc, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { auditLog, users } from "@/server/db/schema";
import type { Db } from "@/server/db/client";

/**
 * Stage 09 audit-log service. Single mutation path for `audit_log`
 * writes from admin procedures + a typed reader for the audit-log
 * page. Eliminates the inline `db.insert(auditLog)` pattern that was
 * scattered across `activateAttorney` / `approveWaitlistEntry` and
 * would have spread to every new admin write.
 *
 * Why a `withAudit` wrapper (vs. a bare `logAdminAction` helper):
 * the wrapper guarantees the log row lands ONLY on success. A naked
 * helper invites the bug class where a procedure inserts the audit
 * row first, then the actual mutation throws — leaving a phantom log
 * entry. With `withAudit`, the log insert happens AFTER the wrapped
 * function resolves; if the function throws, no log row is ever
 * written.
 *
 * The wrapper also gives a single place to enforce the actor-id
 * shape (admin user) and the action-name format (`<domain>.<verb>`).
 */

export type AuditActionName = `${string}.${string}`;

export type AuditTargetType =
  | "user"
  | "case"
  | "attorney_profile"
  | "waitlist_entry"
  | "system";

export type LogAdminActionArgs = {
  /** The DB instance to write through. Owner connection so RLS doesn't
   *  block the cross-user write. Caller selects (most call sites pass
   *  `ctx.db` from `adminProcedure` which is RLS-engaged but
   *  `is_admin()` policies in migration 0005 grant admins write
   *  access — so either works). */
  db: Db;
  adminId: string;
  action: AuditActionName;
  targetType: AuditTargetType;
  /** Null for system-wide actions (e.g. `compute.budget.adjust` on no
   *  particular case). Required for user / case targets. */
  targetId?: string | null;
  /** JSON-serializable detail payload (reason text, before/after
   *  status, etc.). Validated against `AuditDetails` Zod via the
   *  `.$type<>()` annotation on the column. */
  details?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function logAdminAction(args: LogAdminActionArgs): Promise<void> {
  await args.db.insert(auditLog).values({
    actorType: "user",
    actorUserId: args.adminId,
    action: args.action,
    targetType: args.targetType,
    ...(args.targetId !== undefined && args.targetId !== null
      ? { targetId: args.targetId }
      : {}),
    ...(args.details !== undefined && args.details !== null
      ? { details: args.details as never }
      : {}),
    ...(args.ipAddress !== undefined && args.ipAddress !== null
      ? { ipAddress: args.ipAddress }
      : {}),
    ...(args.userAgent !== undefined && args.userAgent !== null
      ? { userAgent: args.userAgent }
      : {}),
  });
}

/**
 * Wraps an admin-mutation business function so the audit row is
 * written ONLY when the function resolves. The audit details are
 * derived from the function's resolved value via `detailsFrom`, so
 * the log captures the post-mutation state (e.g. final status, new
 * row id) — not just the input.
 *
 * Example:
 *   const result = await withAudit(
 *     {
 *       db: ctx.db,
 *       adminId: ctx.userId,
 *       action: "attorney.suspend",
 *       targetType: "user",
 *       targetId: input.userId,
 *       detailsFrom: () => ({ reason: input.reason }),
 *     },
 *     async () => {
 *       // mutation body that throws on conflict / not-found
 *     },
 *   );
 *
 * If the inner function throws, `withAudit` re-throws the same error
 * untouched (no audit row, no swallowed exception).
 */
export async function withAudit<T>(
  meta: {
    db: Db;
    adminId: string;
    action: AuditActionName;
    targetType: AuditTargetType;
    targetId?: string | null;
    detailsFrom?: (result: T) => Record<string, unknown> | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const result = await fn();
  const details = meta.detailsFrom?.(result) ?? null;
  await logAdminAction({
    db: meta.db,
    adminId: meta.adminId,
    action: meta.action,
    ...(meta.targetId !== undefined && meta.targetId !== null
      ? { targetId: meta.targetId }
      : {}),
    targetType: meta.targetType,
    details,
    ...(meta.ipAddress !== undefined && meta.ipAddress !== null
      ? { ipAddress: meta.ipAddress }
      : {}),
    ...(meta.userAgent !== undefined && meta.userAgent !== null
      ? { userAgent: meta.userAgent }
      : {}),
  });
  return result;
}

/**
 * Read-side: paginated audit-log listing for the admin audit-log page.
 * Returns rows newest-first with the actor's email joined (so the UI
 * doesn't need a second round-trip per row).
 *
 * Filters: `actorId` (specific admin), `actionPrefix` (e.g.
 * `attorney.` for all attorney admin actions), and the standard
 * keyset cursor `(createdAt, id)`.
 */
export type ListAuditLogArgs = {
  db: Db;
  actorId?: string;
  actionPrefix?: string;
  pageSize?: number;
  cursor?: { createdAt: string; id: string };
};

export type AuditLogItem = {
  id: string;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  details: unknown;
  ipAddress: string | null;
  createdAt: Date;
};

export async function listAuditLog(args: ListAuditLogArgs): Promise<{
  items: AuditLogItem[];
  nextCursor: { createdAt: string; id: string } | null;
}> {
  const pageSize = args.pageSize ?? 50;
  const filters = [];
  if (args.actorId) filters.push(eq(auditLog.actorUserId, args.actorId));
  if (args.actionPrefix) {
    filters.push(sql`${auditLog.action} like ${args.actionPrefix + "%"}`);
  }
  if (args.cursor) {
    // Composite keyset on (createdAt desc, id desc) so a tie on
    // createdAt resolves deterministically by id.
    const cursorAt = new Date(args.cursor.createdAt);
    filters.push(
      or(
        lt(auditLog.createdAt, cursorAt),
        and(eq(auditLog.createdAt, cursorAt), lt(auditLog.id, args.cursor.id)),
      )!,
    );
  }
  const rows = await args.db
    .select({
      id: auditLog.id,
      actorEmail: users.email,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      details: auditLog.details,
      ipAddress: auditLog.ipAddress,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(pageSize + 1);

  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  const nextCursor =
    hasMore && items.length > 0
      ? {
          createdAt: items[items.length - 1]!.createdAt.toISOString(),
          id: items[items.length - 1]!.id,
        }
      : null;
  return {
    items: items.map((r) => ({
      id: r.id,
      actorEmail: r.actorEmail,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      details: r.details,
      ipAddress: r.ipAddress as string | null,
      createdAt: r.createdAt,
    })),
    nextCursor,
  };
}

/** Read latest event row touching `(targetType, targetId)`. Used by the
 *  admin attorney detail to surface "last seen action" without a wide
 *  scan. */
export async function latestActionFor(args: {
  db: Db;
  targetType: AuditTargetType;
  targetId: string;
}): Promise<AuditLogItem | null> {
  const [row] = await args.db
    .select({
      id: auditLog.id,
      actorEmail: users.email,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      details: auditLog.details,
      ipAddress: auditLog.ipAddress,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(
      and(
        eq(auditLog.targetType, args.targetType),
        eq(auditLog.targetId, args.targetId),
        isNotNull(auditLog.actorUserId),
      ),
    )
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    actorEmail: row.actorEmail,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    details: row.details,
    ipAddress: row.ipAddress as string | null,
    createdAt: row.createdAt,
  };
}
