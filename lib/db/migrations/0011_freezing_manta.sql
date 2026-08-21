CREATE TABLE "action_step_extensions" (
	"id" serial PRIMARY KEY NOT NULL,
	"action_step_id" integer NOT NULL,
	"extended_by_employee_id" text,
	"extended_during_observation_id" integer,
	"previous_due_date" date NOT NULL,
	"new_due_date" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_step_extensions" ADD CONSTRAINT "action_step_extensions_action_step_id_action_steps_id_fk" FOREIGN KEY ("action_step_id") REFERENCES "public"."action_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_step_extensions" ADD CONSTRAINT "action_step_extensions_extended_by_employee_id_people_employee_id_fk" FOREIGN KEY ("extended_by_employee_id") REFERENCES "public"."people"("employee_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_step_extensions" ADD CONSTRAINT "action_step_extensions_extended_during_observation_id_observations_id_fk" FOREIGN KEY ("extended_during_observation_id") REFERENCES "public"."observations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_step_extensions_step_idx" ON "action_step_extensions" USING btree ("action_step_id");