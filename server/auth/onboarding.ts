import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, type Db } from "@/server/db/client";
import {
  attorneyProfiles,
  auditLog,
  organizationMembers,
  organizations,
  userRoles,
  users,
} from "@/server/db/schema";
import { randomSuffix, slugBase } from "./slug";
import { emailMatchesBootstrap, anyAdminExists } from "./admin-bootstrap";
import { inngest } from "@/server/jobs/client";
import { signupWelcomeEvent } from "@/server/services/email/notifications";

/**
 * One-time provisioning for a brand-new user.
 *
 * Atomicity: all four inserts (org, member, role, profile) run in a single
 * transaction. Either they all land or none do — no orphaned org rows
 * after a partial failure. Re-entrant: every insert is keyed on a stable
 * natural value with `onConflictDoNothing`, so a retried sign-in repairs
 * any state from a prior crashed attempt.
 *
 * Phase 1 model: each attorney = one auto-created org. Stage 11+ adds
 * multi-attorney firm invites.
 *
 * SECURITY NOTE: slug collisions retry with a fresh random suffix instead
 * of joining the existing org — joining would let User B become owner of
 * User A's organization in the (vanishingly rare) collision case.
 */
export async function onSignIn(args: {
  userId: string;
  isNewUser: boolean;
}): Promise<void> {
  const { userId, isNewUser } = args;

  await db.transaction(async (tx) => {
    // Serialize concurrent sign-ins for the same user. Without this, two
    // sign-ins racing the "is the user already a member?" check both see
    // empty, both create a new org, both succeed → duplicate orgs.
    // `pg_advisory_xact_lock` releases at transaction end (commit OR
    // rollback). Key derived from user id via `hashtextextended` (bigint).
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`onsignin:${userId}`}, 0))`,
    );

    const [user] = await tx
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) return; // adapter race; next sign-in will retry

    const orgId = await ensureOrganization(tx as unknown as Db, user);
    if (!orgId) return; // unrecoverable slug-generation failure; logged below

    // The membership / profile unique indexes are PARTIAL (WHERE
    // removed_at/deleted_at IS NULL). Postgres requires the same predicate
    // in the ON CONFLICT clause to match the partial index.
    await tx
      .insert(organizationMembers)
      .values({
        organizationId: orgId,
        userId,
        role: "owner",
        status: "active",
        acceptedAt: new Date(),
      })
      .onConflictDoNothing({
        target: [organizationMembers.organizationId, organizationMembers.userId],
        where: sql`${organizationMembers.removedAt} is null`,
      });

    // user_roles PK is `(user_id, role)` — non-partial — bare conflict OK.
    await tx
      .insert(userRoles)
      .values({ userId, role: "attorney" })
      .onConflictDoNothing();

    await tx
      .insert(attorneyProfiles)
      .values({ userId, status: "pending" })
      .onConflictDoNothing({
        target: attorneyProfiles.userId,
        where: sql`${attorneyProfiles.deletedAt} is null`,
      });

    // Founder bootstrap. Fires only if (a) the env-configured email
    // matches AND (b) no admin exists yet — both checked atomically
    // inside this transaction. Self-disabling once any admin exists.
    if (emailMatchesBootstrap(user.email)) {
      const txDb = tx as unknown as Db;
      if (!(await anyAdminExists(txDb))) {
        await applyFounderBootstrap(txDb, userId);
      }
    }
  });

  // Welcome email — queued AFTER the provisioning tx commits so a rolled-
  // back signup never produces a stray email. `isNewUser` is sourced from
  // the Auth.js adapter (true only on the row-creating sign-in event), so
  // returning users skip this branch even when this function is re-run.
  // The listener resolves name + email by id, so a payload of just
  // `{ userId }` survives a name change between emit and send.
  if (isNewUser) {
    await inngest.send({
      name: signupWelcomeEvent.name,
      data: { userId },
    });
  }
}

/**
 * Promote the freshly-provisioned user to admin and activate their
 * attorney profile so they can use the dashboard immediately. Idempotent:
 * `user_roles` PK on `(user_id, role)` swallows a duplicate admin grant,
 * and the profile UPDATE is a no-op the second time around.
 */
async function applyFounderBootstrap(
  tx: Db,
  userId: string,
): Promise<void> {
  await tx
    .insert(userRoles)
    .values({ userId, role: "admin" })
    .onConflictDoNothing();

  // Status alone is what gates dashboard access. Bar fields,
  // `agreementSignedAt`, and `acceptedTermsVersion` stay null — the
  // founder can fill them in later via /onboarding (which won't bounce
  // them, since `status === 'active'` already passes the dashboard gate).
  await tx
    .update(attorneyProfiles)
    .set({ status: "active" })
    .where(eq(attorneyProfiles.userId, userId));

  await tx.insert(auditLog).values({
    actorType: "system",
    actorUserId: null,
    action: "admin.bootstrap",
    targetType: "user",
    targetId: userId,
    details: { reason: "ADMIN_BOOTSTRAP_EMAIL matched first sign-in" },
  });
}

/**
 * Find-or-create the user's organization. Collisions retry with a fresh
 * suffix so we never accidentally adopt an existing org belonging to a
 * different user.
 */
async function ensureOrganization(
  tx: Db,
  user: { id: string; name: string | null; email: string },
): Promise<string | null> {
  // Already a member? Re-use that org.
  const [existingMember] = await tx
    .select({ orgId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, user.id))
    .limit(1);
  if (existingMember) return existingMember.orgId;

  const orgName = user.name ? `${user.name}'s Practice` : "My Practice";
  const base = slugBase(user.email);

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = `${base}-${randomSuffix()}`;
    // Partial unique index — must repeat the WHERE clause for ON CONFLICT
    // to find the correct constraint.
    const [created] = await tx
      .insert(organizations)
      .values({ name: orgName, slug })
      .onConflictDoNothing({
        target: organizations.slug,
        where: sql`${organizations.deletedAt} is null`,
      })
      .returning({ id: organizations.id });
    if (created) return created.id;
  }

  console.error(
    `[onboarding] could not generate a unique slug for user ${user.id} after ${MAX_SLUG_ATTEMPTS} attempts`,
  );
  return null;
}

const MAX_SLUG_ATTEMPTS = 5;
// TODO(stage-03): reserved-word slug blocklist.
