-- Knowledge Graph feature flag (org-scoped, off by default; toggled in super console).
ALTER TABLE "organizations" ADD COLUMN "kg_enabled" boolean DEFAULT false NOT NULL;
