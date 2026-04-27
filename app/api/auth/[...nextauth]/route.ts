import { handlers } from "@/server/auth/config";

/**
 * Auth.js v5 catch-all handler. Path is mandated by next-auth (cannot be
 * relocated to `config/api.routes.ts`), so this stays in the App Router
 * convention.
 */
export const { GET, POST } = handlers;
