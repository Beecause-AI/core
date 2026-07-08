ALTER TABLE "org_model_keys" ADD COLUMN "base_url" text;
ALTER TABLE "org_model_keys" ADD COLUMN "last_tested_at" timestamp with time zone;
ALTER TABLE "org_model_keys" ADD COLUMN "last_test_ok" boolean;
