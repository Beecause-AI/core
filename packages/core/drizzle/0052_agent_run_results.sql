-- Accumulate per-call sub-agent results on the bridge so a batch of parallel delegations can run
-- one at a time and the parent resumes only once ALL results are in (no "one per step" placeholder).
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "results" jsonb DEFAULT '{}'::jsonb NOT NULL;
