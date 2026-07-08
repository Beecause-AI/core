ALTER TABLE "organizations" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "oidc_client_secret" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "pending_email" text;
