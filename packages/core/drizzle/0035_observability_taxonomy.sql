-- Observability taxonomy: roll every model invocation up to a Conversation (incident) or Operation.
ALTER TABLE "conversations" ADD COLUMN "root_conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "model_invocations" ADD COLUMN "operation_id" uuid;--> statement-breakpoint
CREATE TABLE "operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"kind" text NOT NULL,
	"parent_conversation_id" uuid,
	"ref_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"cost_usd" numeric(12, 6),
	"input_tokens" integer,
	"output_tokens" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_root" ON "conversations" USING btree ("root_conversation_id");--> statement-breakpoint
CREATE INDEX "model_invocations_operation" ON "model_invocations" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "operations_org" ON "operations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "operations_kind" ON "operations" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "operations_parent" ON "operations" USING btree ("parent_conversation_id");--> statement-breakpoint
CREATE INDEX "operations_started" ON "operations" USING btree ("started_at");
