-- Single-flight: at most one active RCA per incident conversation.
ALTER TABLE "conversations" ADD COLUMN "status" text DEFAULT 'idle' NOT NULL;
