import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from '../store/emulator.js';
import { upsertIntegration, setIntegrationIssuesEnabled } from '../../src/repos/org-integrations.js';
import { createProject, setProjectIssuesEnabled } from '../../src/repos/projects.js';
import { isIssueCreationEnabled } from '../../src/copilot/gate.js';
import { col } from '../../src/store/collections.js';
import { toDoc } from '../../src/store/codec.js';

const store = testStore('copilot-gate');
const db = store.db;
const orgId = 'org-1';

beforeEach(() => wipe(db));
afterAll(() => store.close());

/** Seed github + a project, flipping the issue flags at each layer. `orgCopilot`/`projCopilot`
 *  seed the LEGACY copilotEnabled flag DIRECTLY (no setter exists anymore — Copilot hand-off was
 *  removed) so we can still exercise the back-compat shim where a missing issuesEnabled falls back
 *  to it. */
async function seed(opts: {
  orgIssues?: boolean; projIssues?: boolean;
  orgCopilot?: boolean; projCopilot?: boolean;
}) {
  await upsertIntegration(db, {
    orgId, provider: 'github', mode: 'pat', accountLabel: 'acme',
    secretCiphertext: 'ct', secretHint: '…abcd', baseUrl: null,
    metadata: opts.orgCopilot ? { copilotEnabled: true } : {}, connectedByUserId: 'u1',
  });
  if (opts.orgIssues) await setIntegrationIssuesEnabled(db, orgId, 'github', true);
  const project = await createProject(db, orgId, { name: 'P', slug: 'p', description: '' });
  if (opts.projIssues) await setProjectIssuesEnabled(db, orgId, project.id, true);
  if (opts.projCopilot) await col(db, 'projects').doc(project.id).update(toDoc({ copilotEnabled: true }));
  return project;
}

describe('isIssueCreationEnabled', () => {
  it('true only when org master AND project flag are both on', async () => {
    const p = await seed({ orgIssues: true, projIssues: true });
    expect(await isIssueCreationEnabled(db, orgId, p.id)).toBe(true);
  });
  it('false when org master off', async () => {
    const p = await seed({ orgIssues: false, projIssues: true });
    expect(await isIssueCreationEnabled(db, orgId, p.id)).toBe(false);
  });
  it('false when project flag off', async () => {
    const p = await seed({ orgIssues: true, projIssues: false });
    expect(await isIssueCreationEnabled(db, orgId, p.id)).toBe(false);
  });
  it('false when github not connected', async () => {
    const project = await createProject(db, orgId, { name: 'P', slug: 'p', description: '' });
    await setProjectIssuesEnabled(db, orgId, project.id, true);
    expect(await isIssueCreationEnabled(db, orgId, project.id)).toBe(false);
  });
  it('back-compat: legacy copilot-on (no issues flag) counts as issues-on', async () => {
    // No issuesEnabled set anywhere — only the old copilot flags, as pre-split data had.
    const p = await seed({ orgCopilot: true, projCopilot: true });
    expect(await isIssueCreationEnabled(db, orgId, p.id)).toBe(true);
  });
});
