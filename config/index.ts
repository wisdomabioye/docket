/**
 * Single import surface for app configuration:
 *
 *   import { APP_INFO, APP_ROUTES, API_ROUTES, publicEnv } from "@/config";
 *
 * `env` is intentionally NOT re-exported — it imports `server-only`, which
 * would taint client bundles if pulled through this barrel. Import it
 * directly from `@/config/env` in server code.
 */

export { APP_INFO, pageTitle } from "./app.config";
export type { AppInfo } from "./app.config";

export { APP_ROUTES, PUBLIC_ROUTES } from "./app.routes";
export type { AppRoutes } from "./app.routes";

export { API_ROUTES } from "./api.routes";
export type { ApiRoutes } from "./api.routes";

export { publicEnv } from "./public-env";
export type { PublicEnv } from "./public-env";
