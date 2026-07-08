CREATE TYPE "public"."queue_status" AS ENUM('queued', 'running', 'failed', 'cancelled', 'done');--> statement-breakpoint
CREATE TYPE "public"."turn_source" AS ENUM('slack', 'web', 'api', 'internal');--> statement-breakpoint
CREATE TYPE "public"."breaker_state_kind" AS ENUM('closed', 'open', 'half_open');--> statement-breakpoint
CREATE TABLE "message_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lane_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"source" "turn_source" NOT NULL,
	"seq" bigint NOT NULL,
	"status" "queue_status" DEFAULT 'queued' NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"breaker_key" text,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "breaker_state" (
	"key" text PRIMARY KEY NOT NULL,
	"state" "breaker_state_kind" DEFAULT 'closed' NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone,
	"next_probe_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_queue" ADD CONSTRAINT "message_queue_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_queue_lane_seq" ON "message_queue" USING btree ("lane_id","seq");--> statement-breakpoint
CREATE INDEX "message_queue_lane_status" ON "message_queue" USING btree ("lane_id","status");--> statement-breakpoint
CREATE INDEX "message_queue_org" ON "message_queue" USING btree ("org_id");