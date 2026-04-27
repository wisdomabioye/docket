import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { appRouter } from "@/server/api/root";
import { createCallerFactory, createTRPCContext } from "@/server/api/trpc";

/**
 * Server-side tRPC caller — for RSC pages that want to call procedures
 * directly (no HTTP roundtrip). Cached per render via `react.cache` so
 * multiple components sharing the same query reuse one resolver run.
 *
 *   import { api } from "@/lib/trpc/server";
 *   const me = await api.me.current();
 */
const createContext = cache(async () => {
  const h = await headers();
  return createTRPCContext({ headers: h });
});

export const api = createCallerFactory(appRouter)(createContext);
