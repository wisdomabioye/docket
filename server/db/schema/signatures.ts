import { sql } from "drizzle-orm";
import {
  index,
  inet,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

/**
 * Generic e-signature ledger. Phase 1 records the contractor agreement
 * each attorney signs at onboarding (`document_kind =
 * 'contractor_agreement'`). Phase 2 will reuse the same table for
 * applicant-side engagement letters and other one-sided agreements —
 * `document_kind` stays `text` (no enum) following the convention in
 * `enums.ts` for vocabularies that grow over time.
 *
 * `content_hash` is the sha256 of the exact bytes the signer saw. The
 * version constant on the server (e.g. `CONTRACTOR_AGREEMENT_VERSION`)
 * pins what "the latest body" means, but the row's own hash is the
 * legal record of what was actually signed. If the on-disk body is
 * edited without bumping the version, signers' rows already in the DB
 * keep their original hash; new signing attempts hit a `z.literal`
 * mismatch on the server and fail input validation.
 *
 * Append-only from the user side: only an admin can revoke (write
 * `revoked_at`). RLS migration `0023_*` enforces this.
 */
export const signedDocuments = pgTable(
  "signed_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    /** Discriminator: `'contractor_agreement'` today; future kinds
     *  added in `lib/constants.ts` `SIGNED_DOCUMENT_KINDS`. */
    documentKind: text("document_kind").notNull(),
    documentVersion: text("document_version").notNull(),

    /** sha256 hex (lowercase) of the bytes the signer rendered. */
    contentHash: text("content_hash").notNull(),

    /** Typed legal name as the signer entered it. ESIGN/UETA intent
     *  is captured as a separate intent checkbox client-side; this
     *  field is the name itself. */
    fullLegalName: text("full_legal_name").notNull(),

    signedAt: timestamp("signed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),

    /** Storage key for the rendered signed PDF. Populated inside the
     *  same tx as the row insert (PDF render → storage put → INSERT).
     *  Never updated after creation. */
    renderedPdfPath: text("rendered_pdf_path"),

    /** Admin-only revocation. Phase 1 has no UI for this; the column
     *  exists so the unique-index `where revoked_at is null` predicate
     *  works without a Phase-2 migration. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One un-revoked signature per (user, kind, version). Idempotent
    // inserts in `signContractorAgreement` rely on this — concurrent
    // double-clicks lose the race and the loser fetches the winning
    // row instead of inserting a duplicate.
    uniqueIndex("signed_documents_user_kind_version_uniq")
      .on(t.userId, t.documentKind, t.documentVersion)
      .where(sql`${t.revokedAt} is null`),
    // Admin lookups: "every active contractor v1 signature".
    index("signed_documents_kind_version_idx").on(
      t.documentKind,
      t.documentVersion,
    ),
  ],
);
