CREATE TABLE "github_catalog_sync" (
	"org_integration_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"next_cursor" text,
	"repo_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "github_catalog_sync" ADD CONSTRAINT "github_catalog_sync_org_integration_id_org_integrations_id_fk" FOREIGN KEY ("org_integration_id") REFERENCES "public"."org_integrations"("id") ON DELETE cascade ON UPDATE no action;