import "server-only";
import { Inngest } from "inngest";

/**
 * Singleton Inngest client. `id` is the application identifier shown in
 * the Inngest dashboard and used for event routing — keep it stable.
 *
 * `eventKey` and `signingKey` are picked up from `INNGEST_EVENT_KEY` /
 * `INNGEST_SIGNING_KEY` automatically by the SDK; we don't pass them
 * here so the dev server (which reads neither) "just works".
 *
 * Per-event payload typing in Inngest v4 lives on each function's
 * trigger via `eventType("name", staticSchema<...>())` — there's no
 * top-level schema map. Phases 9-10 define schemas alongside the
 * functions that own them.
 */

export const inngest = new Inngest({ id: "docket" });
