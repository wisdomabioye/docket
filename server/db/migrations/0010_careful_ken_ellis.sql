ALTER TABLE "waitlist_entries" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
-- FK declared here (not in Drizzle schema) to avoid the marketing.ts → users.ts
-- circular import. ON DELETE SET NULL: deleting an admin's user row preserves
-- the historical approval (we just lose the link to the actor).
ALTER TABLE "waitlist_entries"
  ADD CONSTRAINT "waitlist_entries_approved_by_users_id_fk"
  FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX "waitlist_entries_email_approved_idx" ON "waitlist_entries" USING btree ("email") WHERE "waitlist_entries"."approved_at" is not null and "waitlist_entries"."deleted_at" is null;