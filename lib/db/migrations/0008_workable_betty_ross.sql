CREATE TYPE "public"."notification_display_mode" AS ENUM('ONCE', 'EVERY_LOGIN');--> statement-breakpoint
CREATE TABLE "notification_dismissals" (
	"id" serial PRIMARY KEY NOT NULL,
	"notification_id" integer NOT NULL,
	"employee_id" text NOT NULL,
	"is_permanent" boolean DEFAULT true NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"display_mode" "notification_display_mode" DEFAULT 'ONCE' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_by_employee_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_dismissals" ADD CONSTRAINT "notification_dismissals_notification_id_platform_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."platform_notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_dismissals" ADD CONSTRAINT "notification_dismissals_employee_id_people_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."people"("employee_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_notifications" ADD CONSTRAINT "platform_notifications_created_by_employee_id_people_employee_id_fk" FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."people"("employee_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dismissals_notif_emp_idx" ON "notification_dismissals" USING btree ("notification_id","employee_id");