CREATE TABLE "integration_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"category" text NOT NULL,
	"event_type" text NOT NULL,
	"action" text,
	"delivery_id" text NOT NULL,
	"repo_full_name" text,
	"actor_login" text,
	"mentions_bot" boolean DEFAULT false NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_install_states" (
	"nonce" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"mode" text NOT NULL,
	"base_url" text,
	"account_label" text,
	"secret_ciphertext" text,
	"secret_hint" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_ok" boolean,
	"connected_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_install_states" ADD CONSTRAINT "integration_install_states_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_integrations" ADD CONSTRAINT "org_integrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_events_delivery" ON "integration_events" USING btree ("delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_integrations_org_provider" ON "org_integrations" USING btree ("org_id","provider");