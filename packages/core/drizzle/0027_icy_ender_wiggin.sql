ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "idp_tenant_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "sso_provider" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "sso_enabled" boolean DEFAULT false NOT NULL;