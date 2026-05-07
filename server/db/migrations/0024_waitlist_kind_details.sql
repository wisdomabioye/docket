ALTER TABLE "waitlist_entries" ADD COLUMN "kind" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "details" jsonb;