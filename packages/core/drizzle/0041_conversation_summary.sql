ALTER TABLE "conversations" ADD COLUMN "summary" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "assistant_id" DROP NOT NULL;
