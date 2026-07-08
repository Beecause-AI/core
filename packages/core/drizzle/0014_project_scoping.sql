CREATE TABLE "github_repo_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_integration_id" uuid NOT NULL,
	"repo_full_name" text NOT NULL,
	"default_branch" text,
	"private" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_integration_id" uuid NOT NULL,
	"repo_full_name" text NOT NULL,
	"default_branch" text,
	"added_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "github_repo_catalog" ADD CONSTRAINT "github_repo_catalog_org_integration_id_org_integrations_id_fk" FOREIGN KEY ("org_integration_id") REFERENCES "public"."org_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repos" ADD CONSTRAINT "project_repos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repos" ADD CONSTRAINT "project_repos_org_integration_id_org_integrations_id_fk" FOREIGN KEY ("org_integration_id") REFERENCES "public"."org_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_repo_catalog_integration_repo" ON "github_repo_catalog" USING btree ("org_integration_id","repo_full_name");--> statement-breakpoint
CREATE INDEX "project_repos_project_id" ON "project_repos" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_repos_project_repo" ON "project_repos" USING btree ("project_id","repo_full_name");