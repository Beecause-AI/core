CREATE TABLE "cloudflare_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"account_id" text NOT NULL,
	"zone_id" text,
	"name" text NOT NULL,
	"label" text,
	"org_integration_id" uuid,
	"mode" text,
	"secret_ciphertext" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"added_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cloudflare_targets" ADD CONSTRAINT "cloudflare_targets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloudflare_targets" ADD CONSTRAINT "cloudflare_targets_org_integration_id_org_integrations_id_fk" FOREIGN KEY ("org_integration_id") REFERENCES "public"."org_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cloudflare_targets_project_id" ON "cloudflare_targets" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cloudflare_targets_project_scope" ON "cloudflare_targets" USING btree ("project_id","kind","account_id","zone_id");