-- Add copilot_enabled flag to projects (project-level opt-in for Copilot issue creation).
-- Add copilot_issue_offers table (soak-parity mirror; runtime source of truth is Firestore).
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "copilot_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "copilot_issue_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"slack_channel_id" text NOT NULL,
	"slack_thread_ts" text NOT NULL,
	"slack_message_ts" text,
	"repo" text,
	"candidate_repos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'offered' NOT NULL,
	"issue_number" integer,
	"issue_url" text,
	"copilot_assigned" boolean DEFAULT false NOT NULL,
	"error" text,
	"decided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
