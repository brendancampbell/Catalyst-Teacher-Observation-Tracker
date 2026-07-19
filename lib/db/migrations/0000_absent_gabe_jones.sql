CREATE TYPE "public"."department_enum" AS ENUM('English', 'Math', 'Science', 'History', 'Spanish', 'Physical Education', 'Comp Sci/Engineering', 'Visual Arts', 'College', 'Other');--> statement-breakpoint
CREATE TYPE "public"."person_role" AS ENUM('COACH', 'SCHOOL_LEADER', 'NETWORK_LEADER', 'NETWORK_ADMIN', 'NO_ACCESS');--> statement-breakpoint
CREATE TYPE "public"."evaluation_target" AS ENUM('TEACHER', 'SCHOOL');--> statement-breakpoint
CREATE TYPE "public"."subject_audience" AS ENUM('STEM', 'HUMANITIES', 'ALL');--> statement-breakpoint
CREATE TYPE "public"."school_year_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."ai_quota_grant_type" AS ENUM('chat', 'generation', 'all');--> statement-breakpoint
CREATE TABLE "schools" (
	"id" serial PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"full_name" text NOT NULL,
	"abbreviation" text NOT NULL,
	"region" text NOT NULL,
	"grade_span" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"is_home_office" boolean DEFAULT false NOT NULL,
	"school_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schools_abbreviation_unique" UNIQUE("abbreviation"),
	CONSTRAINT "schools_school_number_unique" UNIQUE("school_number")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"employee_id" text PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"google_id" text,
	"role" "person_role" DEFAULT 'NO_ACCESS' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"include_in_feedback_tracker" boolean DEFAULT false NOT NULL,
	"school_id" integer,
	"department" "department_enum",
	"grade_level" text[],
	"needs_rescore" boolean DEFAULT false NOT NULL,
	"rescore_due_date" date,
	"rescore_school_year_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_email_unique" UNIQUE("email"),
	CONSTRAINT "people_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
CREATE TABLE "rubric_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"rubric_set_id" integer NOT NULL,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric_domains" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"rubric_set_id" integer NOT NULL,
	"school_year_id" integer NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"school_year_id" integer NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"grade_span" text,
	"description" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"target" "evaluation_target" DEFAULT 'TEACHER' NOT NULL,
	"subject_audience" "subject_audience" DEFAULT 'ALL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observation_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"observation_id" integer NOT NULL,
	"domain_slug" text NOT NULL,
	"score" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"observed_employee_id" text,
	"school_id" integer,
	"school_year_id" integer NOT NULL,
	"rubric_set_id" integer NOT NULL,
	"observer_employee_id" text,
	"date" date NOT NULL,
	"course" text,
	"strengths" text,
	"growth_areas" text,
	"time" time,
	"is_walkthrough" boolean DEFAULT false NOT NULL,
	"edited_by_employee_id" text,
	"updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"target" "evaluation_target" DEFAULT 'TEACHER' NOT NULL,
	"snapshot_grade_span" text
);
--> statement-breakpoint
CREATE TABLE "action_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"teacher_employee_id" text NOT NULL,
	"assigned_by_employee_id" text,
	"assigned_during_observation_id" integer,
	"text" text NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"mastered_at" timestamp with time zone,
	"mastered_by_employee_id" text,
	"mastered_during_observation_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"school_year_id" integer NOT NULL,
	"snapshot_school_id" integer,
	"snapshot_grade_span" text,
	"snapshot_role" text
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"rubric_set_slug" text,
	"instant_analysis_structured" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"title" text DEFAULT 'New Chat' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qualitative_themes_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"rubric_slug" text NOT NULL,
	"result" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"obs_count_at_generation" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_years" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" "school_year_status" DEFAULT 'active' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role" "person_role" NOT NULL,
	"school_id" integer,
	"school_year_id" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_store" (
	"key" text PRIMARY KEY NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_quota_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"grant_type" "ai_quota_grant_type" NOT NULL,
	"extra_requests" integer NOT NULL,
	"used_requests" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"granted_by_employee_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_rescore_school_year_id_school_years_id_fk" FOREIGN KEY ("rescore_school_year_id") REFERENCES "public"."school_years"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_categories" ADD CONSTRAINT "rubric_categories_rubric_set_id_rubric_sets_id_fk" FOREIGN KEY ("rubric_set_id") REFERENCES "public"."rubric_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_domains" ADD CONSTRAINT "rubric_domains_category_id_rubric_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."rubric_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_domains" ADD CONSTRAINT "rubric_domains_rubric_set_id_rubric_sets_id_fk" FOREIGN KEY ("rubric_set_id") REFERENCES "public"."rubric_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_domains" ADD CONSTRAINT "rubric_domains_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_sets" ADD CONSTRAINT "rubric_sets_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_scores" ADD CONSTRAINT "observation_scores_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_observed_employee_id_people_employee_id_fk" FOREIGN KEY ("observed_employee_id") REFERENCES "public"."people"("employee_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_rubric_set_id_rubric_sets_id_fk" FOREIGN KEY ("rubric_set_id") REFERENCES "public"."rubric_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_observer_employee_id_people_employee_id_fk" FOREIGN KEY ("observer_employee_id") REFERENCES "public"."people"("employee_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_edited_by_employee_id_people_employee_id_fk" FOREIGN KEY ("edited_by_employee_id") REFERENCES "public"."people"("employee_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_steps" ADD CONSTRAINT "action_steps_teacher_employee_id_people_employee_id_fk" FOREIGN KEY ("teacher_employee_id") REFERENCES "public"."people"("employee_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_steps" ADD CONSTRAINT "action_steps_assigned_by_employee_id_people_employee_id_fk" FOREIGN KEY ("assigned_by_employee_id") REFERENCES "public"."people"("employee_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_steps" ADD CONSTRAINT "action_steps_assigned_during_observation_id_observations_id_fk" FOREIGN KEY ("assigned_during_observation_id") REFERENCES "public"."observations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_steps" ADD CONSTRAINT "action_steps_mastered_by_employee_id_people_employee_id_fk" FOREIGN KEY ("mastered_by_employee_id") REFERENCES "public"."people"("employee_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_steps" ADD CONSTRAINT "action_steps_mastered_during_observation_id_observations_id_fk" FOREIGN KEY ("mastered_during_observation_id") REFERENCES "public"."observations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_steps" ADD CONSTRAINT "action_steps_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_steps" ADD CONSTRAINT "action_steps_snapshot_school_id_schools_id_fk" FOREIGN KEY ("snapshot_school_id") REFERENCES "public"."schools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_employee_id_people_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."people"("employee_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualitative_themes_cache" ADD CONSTRAINT "qualitative_themes_cache_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_user_id_people_employee_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."people"("employee_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_quota_grants" ADD CONSTRAINT "ai_quota_grants_employee_id_people_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."people"("employee_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_quota_grants" ADD CONSTRAINT "ai_quota_grants_granted_by_employee_id_people_employee_id_fk" FOREIGN KEY ("granted_by_employee_id") REFERENCES "public"."people"("employee_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_domains_year_set_slug_uniq" ON "rubric_domains" USING btree ("school_year_id","rubric_set_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_sets_year_slug_uniq" ON "rubric_sets" USING btree ("school_year_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "observation_scores_obs_domain_uniq" ON "observation_scores" USING btree ("observation_id","domain_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "qt_cache_school_rubric_idx" ON "qualitative_themes_cache" USING btree ("school_id","rubric_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_user_year_active_uniq" ON "assignments" USING btree ("user_id","school_year_id") WHERE "assignments"."end_date" IS NULL;