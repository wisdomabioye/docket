import { router } from "./trpc";
import { meRouter } from "./routers/me";
import { attorneyRouter } from "./routers/attorney";
import { adminRouter } from "./routers/admin";
import { marketingRouter } from "./routers/marketing";
import { caseRouter } from "./routers/case";
import { documentRouter } from "./routers/document";
import { outputRouter } from "./routers/output";
import { recommenderRouter } from "./routers/recommender";
import { revenueRouter } from "./routers/revenue";
import { searchRouter } from "./routers/search";

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
  marketing: marketingRouter,
  case: caseRouter,
  document: documentRouter,
  output: outputRouter,
  recommender: recommenderRouter,
  revenue: revenueRouter,
  search: searchRouter,
});

export type AppRouter = typeof appRouter;
