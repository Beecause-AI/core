CREATE TABLE "gcp_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"gcp_project_id" text NOT NULL,
	"label" text,
	"org_integration_id" uuid,
	"mode" text,
	"secret_ciphertext" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"added_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gcp_targets" ADD CONSTRAINT "gcp_targets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gcp_targets" ADD CONSTRAINT "gcp_targets_org_integration_id_org_integrations_id_fk" FOREIGN KEY ("org_integration_id") REFERENCES "public"."org_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gcp_targets_project_id" ON "gcp_targets" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gcp_targets_project_gcp" ON "gcp_targets" USING btree ("project_id","gcp_project_id");