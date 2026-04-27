import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";
import { API_ROUTES } from "@/config";

/**
 * tRPC fetch adapter. Path comes from `config/api.routes.ts`.
 * Single endpoint — procedures are addressed by name, not URL.
 */
const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: API_ROUTES.trpc,
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ headers: req.headers }),
  });

export { handler as GET, handler as POST };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
