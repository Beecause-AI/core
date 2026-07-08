CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"turn_id" uuid NOT NULL,
	"lane_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"status" text DEFAULT 'suspended' NOT NULL,
	"messages" jsonb NOT NULL,
	"pending_calls" jsonb NOT NULL,
	"model" text NOT NULL,
	"enabled_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"slack" jsonb,
	"otel_trace_id" text,
	"approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "approval_policy" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "approval_policy" jsonb;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_lane" ON "agent_runs" USING btree ("lane_id");--> statement-breakpoint
CREATE INDEX "agent_runs_status" ON "agent_runs" USING btree ("status");