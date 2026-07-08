CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"slack_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"assistant_id" uuid NOT NULL,
	"source" text DEFAULT 'slack' NOT NULL,
	"slack_channel_id" text,
	"slack_thread_ts" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_channel_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_integration_id" uuid NOT NULL,
	"slack_channel_id" text NOT NULL,
	"channel_name" text,
	"project_id" uuid,
	"assistant_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assistant_id_assistants_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_channel_bindings" ADD CONSTRAINT "slack_channel_bindings_org_integration_id_org_integrations_id_fk" FOREIGN KEY ("org_integration_id") REFERENCES "public"."org_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_channel_bindings" ADD CONSTRAINT "slack_channel_bindings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_channel_bindings" ADD CONSTRAINT "slack_channel_bindings_assistant_id_assistants_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_seq" ON "conversation_messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE INDEX "conversation_messages_conversation" ON "conversation_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_slack_thread" ON "conversations" USING btree ("slack_channel_id","slack_thread_ts");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_channel_bindings_channel" ON "slack_channel_bindings" USING btree ("org_integration_id","slack_channel_id");