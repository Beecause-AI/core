ALTER TABLE "assistants" ADD COLUMN "source_proposal_id" uuid;
ALTER TABLE "assistants" ADD COLUMN "user_modified" boolean DEFAULT false NOT NULL;
ALTER TABLE "projects" ADD COLUMN "active_proposal_id" uuid;
ALTER TABLE "team_proposals" ADD COLUMN "version" integer;
--> statement-breakpoint
ALTER TABLE "assistants" ADD CONSTRAINT "assistants_source_proposal_id_team_proposals_id_fk" FOREIGN KEY ("source_proposal_id") REFERENCES "team_proposals"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_active_proposal_id_team_proposals_id_fk" FOREIGN KEY ("active_proposal_id") REFERENCES "team_proposals"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Backfill version labels for existing usable versions, ordered by creation per project.
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY created_at) AS rn
  FROM team_proposals
  WHERE status IN ('ready', 'applied')
)
UPDATE team_proposals t SET version = o.rn FROM ordered o WHERE t.id = o.id;
