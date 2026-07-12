ALTER TABLE "schools" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "full_name" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "abbreviation" text;--> statement-breakpoint
UPDATE "schools" SET "display_name" = "name";--> statement-breakpoint
ALTER TABLE "schools" ALTER COLUMN "display_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "schools" DROP COLUMN "name";
