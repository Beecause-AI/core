-- AI-designed assistant team proposals: reviewable draft stored as JSONB, applied by an admin.
CREATE TABLE "team_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" text DEFAULT 'awaiting_kg' NOT NULL,
	"build_id" uuid,
	"proposal" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "team_proposals" ADD CONSTRAINT "team_proposals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_proposals" ADD CONSTRAINT "team_proposals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_proposals_project" ON "team_proposals" USING btree ("project_id");
