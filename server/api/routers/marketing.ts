import { sql } from "drizzle-orm";
import { z } from "zod";
import { waitlistEntries } from "@/server/db/schema";
import { db } from "@/server/db/client";
import { publicProcedure, router } from "@/server/api/trpc";
import { readIp } from "@/server/api/headers";

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

const JoinWaitlistInput = z.object({
  email: z.email().max(320),
  name: z.string().min(1).max(120).optional(),
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
});

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

