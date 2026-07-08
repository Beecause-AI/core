-- A Slack channel no longer links to a specific assistant. Bound channels route through the
-- Slack system agent, which delegates to the project's orchestrator. Dropping the column also
-- drops its FK to assistants.
ALTER TABLE "slack_channel_bindings" DROP COLUMN IF EXISTS "assistant_id";
