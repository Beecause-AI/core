-- Hindsight agent opt-in flag (org-scoped, off by default).
ALTER TABLE "organizations" ADD COLUMN "hindsight_enabled" boolean DEFAULT false NOT NULL;
