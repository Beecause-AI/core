import { getIntegration, type IntegrationMetadata } from '../repos/org-integrations.js';
import { getProject } from '../repos/projects.js';
import type { Db } from '../store/firestore.js';
import type { Project } from '../store/types.js';

function projectIssuesOn(project: Project | null): boolean {
  return !!(project?.issuesEnabled ?? project?.copilotEnabled);
}

/** Effective GitLab issue-creation availability: gitlab connected + enabled + org
 *  master flag (metadata.issuesEnabled) + per-project flag. Org-off overrides project-on. */
export async function isGitlabIssueCreationEnabled(db: Db, orgId: string, projectId: string): Promise<boolean> {
  const gl = await getIntegration(db, orgId, 'gitlab');
  if (!gl || !gl.enabled) return false;
  if (!(gl.metadata as IntegrationMetadata)?.issuesEnabled) return false;
  const project = await getProject(db, orgId, projectId);
  return projectIssuesOn(project);
}
