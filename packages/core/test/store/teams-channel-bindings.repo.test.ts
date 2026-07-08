import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import {
  upsertPendingTeamsBinding, getBinding, setTeamsBinding, listTeamsBindings, deleteTeamsBinding,
  listTeamsBindingsForProject, listAvailableTeamsBindings, listTeamsBindingsByProject,
} from '../../src/repos/teams-channel-bindings.js';

const store = testStore('teams-channel-bindings');
const db = store.db;
const orgIntegrationId = 'intg-1';
const projectId = 'proj-1';

beforeEach(() => wipe(db));
afterAll(() => store.close());

describe('teams channel bindings (Firestore)', () => {
  it('pending → bound lifecycle', async () => {
    const p = await upsertPendingTeamsBinding(db, { orgIntegrationId, teamsConversationId: '19:abc', channelName: 'incidents' });
    expect(p.status).toBe('pending');
    expect(p.channelName).toBe('incidents');
    expect((await upsertPendingTeamsBinding(db, { orgIntegrationId, teamsConversationId: '19:abc' })).id).toBe(p.id);

    const b = await setTeamsBinding(db, { orgIntegrationId, teamsConversationId: '19:abc', projectId, createdByUserId: 'u1' });
    expect(b.status).toBe('bound');
    expect(b.projectId).toBe(projectId);

    expect((await getBinding(db, orgIntegrationId, '19:abc'))?.projectId).toBe(projectId);
    expect((await listTeamsBindings(db, orgIntegrationId)).length).toBe(1);
    expect(await deleteTeamsBinding(db, orgIntegrationId, '19:abc')).toBe(true);
    expect(await getBinding(db, orgIntegrationId, '19:abc')).toBeNull();
  });

  it('lists project-scoped vs available (unassigned) bindings', async () => {
    await setTeamsBinding(db, { orgIntegrationId, teamsConversationId: '19:assigned', projectId, createdByUserId: 'u1' });
    await upsertPendingTeamsBinding(db, { orgIntegrationId, teamsConversationId: '19:free' });

    expect((await listTeamsBindingsForProject(db, orgIntegrationId, projectId)).map((b) => b.teamsConversationId)).toEqual(['19:assigned']);
    expect((await listTeamsBindingsByProject(db, projectId)).map((b) => b.teamsConversationId)).toEqual(['19:assigned']);
    expect((await listAvailableTeamsBindings(db, orgIntegrationId)).map((b) => b.teamsConversationId)).toEqual(['19:free']);
  });
});
