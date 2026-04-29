import "server-only";
import type { InngestFunction } from "inngest";

/**
 * Registry of every Inngest function the app serves. The `serve()` route
 * handler imports this single array — adding a new job means appending
 * here, never touching the route handler.
 *
 * Empty for now; populated in Phases 9-10 (per-output sub-functions, the
 * `case-build` orchestrator, the `computer-health` cron, and the
 * `case-build-failed` notifier).
 */

export const inngestFunctions: ReadonlyArray<InngestFunction.Any> = [];
