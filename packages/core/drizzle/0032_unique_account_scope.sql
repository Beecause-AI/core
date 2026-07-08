-- The original unique index on (project_id, kind, account_id, zone_id) let
-- duplicate ACCOUNT scopes through, because account rows have zone_id = NULL and
-- Postgres treats NULLs as distinct in a unique index. Rebuild it over
-- coalesce(zone_id, '') so NULL zone_ids collide.
DROP INDEX "cloudflare_targets_project_scope";--> statement-breakpoint
CREATE UNIQUE INDEX "cloudflare_targets_project_scope" ON "cloudflare_targets" USING btree ("project_id","kind","account_id",coalesce("zone_id", ''));
