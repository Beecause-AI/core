-- showCostUsd org-admin opt-in flag (off by default).
ALTER TABLE "organizations" ADD COLUMN "show_cost_usd" boolean DEFAULT false NOT NULL;
