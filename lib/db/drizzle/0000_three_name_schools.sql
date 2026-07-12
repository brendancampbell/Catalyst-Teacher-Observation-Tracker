CREATE TYPE "public"."department_enum" AS ENUM('English', 'Math', 'Science', 'History', 'Spanish', 'Physical Education', 'Comp Sci/Engineering', 'Visual Arts', 'College', 'Other');--> statement-breakpoint
CREATE TYPE "public"."person_role" AS ENUM('COACH', 'SCHOOL_LEADER', 'NETWORK_LEADER', 'NETWORK_ADMIN', 'NO_ACCESS');--> statement-breakpoint
CREATE TYPE "public"."evaluation_target" AS ENUM('TEACHER', 'SCHOOL');--> statement-breakpoint
CREATE TYPE "public"."subject_audience" AS ENUM('STEM', 'HUMANITIES', 'ALL');--> statement-breakpoint
CREATE TABLE "schools" (
        "id" serial PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "region" text NOT NULL,
        "grade_span" text NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "is_archived" boolean DEFAULT false NOT NULL
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
        CONSTRAINT "people_email_unique" UNIQUE("email"),
        CONSTRAINT "people_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
CREATE TABLE "rubric_categories" (
        "id" serial PRIMARY KEY NOT NULL,
        "rubric_set_id" integer NOT NULL,
        "name" text NOT NULL,
        "display_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric_domains" (
        "id" serial PRIMARY KEY NOT NULL,
        "category_id" integer NOT NULL,
        "name" text NOT NULL,
        "slug" text NOT NULL,
        "display_order" integer DEFAULT 0 NOT NULL,
        "description" text
);
--> statement-breakpoint
CREATE TABLE "rubric_sets" (
        "id" serial PRIMARY KEY NOT NULL,
        "slug" text NOT NULL,
        "name" text NOT NULL,
        "is_active" boolean DEFAULT false NOT NULL,
        "is_archived" boolean DEFAULT false NOT NULL,
        "grade_span" text,
        "description" text,
        "display_order" integer DEFAULT 0 NOT NULL,
        "target" "evaluation_target" DEFAULT 'TEACHER' NOT NULL,
        "subject_audience" "subject_audience" DEFAULT 'ALL' NOT NULL,
        CONSTRAINT "rubric_sets_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "observation_scores" (
        "id" serial PRIMARY KEY NOT NULL,
        "observation_id" integer NOT NULL,
        "domain_slug" text NOT NULL,
        "score" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observations" (
        "id" serial PRIMARY KEY NOT NULL,
        "observed_employee_id" text,
        "school_id" integer,
        "rubric_set_id" integer NOT NULL,
        "observer_employee_id" text,
        "date" date NOT NULL,
        "course" text,
        "strengths" text,
        "growth_areas" text,
        "observer" text DEFAULT 'Principal Rivera' NOT NULL,
        "time" text,
        "is_walkthrough" boolean DEFAULT false NOT NULL,
        "edited_by_employee_id" text,
        "edited_at" timestamp with time zone,
        "status" text DEFAULT 'published' NOT NULL,
        "target" "evaluation_target" DEFAULT 'TEACHER' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
        "id" serial PRIMARY KEY NOT NULL,
        "session_id" integer NOT NULL,
        "role" text NOT NULL,
        "content" text NOT NULL,
        "rubric_set_slug" text,
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
ALTER TABLE "people" ADD CONSTRAINT "people_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_categories" ADD CONSTRAINT "rubric_categories_rubric_set_id_rubric_sets_id_fk" FOREIGN KEY ("rubric_set_id") REFERENCES "public"."rubric_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_domains" ADD CONSTRAINT "rubric_domains_category_id_rubric_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."rubric_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_scores" ADD CONSTRAINT "observation_scores_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_observed_employee_id_people_employee_id_fk" FOREIGN KEY ("observed_employee_id") REFERENCES "public"."people"("employee_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_rubric_set_id_rubric_sets_id_fk" FOREIGN KEY ("rubric_set_id") REFERENCES "public"."rubric_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_observer_employee_id_people_employee_id_fk" FOREIGN KEY ("observer_employee_id") REFERENCES "public"."people"("employee_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_edited_by_employee_id_people_employee_id_fk" FOREIGN KEY ("edited_by_employee_id") REFERENCES "public"."people"("employee_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_employee_id_people_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."people"("employee_id") ON DELETE cascade ON UPDATE no action;