import { getIntegration, type IntegrationMetadata } from '../repos/org-integrations.js';
import { getProject } from '../repos/projects.js';
import type { Db } from '../store/firestore.js';
import type { Project } from '../store/types.js';

/** Legacy back-compat shim: before issue creation was split out from the (now-removed)
 *  Copilot hand-off, a single `copilotEnabled` flag gated both. We still read it as a
 *  fallback for a missing `issuesEnabled` so existing orgs/projects keep issue creation
 *  working without a data migration. `copilotEnabled` is no longer settable. */
function orgIssuesOn(meta: IntegrationMetadata | undefined | null): boolean {
  return !!(meta?.issuesEnabled ?? meta?.copilotEnabled);
}
function projectIssuesOn(project: Project | null): boolean {
  return !!(project?.issuesEnabled ?? project?.copilotEnabled);
}

/** Effective GitHub issue-creation availability: github connected + enabled + org
 *  master flag + per-project flag. Org-off overrides project-on. */
export async function isIssueCreationEnabled(db: Db, orgId: string, projectId: string): Promise<boolean> {
  const gh = await getIntegration(db, orgId, 'github');
  if (!gh || !gh.enabled) return false;
  if (!orgIssuesOn(gh.metadata as IntegrationMetadata)) return false;
  const project = await getProject(db, orgId, projectId);
  return projectIssuesOn(project);
}
