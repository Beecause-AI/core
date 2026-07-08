import type { Db } from '../store/firestore.js';
import { getOrgById } from '../repos/orgs.js';
import { getProject } from '../repos/projects.js';

/** Premium gate: report generation requires BOTH the org flag and the project flag (org wins). */
export async function isReportGenerationEnabled(db: Db, orgId: string, projectId: string): Promise<boolean> {
  const org = await getOrgById(db, orgId);
  if (!org?.reportsEnabled) return false;
  const project = await getProject(db, orgId, projectId);
  return !!project?.reportsEnabled;
}
