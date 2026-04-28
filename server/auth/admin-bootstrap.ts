import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { userRoles } from "@/server/db/schema";
import { env } from "@/config/env";

/**
 * Founder-bootstrap helpers. Used by both the invite gate (allow the
 * configured email past sign-in) and `onSignIn()` (auto-grant admin +
 * activate attorney profile).
 *
 * Self-disabling: `eligible` returns false the moment any admin exists
 * in `user_roles`, so leaving `ADMIN_BOOTSTRAP_EMAIL` in the env after
 * onboarding the founder is harmless.
 *
 * The "no admin exists" check is read-then-write racy on its own, but
 * (a) only the env-matched email triggers the path at all, and (b) the
 * `(user_id, role)` PK on `user_roles` makes the actual grant idempotent.
 * So the worst case under a concurrent race is "founder gets admin
 * twice" which collapses to "founder gets admin once".
 */

export function bootstrapEmail(): string | null {
  return env.ADMIN_BOOTSTRAP_EMAIL ?? null;
}

export function emailMatchesBootstrap(email: string): boolean {
  const target = bootstrapEmail();
  if (!target) return false;
  return email.toLowerCase() === target;
}

/**
 * True iff `email` is the env-configured bootstrap address AND no admin
 * exists yet in `user_roles`. The `db` argument is whichever connection
 * the caller already has — owner db for the invite gate (no tx needed),
 * the active tx for the `onSignIn()` provisioning transaction.
 */
export async function isBootstrapEligible(
  email: string,
  db: Db,
): Promise<boolean> {
  if (!emailMatchesBootstrap(email)) return false;
  return !(await anyAdminExists(db));
}

export async function anyAdminExists(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ found: sql<number>`1` })
    .from(userRoles)
    .where(eq(userRoles.role, "admin"))
    .limit(1);
  return Boolean(row);
}
