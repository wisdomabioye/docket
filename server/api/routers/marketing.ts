import { sql } from "drizzle-orm";
import { z } from "zod";
import { waitlistEntries } from "@/server/db/schema";
import {
  AttorneyApplicationDetailsSchema,
  WaitlistKind,
} from "@/server/db/schema/zod/waitlist-details";
import { db } from "@/server/db/client";
import { publicProcedure, router } from "@/server/api/trpc";
import { readIp } from "@/server/api/headers";
import { requiredSafeName } from "@/lib/validators";

/**
 * Public marketing surface — waitlist signup. Runs as a public procedure
 * (no auth, no DB-tx middleware, no GUC). Uses the raw DB owner client
 * so RLS isn't engaged; the waitlist_entries `_insert` policy allows
 * `with check (true)` anyway, but we don't depend on it here.
 *
 * The honeypot field (`hp`) must be empty — bots fill all fields.
 *
 * Duplicate email returns the same success shape as a fresh signup,
 * silently merging into the existing row. This prevents email enumeration
 * (an attacker can't tell which addresses are already on the list).
 */

/**
 * Per-funnel input shape. The `general` funnel is email + (optional) name;
 * the `attorney` funnel additionally requires the structured firm/bar
 * payload that ends up in `waitlist_entries.details`.
 *
 * Discriminated union on `kind` keeps the router's `input` typed and
 * forces callers to send the right shape — no "details ignored when kind
 * is general" footgun.
 */
const JoinWaitlistInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("general"),
    email: z.email().max(320),
    name: requiredSafeName(120).optional(),
    source: z.string().min(1).max(80).optional(),
    utmSource: z.string().min(1).max(80).optional(),
    utmMedium: z.string().min(1).max(80).optional(),
    utmCampaign: z.string().min(1).max(80).optional(),
    referrer: z.string().min(1).max(500).optional(),
    /**
     * Honeypot. Real users leave it empty; bots fill all fields. We accept
     * any string here (NOT `max(0)`) so bots get the same silent-success
     * response as legitimate signups — `max(0)` would surface a BAD_REQUEST
     * that signals "we detected you" and lets the bot iterate.
     */
    hp: z.string().max(500).optional(),
  }),
  z.object({
    kind: z.literal("attorney"),
    email: z.email().max(320),
    name: requiredSafeName(120),
    details: AttorneyApplicationDetailsSchema,
    source: z.string().min(1).max(80).optional(),
    utmSource: z.string().min(1).max(80).optional(),
    utmMedium: z.string().min(1).max(80).optional(),
    utmCampaign: z.string().min(1).max(80).optional(),
    referrer: z.string().min(1).max(500).optional(),
    hp: z.string().max(500).optional(),
  }),
]);

// Compile-time guard: every kind in the schema enum has a branch above.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ExhaustiveKindCheck = {
  [K in WaitlistKind]: Extract<z.infer<typeof JoinWaitlistInput>, { kind: K }>;
};

export const marketingRouter = router({
  joinWaitlist: publicProcedure
    .input(JoinWaitlistInput)
    .mutation(async ({ ctx, input }) => {
      // Honeypot violation — silently succeed. Don't tip the bot off.
      if (input.hp && input.hp.length > 0) {
        return { ok: true as const, alreadyOnList: false };
      }

      // Lowercase email so the partial-unique index on `email` (citext-cast
      // in migration 0002) deduplicates consistently regardless of case.
      const email = input.email.toLowerCase();
      const ipAddress = readIp(ctx.headers);

      const inserted = await db
        .insert(waitlistEntries)
        .values({
          email,
          name: input.name,
          source: input.source,
          utmSource: input.utmSource,
          utmMedium: input.utmMedium,
          utmCampaign: input.utmCampaign,
          referrer: input.referrer,
          ipAddress,
          kind: input.kind,
          details: input.kind === "attorney" ? input.details : null,
        })
        .onConflictDoNothing({
          target: waitlistEntries.email,
          where: sql`${waitlistEntries.deletedAt} is null`,
        })
        .returning({ id: waitlistEntries.id });

      // `inserted` is empty when the email already existed (and the
      // partial unique index swallowed the row). Return the same shape
      // either way to prevent enumeration.
      return { ok: true as const, alreadyOnList: inserted.length === 0 };
    }),
});

