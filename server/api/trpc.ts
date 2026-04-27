import "server-only";
import { initTRPC, TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import superjson from "superjson";
import { sql } from "drizzle-orm";
import { db, type Db } from "@/server/db/client";
import { auth } from "@/server/auth/config";
import { appErrorToTrpcCode, isAppError } from "@/lib/errors";

/**
 * tRPC v11 server. Two layers of context:
 *
 *   1. **Base context** — built once per request, carries the headers and
 *      the resolved Auth.js session.
 *   2. **DB context** — middleware wraps the procedure body in a
 *      transaction with `set local role app_user` and the per-request
 *      `app.current_user_id` GUC. RLS engages automatically. The `tx`
 *      Drizzle instance is exposed as `ctx.db`.
 *
 * System code (Inngest jobs, audit writes, admin scripts) must NOT use
 * tRPC — it goes through the raw `db` import directly, which uses the
 * owner role and bypasses RLS by design (see `docs/architecture.md`).
 */

export type TrpcContext = {
  headers: Headers;
  user: { id: string } | null;
};

export async function createTRPCContext(opts: {
  headers: Headers;
}): Promise<TrpcContext> {
  const session = await auth();
  return {
    headers: opts.headers,
    user: session?.user.id ? { id: session.user.id } : null,
  };
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    data: {
      ...shape.data,
      zodError:
        error.cause instanceof ZodError ? error.cause.flatten() : null,
    },
  }),
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

/**
 * `requireAuthAndDb` — UNAUTHORIZED if no session, otherwise opens a
 * transaction with `set local role app_user` + per-request
 * `app.current_user_id` GUC. RLS engages on every query inside the
 * procedure body.
 */
const requireAuthAndDb = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "sign-in required" });
  }
  const userId = ctx.user.id;

  return await db
    .transaction(async (tx) => {
      await tx.execute(sql`set local role app_user`);
      await tx.execute(
        sql`select set_config('app.current_user_id', ${userId}, true)`,
      );
      return await next({
        ctx: {
          ...ctx,
          user: { id: userId },
          userId,
          db: tx as unknown as Db,
        },
      });
    })
    .catch((err: unknown) => mapError(err));
});

/**
 * Admin procedure — extends protectedProcedure with a global-role check.
 * `is_admin()` is SECURITY DEFINER, so it bypasses RLS to read user_roles.
 * Throws FORBIDDEN if the caller lacks the admin role.
 */
const requireAdmin = t.middleware(async ({ ctx, next }) => {
  // requireAuthAndDb has already enriched ctx with db + userId.
  const c = ctx as typeof ctx & { db: Db; userId: string };
  const [row] = await c.db.execute<{ ok: boolean }>(
    sql`select is_admin() as ok`,
  );
  if (!row?.ok) {
    throw new TRPCError({ code: "FORBIDDEN", message: "admin role required" });
  }
  return next();
});

/** Public procedure — no auth, no DB transaction. */
export const publicProcedure = t.procedure;

/** Protected procedure — requires session, DB wrapped in user-scoped tx. */
export const protectedProcedure = t.procedure.use(requireAuthAndDb);

/** Admin procedure — protected + admin role check. */
export const adminProcedure = protectedProcedure.use(requireAdmin);

/**
 * Map service-layer errors to tRPC errors at the boundary. tRPC's
 * middleware promise rejects through transactions, so we re-wrap here.
 * `AppError` → matching TRPCError code per `lib/errors.appErrorToTrpcCode`.
 */
function mapError(err: unknown): never {
  if (err instanceof TRPCError) throw err;
  if (isAppError(err)) {
    throw new TRPCError({
      code: appErrorToTrpcCode(err.code),
      message: err.message,
      cause: err,
    });
  }
  throw err;
}
