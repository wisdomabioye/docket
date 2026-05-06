/**
 * Run with: `pnpm grant-admin <email> [--reason="..."] [--yes]`
 *
 * Promotes a user to the `admin` role from the CLI. The deliberate
 * friction (run, review, re-run with `--yes`) is the point — see
 * `open_issues.md` rationale: admin role grants are rare, blast-radius
 * extreme, and we don't want a dashboard button for them.
 *
 * Checks performed before any write:
 *   - DATABASE_URL set.
 *   - Email argument provided and well-formed.
 *   - User row exists for that email (case-insensitive via citext).
 *   - User is not soft-deleted.
 *   - User does not already hold the admin role (idempotent: exits 0).
 *
 * On `--yes`, runs the role insert + audit-log entry in a single tx.
 * The audit row is attributed to `actor_type = 'system'` because no
 * authenticated tRPC user authored the action; the operator note
 * (`--reason`) is captured in `details` for traceability.
 *
 * Connects with the DB owner role (bypasses RLS), same as the seed
 * and reset scripts.
 */

import postgres from "postgres";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { auditLog, userRoles, users } from "@/server/db/schema";

const TAG = "[grant-admin]";

function fail(msg: string, code = 1): never {
  console.error(`${TAG} ${msg}`);
  process.exit(code);
}

function parseArgs(argv: ReadonlyArray<string>): {
  email: string;
  reason: string | null;
  confirm: boolean;
} {
  const positional: string[] = [];
  let reason: string | null = null;
  let confirm = false;
  for (const arg of argv) {
    if (arg === "--yes") confirm = true;
    else if (arg.startsWith("--reason=")) reason = arg.slice("--reason=".length);
    else if (arg.startsWith("--")) fail(`unknown flag: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) {
    fail(
      "usage: pnpm grant-admin <email> [--reason=\"text\"] [--yes]",
    );
  }
  const email = positional[0]!.trim();
  if (!email.includes("@") || email.length > 320) {
    fail(`'${email}' does not look like a valid email address`);
  }
  return { email, reason, confirm };
}

async function main(): Promise<void> {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) fail("DATABASE_URL is not set");

  const { email, reason, confirm } = parseArgs(process.argv.slice(2));

  const client = postgres(DATABASE_URL, { max: 1, prepare: false });
  const db = drizzle(client);

  try {
    // citext column → case-insensitive equality. Soft-deleted users
    // are excluded explicitly even though the partial unique index
    // already prevents duplicates among live rows.
    const matches = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(2);

    if (matches.length === 0) {
      fail(`no live user found with email '${email}'`);
    }
    if (matches.length > 1) {
      // Should be unreachable — partial unique index on (email) where
      // deleted_at is null. Surfaced here as a sanity check.
      fail(`multiple live users matched '${email}' — refusing to act`);
    }
    const user = matches[0]!;

    const existingRoles = await db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, user.id));
    const roleNames = existingRoles.map((r) => r.role);

    console.log(`${TAG} user found:`);
    console.log(`  id:      ${user.id}`);
    console.log(`  email:   ${user.email}`);
    console.log(`  name:    ${user.name ?? "(none)"}`);
    console.log(`  joined:  ${user.createdAt.toISOString()}`);
    console.log(`  roles:   ${roleNames.length === 0 ? "(none)" : roleNames.join(", ")}`);

    if (roleNames.includes("admin")) {
      console.log(`${TAG} already an admin — nothing to do.`);
      return;
    }

    if (!confirm) {
      console.log(``);
      console.log(`${TAG} this will GRANT the 'admin' role.`);
      console.log(`${TAG} re-run with --yes to confirm:`);
      const reasonFlag = reason ? ` --reason="${reason}"` : "";
      console.log(`  pnpm grant-admin ${user.email}${reasonFlag} --yes`);
      process.exit(2);
    }

    await db.transaction(async (tx) => {
      await tx.insert(userRoles).values({
        userId: user.id,
        role: "admin",
      });
      await tx.insert(auditLog).values({
        // No tRPC actor — CLI is a system action.
        actorType: "system",
        actorUserId: null,
        action: "admin.granted",
        targetType: "user",
        targetId: user.id,
        details: {
          granted_via: "cli",
          granted_role: "admin",
          ...(reason ? { operator_note: reason } : {}),
        } as never,
      });
    });

    console.log(``);
    console.log(`${TAG} granted 'admin' to ${user.email}.`);
    console.log(`${TAG} audit row written (action='admin.granted', target=${user.id}).`);
    if (!reason) {
      console.log(
        `${TAG} tip: pass --reason="..." next time so the audit log carries context.`,
      );
    }
  } finally {
    await client.end({ timeout: 2 });
  }
}

main().catch((err: unknown) => {
  console.error(`${TAG} fatal:`, err);
  process.exit(1);
});
