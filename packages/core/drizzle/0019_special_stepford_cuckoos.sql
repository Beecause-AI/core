CREATE TABLE "mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"auth_type" text DEFAULT 'none' NOT NULL,
	"secret_ciphertext" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_servers_org_name" ON "mcp_servers" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "mcp_servers_org" ON "mcp_servers" USING btree ("org_id");