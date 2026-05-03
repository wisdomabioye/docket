import "server-only";

/**
 * Recipient + display-data resolution for notification listeners. The
 * full set of "who gets the email and what does the case look like in
 * the body" lives here so each listener stays a 5-line glue function.
 *
 * No PII echoed in errors (we return `null` and let the listener log
 * with `caseId` only). Only the email body itself ever sees recipient
 * names or beneficiary names.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { cases, caseParticipants, caseOutputs } from "@/server/db/schema";
import { users } from "@/server/db/schema/auth";
import { env } from "@/config/env";
import { APP_ROUTES } from "@/config/app.routes";
import {
  BeneficiaryDataSchema,
  type BeneficiaryData,
} from "@/server/db/schema/zod/beneficiary";
import { OUTPUT_TYPE_DISPLAY } from "@/lib/output-types";

/** Build an absolute URL into the deployed app. The Next env var holds
 *  the canonical origin; we strip a trailing slash so callers can pass
 *  an `APP_ROUTES.x()` path verbatim. */
export function appUrl(path: string): string {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  return `${base}${path}`;
}

/** "Maria Gonzalez · O-1A" — the canonical case display label used in
 *  every email subject and body. Falls back gracefully when the
 *  attorney hasn't entered beneficiary info yet (intake stage); the
 *  email still ships rather than failing on a missing field. */
export function buildCaseLabel(args: {
  beneficiaryData: BeneficiaryData | null | unknown;
  visaType: string;
}): string {
  const parsed = parseBeneficiary(args.beneficiaryData);
  const name = parsed?.fullName?.trim() || "Untitled case";
  return `${name} · ${args.visaType}`;
}

function parseBeneficiary(raw: unknown): BeneficiaryData | null {
  if (!raw) return null;
  const result = BeneficiaryDataSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export type CaseRecipient = {
  /** Primary attorney's user id — also used as the analytics distinctId. */
  userId: string;
  /** Display name for the email greeting. Falls back to email
   *  local-part when the user record has no name yet. */
  name: string;
  /** SMTP-deliverable address. */
  email: string;
  /** "Maria Gonzalez · O-1A" — pre-built so listeners don't reach back
   *  into the cases row. */
  caseLabel: string;
};

/**
 * Resolve the primary attorney + case-display payload for `caseId`.
 * Returns `null` when:
 *   - the case row is missing or soft-deleted,
 *   - no primary participant exists (data integrity gap; logged once),
 *   - the participant's user has no email (shouldn't happen in prod;
 *     auth requires email).
 *
 * Single round-trip. RLS bypassed because this runs inside an Inngest
 * worker (system context) — the `db` client is the service-role
 * connection.
 */
export async function resolveCaseRecipient(
  caseId: string,
): Promise<CaseRecipient | null> {
  const rows = await db
    .select({
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      visaType: cases.visaType,
      beneficiaryData: cases.beneficiaryData,
    })
    .from(cases)
    .innerJoin(
      caseParticipants,
      and(
        eq(caseParticipants.caseId, cases.id),
        eq(caseParticipants.isPrimary, true),
        isNull(caseParticipants.removedAt),
      ),
    )
    .innerJoin(users, eq(users.id, caseParticipants.userId))
    .where(and(eq(cases.id, caseId), isNull(cases.deletedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (!row.userEmail) return null;

  return {
    userId: row.userId,
    name: nameOrLocalPart(row.userName, row.userEmail),
    email: row.userEmail,
    caseLabel: buildCaseLabel({
      beneficiaryData: row.beneficiaryData,
      visaType: row.visaType,
    }),
  };
}

/** Look up a single user (used by signup.welcome + admin.invite paths
 *  where the email key isn't a case). */
export async function resolveUserRecipient(userId: string): Promise<{
  userId: string;
  name: string;
  email: string;
} | null> {
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row || !row.email) return null;
  return {
    userId: row.id,
    name: nameOrLocalPart(row.name, row.email),
    email: row.email,
  };
}

/** Greeting fallback. Empty/null `name` would render "Hi ," — better to
 *  pull the local-part of the email so the email still feels addressed. */
export function nameOrLocalPart(
  name: string | null | undefined,
  email: string,
): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  const localPart = email.split("@")[0] ?? email;
  return localPart;
}

/** Resolve display label for a case_outputs row — used by the
 *  output-approved notifier. Returns null when the output is missing or
 *  doesn't belong to the given case (defense-in-depth against a
 *  cross-tenant id mix-up at the emit site). */
export async function resolveOutputLabel(args: {
  caseId: string;
  outputId: string;
}): Promise<string | null> {
  const rows = await db
    .select({
      outputType: caseOutputs.outputType,
      title: caseOutputs.title,
      caseId: caseOutputs.caseId,
    })
    .from(caseOutputs)
    .where(and(eq(caseOutputs.id, args.outputId), isNull(caseOutputs.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.caseId !== args.caseId) return null;
  // Prefer the saved title (e.g. recommender's name on a recommendation
  // letter) so the email points at exactly the row the attorney
  // approved. Fall back to the type's display label.
  return row.title?.trim() || OUTPUT_TYPE_DISPLAY[row.outputType];
}

/** Count approved outputs on a case — feeds `package.ready` body copy. */
export async function countApprovedOutputs(caseId: string): Promise<number> {
  const rows = await db
    .select({ id: caseOutputs.id })
    .from(caseOutputs)
    .where(
      and(
        eq(caseOutputs.caseId, caseId),
        eq(caseOutputs.attorneyApproved, true),
        eq(caseOutputs.isCurrent, true),
        isNull(caseOutputs.deletedAt),
      ),
    );
  return rows.length;
}

/** Convenience helpers so listeners don't repeat `appUrl(APP_ROUTES.x(id))`. */
export const caseUrl = (caseId: string) => appUrl(APP_ROUTES.case(caseId));
export const caseOutputsUrl = (caseId: string) =>
  appUrl(APP_ROUTES.caseOutputs(caseId));
export const casePackageUrl = (caseId: string) =>
  appUrl(APP_ROUTES.casePackage(caseId));
export const outputUrl = (caseId: string, outputId: string) =>
  appUrl(APP_ROUTES.output(caseId, outputId));
export const dashboardUrl = () => appUrl(APP_ROUTES.dashboard);
export const signInUrl = () => appUrl(APP_ROUTES.login);
