CREATE TABLE "cloudflare_project_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cloudflare_project_connections" ADD CONSTRAINT "cloudflare_project_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloudflare_project_connections" ADD CONSTRAINT "cloudflare_project_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloudflare_project_connections" ADD CONSTRAINT "cloudflare_project_connections_connection_id_cloudflare_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."cloudflare_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cloudflare_project_connections_project" ON "cloudflare_project_connections" USING btree ("project_id");--> statement-breakpoint
INSERT INTO "cloudflare_project_connections" (id, org_id, project_id, connection_id)
SELECT gen_random_uuid(), p.org_id, ct.project_id, (array_agg(ct.connection_id))[1]
FROM "cloudflare_targets" ct
JOIN "projects" p ON p.id = ct.project_id
GROUP BY ct.project_id, p.org_id;