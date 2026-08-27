CREATE TABLE "system_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"rescore_window_days" integer DEFAULT 14 NOT NULL,
	"overdue_window_days" integer DEFAULT 14 NOT NULL,
	"rescore_updated_at" timestamp with time zone,
	"rescore_updated_by" text,
	"overdue_updated_at" timestamp with time zone,
	"overdue_updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "rescore_from_date" date;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_rescore_updated_by_people_employee_id_fk" FOREIGN KEY ("rescore_updated_by") REFERENCES "public"."people"("employee_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_overdue_updated_by_people_employee_id_fk" FOREIGN KEY ("overdue_updated_by") REFERENCES "public"."people"("employee_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "system_settings_single_row_uniq" ON "system_settings" USING btree ("id") WHERE "system_settings"."id" = 1;--> statement-breakpoint

-- MIGRATE-DATA: seed the single settings row and backfill rescore_from_date
-- ⚠️  DATA BACKFILL — creates the settings row, and records the walkthrough
-- date for teachers already in the rescore queue.
--
-- The defaults are 14 days for both windows, which is exactly what was
-- hardcoded, so deploying this changes nothing until somebody moves a control.
--
-- rescore_from_date is the observation date a rescore deadline was measured
-- from. Rows flagged before the column existed have no value, so it is derived
-- from the due date minus the window in force at the time — 14 days, since
-- that is the only value there has ever been. Without this, the first change
-- to the rescore window could not recalculate anybody already in the queue.
INSERT INTO system_settings (id) VALUES (1) ON CONFLICT DO NOTHING;--> statement-breakpoint

UPDATE people
   SET rescore_from_date = (rescore_due_date - INTERVAL '14 days')::date
 WHERE needs_rescore = true
   AND rescore_due_date IS NOT NULL
   AND rescore_from_date IS NULL;
