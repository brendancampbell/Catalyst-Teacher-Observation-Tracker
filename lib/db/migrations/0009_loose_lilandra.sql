ALTER TABLE "school_years" ALTER COLUMN "status" SET DEFAULT 'inactive';--> statement-breakpoint
CREATE INDEX "people_school_idx" ON "people" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "people_rescore_school_year_idx" ON "people" USING btree ("rescore_school_year_id");--> statement-breakpoint
CREATE INDEX "rubric_categories_rubric_set_idx" ON "rubric_categories" USING btree ("rubric_set_id");--> statement-breakpoint
CREATE INDEX "rubric_domains_category_idx" ON "rubric_domains" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "rubric_domains_rubric_set_idx" ON "rubric_domains" USING btree ("rubric_set_id");--> statement-breakpoint
CREATE INDEX "observations_school_year_idx" ON "observations" USING btree ("school_year_id");--> statement-breakpoint
CREATE INDEX "observations_observed_employee_idx" ON "observations" USING btree ("observed_employee_id");--> statement-breakpoint
CREATE INDEX "observations_school_idx" ON "observations" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "observations_rubric_set_idx" ON "observations" USING btree ("rubric_set_id");--> statement-breakpoint
CREATE INDEX "observations_observer_idx" ON "observations" USING btree ("observer_employee_id");--> statement-breakpoint
CREATE INDEX "action_steps_teacher_idx" ON "action_steps" USING btree ("teacher_employee_id");--> statement-breakpoint
CREATE INDEX "action_steps_school_year_idx" ON "action_steps" USING btree ("school_year_id");--> statement-breakpoint
CREATE INDEX "action_steps_snapshot_school_idx" ON "action_steps" USING btree ("snapshot_school_id");--> statement-breakpoint
CREATE INDEX "action_steps_assigned_during_obs_idx" ON "action_steps" USING btree ("assigned_during_observation_id");--> statement-breakpoint
CREATE INDEX "action_steps_mastered_during_obs_idx" ON "action_steps" USING btree ("mastered_during_observation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "school_years_single_active_uniq" ON "school_years" USING btree ("status") WHERE "school_years"."status" = 'active';--> statement-breakpoint
CREATE INDEX "ai_quota_grants_employee_idx" ON "ai_quota_grants" USING btree ("employee_id");