import "server-only";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users, waitlistEntries } from "@/server/db/schema";
import { isBootstrapEligible } from "./admin-bootstrap";

/**
 * Invite gate for OAuth sign-in.
 *
 * Returns `true` if the email is permitted to sign in:
 *   1. **Returning user** — already has a row in `users` (vetted at first
 *      sign-in). Always allowed.
 *   2. **Approved invite** — has a non-deleted waitlist entry with
 *      `approved_at` set by an admin via `/admin/waitlist`.
 *   3. **Founder bootstrap** — email matches `ADMIN_BOOTSTRAP_EMAIL` AND
 *      no admin exists yet (`onSignIn()` then promotes them to admin +
 *      activates their attorney profile). Self-disabling: once any admin
 *      exists, this branch is inert. See `admin-bootstrap.ts`.
 *
 * Returns `false` otherwise. The Auth.js `signIn` callback redirects
 * rejected sign-ins to `/auth/error?error=not-invited`.
 *
 * Both `users.email` and `waitlist_entries.email` are `citext` (migration
 * 0002), so case-insensitive equality works against either column without
 * a `lower()` cast.
 */
export async function isInvitePermitted(email: string): Promise<boolean> {
  if (!email) return false;

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) return true;

  const [approved] = await db
    .select({ id: waitlistEntries.id })
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.email, email),
        isNotNull(waitlistEntries.approvedAt),
        isNull(waitlistEntries.deletedAt),
      ),
    )
    .limit(1);
  if (approved) return true;

  return await isBootstrapEligible(email, db);
}
