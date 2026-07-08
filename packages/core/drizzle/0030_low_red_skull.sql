CREATE TABLE "cloudflare_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"mode" text NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_ok" boolean,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cloudflare_connections" ADD CONSTRAINT "cloudflare_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloudflare_connections" ADD CONSTRAINT "cloudflare_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cloudflare_connections_org" ON "cloudflare_connections" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cloudflare_connections_org_project_name" ON "cloudflare_connections" USING btree ("org_id","project_id","name");--> statement-breakpoint
-- (cloudflare_connections table + indexes created above by drizzle)

-- Migrate the single org cloudflare credential into an org-shared connection.
INSERT INTO "cloudflare_connections" (id, org_id, project_id, name, mode, secret_ciphertext, metadata, enabled, last_tested_at, last_test_ok, created_by_user_id)
SELECT gen_random_uuid(), oi.org_id, NULL, 'Cloudflare', oi.mode, oi.secret_ciphertext, oi.metadata, oi.enabled, oi.last_tested_at, oi.last_test_ok, oi.connected_by_user_id
FROM "org_integrations" oi
WHERE oi.provider = 'cloudflare' AND oi.secret_ciphertext IS NOT NULL;--> statement-breakpoint

-- Add new columns nullable first.
ALTER TABLE "cloudflare_targets" ADD COLUMN "connection_id" uuid;--> statement-breakpoint
ALTER TABLE "cloudflare_targets" ADD COLUMN "worker_scripts" jsonb;--> statement-breakpoint

-- Inherited targets -> the migrated org connection.
UPDATE "cloudflare_targets" ct SET connection_id = c.id
FROM "cloudflare_connections" c
WHERE c.project_id IS NULL AND c.org_id = (SELECT p.org_id FROM "projects" p WHERE p.id = ct.project_id)
  AND ct.org_integration_id IS NOT NULL;--> statement-breakpoint

-- Standalone targets (own creds) -> a project-owned connection each.
INSERT INTO "cloudflare_connections" (id, org_id, project_id, name, mode, secret_ciphertext, metadata, created_by_user_id)
SELECT gen_random_uuid(), p.org_id, ct.project_id, 'Imported (' || ct.name || ')', ct.mode, ct.secret_ciphertext, '{}'::jsonb, ct.added_by_user_id
FROM "cloudflare_targets" ct JOIN "projects" p ON p.id = ct.project_id
WHERE ct.mode IS NOT NULL AND ct.secret_ciphertext IS NOT NULL AND ct.connection_id IS NULL;--> statement-breakpoint

UPDATE "cloudflare_targets" ct SET connection_id = c.id
FROM "cloudflare_connections" c
WHERE c.project_id = ct.project_id AND c.name = 'Imported (' || ct.name || ')' AND ct.connection_id IS NULL;--> statement-breakpoint

-- Any target still unlinked is unusable.
DELETE FROM "cloudflare_targets" WHERE connection_id IS NULL;--> statement-breakpoint

ALTER TABLE "cloudflare_targets" ALTER COLUMN "connection_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cloudflare_targets" ADD CONSTRAINT "cloudflare_targets_connection_id_fk"
  FOREIGN KEY ("connection_id") REFERENCES "cloudflare_connections"("id") ON DELETE cascade;--> statement-breakpoint

-- Drop old creds columns.
ALTER TABLE "cloudflare_targets" DROP COLUMN IF EXISTS "org_integration_id";--> statement-breakpoint
ALTER TABLE "cloudflare_targets" DROP COLUMN IF EXISTS "mode";--> statement-breakpoint
ALTER TABLE "cloudflare_targets" DROP COLUMN IF EXISTS "secret_ciphertext";--> statement-breakpoint

-- Cloudflare no longer uses org_integrations.
DELETE FROM "org_integrations" WHERE provider = 'cloudflare';
