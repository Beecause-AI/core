ALTER TABLE "trace_steps" ADD COLUMN "args_preview" text;--> statement-breakpoint
ALTER TABLE "trace_steps" ADD COLUMN "result_preview" text;--> statement-breakpoint
ALTER TABLE "trace_steps" ADD COLUMN "child_conversation_id" uuid;