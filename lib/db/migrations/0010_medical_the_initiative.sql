CREATE TABLE "user_activity_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"activity_date" date NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sign_in_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_activity_days" ADD CONSTRAINT "user_activity_days_employee_id_people_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."people"("employee_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_activity_days_person_date_uniq" ON "user_activity_days" USING btree ("employee_id","activity_date");--> statement-breakpoint
CREATE INDEX "user_activity_days_date_idx" ON "user_activity_days" USING btree ("activity_date");