import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import {
  upsertPendingBinding, getBinding, setBinding, listBindings, deleteBinding,
  listBindingsForProject, listAvailableBindings, listSlackBindingsByProject,
} from '../../src/repos/slack-channel-bindings.js';

const store = testStore('slack-channel-bindings');
const db = store.db;
const orgIntegrationId = 'intg-1';
const projectId = 'proj-1';

beforeEach(() => wipe(db));
afterAll(() => store.close());

describe('slack channel bindings (Firestore)', () => {
  it('pending → bound lifecycle', async () => {
    const p = await upsertPendingBinding(db, { orgIntegrationId, slackChannelId: 'C9', channelName: 'general' });
    expect(p.status).toBe('pending');
    expect(p.channelName).toBe('general');
    expect((await upsertPendingBinding(db, { orgIntegrationId, slackChannelId: 'C9' })).id).toBe(p.id); // idempotent

    const b = await setBinding(db, { orgIntegrationId, slackChannelId: 'C9', projectId, createdByUserId: 'u1' });
    expect(b.status).toBe('bound');
    expect(b.projectId).toBe(projectId);

    const got = await getBinding(db, orgIntegrationId, 'C9');
    expect(got?.projectId).toBe(projectId);
    expect((await listBindings(db, orgIntegrationId)).length).toBe(1);
    expect(await deleteBinding(db, orgIntegrationId, 'C9')).toBe(true);
    expect(await getBinding(db, orgIntegrationId, 'C9')).toBeNull();
    expect(await deleteBinding(db, orgIntegrationId, 'C9')).toBe(false);
  });

  it('lists project-scoped vs available (unassigned) bindings', async () => {
    await setBinding(db, { orgIntegrationId, slackChannelId: 'C_ASSIGNED', projectId, createdByUserId: 'u1' });
    await upsertPendingBinding(db, { orgIntegrationId, slackChannelId: 'C_FREE' });

    const mine = await listBindingsForProject(db, orgIntegrationId, projectId);
    expect(mine.map((b) => b.slackChannelId)).toEqual(['C_ASSIGNED']);

    const byProject = await listSlackBindingsByProject(db, projectId);
    expect(byProject.map((b) => b.slackChannelId)).toEqual(['C_ASSIGNED']);

    const avail = await listAvailableBindings(db, orgIntegrationId);
    expect(avail.map((b) => b.slackChannelId)).toContain('C_FREE');
    expect(avail.some((b) => b.slackChannelId === 'C_ASSIGNED')).toBe(false);
  });
});
