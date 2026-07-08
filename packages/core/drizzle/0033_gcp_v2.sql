-- GCP v2: connections + project binding + scope rework (mirrors cloudflare 0030/0031).
CREATE TABLE "gcp_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"mode" text NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"secret_hint" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_ok" boolean,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gcp_project_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gcp_connections" ADD CONSTRAINT "gcp_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gcp_connections" ADD CONSTRAINT "gcp_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gcp_project_connections" ADD CONSTRAINT "gcp_project_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gcp_project_connections" ADD CONSTRAINT "gcp_project_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gcp_project_connections" ADD CONSTRAINT "gcp_project_connections_connection_id_gcp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."gcp_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gcp_connections_org" ON "gcp_connections" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gcp_connections_org_project_name" ON "gcp_connections" USING btree ("org_id","project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "gcp_project_connections_project" ON "gcp_project_connections" USING btree ("project_id");--> statement-breakpoint

-- Backfill 1: org-shared connection from each org_integrations(gcp) row.
INSERT INTO "gcp_connections" (id, org_id, project_id, name, mode, secret_ciphertext, secret_hint, metadata, enabled, last_tested_at, last_test_ok, created_by_user_id)
SELECT gen_random_uuid(), oi.org_id, NULL, 'GCP (imported)', oi.mode, oi.secret_ciphertext, oi.secret_hint, oi.metadata, oi.enabled, oi.last_tested_at, oi.last_test_ok, oi.connected_by_user_id
FROM "org_integrations" oi
WHERE oi.provider = 'gcp' AND oi.secret_ciphertext IS NOT NULL;--> statement-breakpoint

-- Backfill 2: project-owned connection from each STANDALONE gcp_target (has its own creds).
INSERT INTO "gcp_connections" (id, org_id, project_id, name, mode, secret_ciphertext, metadata, enabled, created_by_user_id)
SELECT gen_random_uuid(), p.org_id, gt.project_id,
       'GCP — ' || COALESCE(NULLIF(gt.label, ''), gt.gcp_project_id),
       gt.mode, gt.secret_ciphertext, gt.metadata, true, gt.added_by_user_id
FROM "gcp_targets" gt
JOIN "projects" p ON p.id = gt.project_id
WHERE gt.mode IS NOT NULL AND gt.secret_ciphertext IS NOT NULL;--> statement-breakpoint

-- Backfill 3: a project binding per project that has targets. Prefer the inherited
-- org connection; else the first standalone-derived (project-owned) connection.
INSERT INTO "gcp_project_connections" (id, org_id, project_id, connection_id)
SELECT gen_random_uuid(), p.org_id, gt.project_id,
       COALESCE(
         (SELECT c.id FROM "gcp_connections" c WHERE c.org_id = p.org_id AND c.project_id IS NULL LIMIT 1),
         (SELECT c.id FROM "gcp_connections" c WHERE c.project_id = gt.project_id ORDER BY c.created_at LIMIT 1)
       )
FROM "gcp_targets" gt
JOIN "projects" p ON p.id = gt.project_id
GROUP BY p.org_id, gt.project_id;--> statement-breakpoint

-- Rework gcp_targets into pure scope: add connection_id, backfill from the binding, drop creds columns.
ALTER TABLE "gcp_targets" ADD COLUMN "connection_id" uuid;--> statement-breakpoint
UPDATE "gcp_targets" gt SET "connection_id" = pc.connection_id
FROM "gcp_project_connections" pc WHERE pc.project_id = gt.project_id;--> statement-breakpoint
-- Drop any target with no derivable connection (matches cloudflare 0030) so SET NOT NULL never aborts.
DELETE FROM "gcp_targets" WHERE "connection_id" IS NULL;--> statement-breakpoint
ALTER TABLE "gcp_targets" ALTER COLUMN "connection_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "gcp_targets" ADD CONSTRAINT "gcp_targets_connection_id_gcp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."gcp_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gcp_targets" DROP COLUMN IF EXISTS "mode";--> statement-breakpoint
ALTER TABLE "gcp_targets" DROP COLUMN IF EXISTS "secret_ciphertext";--> statement-breakpoint
ALTER TABLE "gcp_targets" DROP COLUMN IF EXISTS "org_integration_id";--> statement-breakpoint

-- Remove the migrated GCP org integration rows.
DELETE FROM "org_integrations" WHERE provider = 'gcp';
