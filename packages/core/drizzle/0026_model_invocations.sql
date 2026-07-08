CREATE TABLE "model_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"source" text NOT NULL,
	"model" text NOT NULL,
	"provider" text,
	"conversation_id" uuid,
	"build_id" uuid,
	"phase" text,
	"messages" jsonb,
	"output" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(12, 6),
	"latency_ms" integer,
	"status" text NOT NULL,
	"error" text,
	"truncated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_invocations_created" ON "model_invocations" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_invocations_source" ON "model_invocations" ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_invocations_model" ON "model_invocations" ("model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_invocations_org" ON "model_invocations" ("org_id");
