-- Backfill: one Default project per org that has assistants; owners become its admins.
INSERT INTO "projects" ("org_id", "name", "slug")
SELECT DISTINCT a."org_id", 'Default', 'default'
FROM "assistants" a
WHERE NOT EXISTS (
  SELECT 1 FROM "projects" p WHERE p."org_id" = a."org_id" AND p."slug" = 'default'
);
--> statement-breakpoint
INSERT INTO "project_members" ("project_id", "user_id", "role")
SELECT p."id", m."user_id", 'admin'
FROM "projects" p
JOIN "org_members" m ON m."org_id" = p."org_id" AND m."role" IN ('owner','admin')
WHERE p."slug" = 'default'
ON CONFLICT ("project_id","user_id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "assistants" ADD COLUMN "project_id" uuid;
--> statement-breakpoint
UPDATE "assistants" a
SET "project_id" = p."id"
FROM "projects" p
WHERE p."org_id" = a."org_id" AND p."slug" = 'default';
--> statement-breakpoint
DROP INDEX IF EXISTS "assistants_org_id";
--> statement-breakpoint
ALTER TABLE "assistants" DROP COLUMN "org_id";
--> statement-breakpoint
ALTER TABLE "assistants" ALTER COLUMN "project_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "assistants" ADD CONSTRAINT "assistants_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "assistants_project_id" ON "assistants" USING btree ("project_id");
