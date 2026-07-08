ALTER TABLE "trace_steps" ADD COLUMN "args" text;
ALTER TABLE "trace_steps" ADD COLUMN "result" text;
ALTER TABLE "trace_steps" ADD COLUMN "truncated" boolean DEFAULT false NOT NULL;
