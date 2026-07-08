CREATE TABLE "trace_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(12, 6),
	"error" text
);
--> statement-breakpoint
CREATE TABLE "traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"conversation_id" uuid,
	"turn_id" uuid,
	"source" text DEFAULT 'internal' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"total_input_tokens" integer DEFAULT 0 NOT NULL,
	"total_output_tokens" integer DEFAULT 0 NOT NULL,
	"total_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"model_call_count" integer DEFAULT 0 NOT NULL,
	"tool_call_count" integer DEFAULT 0 NOT NULL,
	"otel_trace_id" text
);
--> statement-breakpoint
ALTER TABLE "trace_steps" ADD CONSTRAINT "trace_steps_trace_id_traces_id_fk" FOREIGN KEY ("trace_id") REFERENCES "public"."traces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traces" ADD CONSTRAINT "traces_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trace_steps_trace" ON "trace_steps" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "traces_conversation" ON "traces" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "traces_org" ON "traces" USING btree ("org_id");