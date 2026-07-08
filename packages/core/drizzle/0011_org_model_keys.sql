CREATE TABLE "org_model_keys" (
	"org_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"key_ciphertext" text NOT NULL,
	"key_hint" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_model_keys" ADD CONSTRAINT "org_model_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_model_keys_org_provider" ON "org_model_keys" USING btree ("org_id","provider");