ALTER TABLE "schools" DROP CONSTRAINT "schools_school_number_unique";--> statement-breakpoint
ALTER TABLE "observations" ALTER COLUMN "time" SET DATA TYPE text;