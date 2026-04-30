import "server-only";
import { cache } from "react";
import { api } from "@/lib/trpc/server";

/**
 * Per-request memoization of `api.me.current()`. React's `cache()` is
 * scoped to a single render pass, so the workspace layout + each page
 * underneath share one round-trip instead of N. Keeps `BEGIN; SET LOCAL
 * ROLE app_user; SET LOCAL app.current_user_id = ...; SELECT ...; COMMIT;`
 * from running once per call site.
 *
 * Always call this instead of `api.me.current()` from server components
 * inside `(app)` / `(admin)`. Pages that don't share a render pass
 * (e.g. an Inngest job) should keep using `api.me.current()` directly —
 * `cache()` only deduplicates within a single React render.
 */
export const getMe = cache(async () => api.me.current());
