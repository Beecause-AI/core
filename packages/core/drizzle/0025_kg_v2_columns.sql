ALTER TABLE "kg_builds" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "kg_builds" ADD COLUMN "phase" text;--> statement-breakpoint
ALTER TABLE "kg_nodes" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kg_builds_org_project_status" ON "kg_builds" ("org_id","project_id","status");
