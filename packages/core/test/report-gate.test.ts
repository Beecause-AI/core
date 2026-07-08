import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { testStore } from './store/emulator.js';
import { createOrgWithOwner, setOrgReportsEnabled } from '../src/repos/orgs.js';
import { createProject, setProjectReportsEnabled } from '../src/repos/projects.js';
import { isReportGenerationEnabled } from '../src/reports/gate.js';

const t = testStore('report-gate');
afterAll(() => t.close());

async function setup(orgOn: boolean, projOn: boolean) {
  const org = await createOrgWithOwner(t.db, { name: 'O', slug: `rg-${randomUUID().slice(0,8)}`, userId: randomUUID() });
  const project = await createProject(t.db, org.id, { name: 'P', slug: `p-${randomUUID().slice(0,8)}` });
  if (orgOn) await setOrgReportsEnabled(t.db, org.id, true);
  if (projOn) await setProjectReportsEnabled(t.db, org.id, project.id, true);
  return { orgId: org.id, projectId: project.id };
}

describe('isReportGenerationEnabled', () => {
  it('true only when both org and project are on', async () => {
    const a = await setup(true, true);   expect(await isReportGenerationEnabled(t.db, a.orgId, a.projectId)).toBe(true);
    const b = await setup(true, false);  expect(await isReportGenerationEnabled(t.db, b.orgId, b.projectId)).toBe(false);
    const c = await setup(false, true);  expect(await isReportGenerationEnabled(t.db, c.orgId, c.projectId)).toBe(false);
    const d = await setup(false, false); expect(await isReportGenerationEnabled(t.db, d.orgId, d.projectId)).toBe(false);
  });
  it('defaults to false on a fresh org/project', async () => {
    const e = await setup(false, false); expect(await isReportGenerationEnabled(t.db, e.orgId, e.projectId)).toBe(false);
  });
});
