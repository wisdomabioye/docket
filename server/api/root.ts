import { router } from "./trpc";
import { meRouter } from "./routers/me";
import { attorneyRouter } from "./routers/attorney";
import { adminRouter } from "./routers/admin";

/**
 * Root tRPC router. Add new domain routers here.
 *
 * The exported `AppRouter` type is consumed by the client provider in
 * `lib/trpc/` to give end-to-end type safety.
 */
export const appRouter = router({
  me: meRouter,
  attorney: attorneyRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
