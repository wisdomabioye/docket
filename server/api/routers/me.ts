import { eq, and, isNull } from "drizzle-orm";
import {
  attorneyProfiles,
  organizationMembers,
  organizations,
  userRoles,
  users,
} from "@/server/db/schema";
import { protectedProcedure, router } from "@/server/api/trpc";

/**
 * `me.*` — first protected router. Smoke-tests the entire stack:
 * Auth.js session → tRPC context → withDb middleware → RLS-engaged query.
 *
 * If `me.current` returns the right shape, every layer is wired correctly.
 */
export const meRouter = router({
  current: protectedProcedure.query(async ({ ctx }) => {
    const { db, userId } = ctx;

    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        timezone: users.timezone,
        locale: users.locale,
      })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (!user) {
      // RLS denied or row truly missing. Either way the session is bad.
      return null;
    }

    const roles = await db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, userId));

    const memberships = await db
      .select({
        organizationId: organizationMembers.organizationId,
        role: organizationMembers.role,
        organizationName: organizations.name,
        organizationSlug: organizations.slug,
      })
      .from(organizationMembers)
      .innerJoin(
        organizations,
        eq(organizationMembers.organizationId, organizations.id),
      )
      .where(
        and(
          eq(organizationMembers.userId, userId),
          isNull(organizationMembers.removedAt),
        ),
      );

    const [profile] = await db
      .select({
        status: attorneyProfiles.status,
        barNumber: attorneyProfiles.barNumber,
        barStates: attorneyProfiles.barStates,
        submittedAt: attorneyProfiles.submittedAt,
        agreementSignedAt: attorneyProfiles.agreementSignedAt,
      })
      .from(attorneyProfiles)
      .where(
        and(
          eq(attorneyProfiles.userId, userId),
          isNull(attorneyProfiles.deletedAt),
        ),
      )
      .limit(1);

    return {
      user,
      roles: roles.map((r) => r.role),
      memberships,
      attorneyProfile: profile ?? null,
    };
  }),
});
