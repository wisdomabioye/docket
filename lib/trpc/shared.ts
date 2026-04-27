import { type AppRouter } from "@/server/api/root";
import { type inferRouterInputs, type inferRouterOutputs } from "@trpc/server";
import { API_ROUTES, publicEnv } from "@/config";

/**
 * Helpers shared between server and client tRPC setups.
 */

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

export function getTrpcUrl(): string {
  return `${publicEnv.appUrl}${API_ROUTES.trpc}`;
}
