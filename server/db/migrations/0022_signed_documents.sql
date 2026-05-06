-- Stage 03b. Two unrelated changes bundled by drizzle-kit:
--   1. CREATE TABLE signed_documents — generic e-signature ledger
--      (Phase-1 contractor agreement, Phase-2 applicant docs).
--   2. ALTER TABLE attorney_profiles DROP COLUMN agreement_storage_path
--      DESTRUCTIVE: any existing values are lost. Pre-prod precondition:
--      no production attorneys hold real signatures yet — the dropped
--      column held a synthetic `pending-upload/...` placeholder string
--      (issue #51). RLS for the new table lives in 0023.
CREATE TABLE "signed_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_kind" text NOT NULL,
	"document_version" text NOT NULL,
	"content_hash" text NOT NULL,
	"full_legal_name" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	"rendered_pdf_path" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signed_documents" ADD CONSTRAINT "signed_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signed_documents_user_kind_version_uniq" ON "signed_documents" USING btree ("user_id","document_kind","document_version") WHERE "signed_documents"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "signed_documents_kind_version_idx" ON "signed_documents" USING btree ("document_kind","document_version");--> statement-breakpoint
ALTER TABLE "attorney_profiles" DROP COLUMN "agreement_storage_path";