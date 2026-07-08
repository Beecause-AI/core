import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrgWithOwner,
  findOrCreateTeamsConversation,
  listConversationMessages,
  createProject, createAssistant, createConversation, enqueueTurn,
} from '@intellilabs/core';
import { makeTeamsOnEvent, deliverTeamsError } from '../src/engine/teams-delivery.js';
import { startTestDb, type TestDb } from './helpers.js';

const fakeAuth = { appId: 'app-1', appPassword: 'secret', tenantId: 'tenant-1' };

let tdb: TestDb; let db: any;
let orgId: string; let conversationId: string; let projectId: string; let assistantId: string;

beforeAll(async () => {
  tdb = startTestDb();
  db = tdb.db;

  const org = await createOrgWithOwner(db, { name: 'Teams Org', slug: 'teams-org-td', userId: 'u1' });
  orgId = org.id;

  const project = await createProject(db, orgId, { name: 'P', slug: 'p' });
  projectId = project.id;
  const assistant = await createAssistant(db, project.id, { name: 'A', model: 'fake-model' });
  assistantId = assistant.id;

  // Create a conversation row whose id we will use as the turn's laneId
  const conv = await findOrCreateTeamsConversation(db, {
    orgId,
    projectId: project.id,
    assistantId: assistant.id,
    teamsTenantId: 'tenant-1',
    teamsConversationId: 'conv-1',
  });
  conversationId = conv.id;
});

afterAll(async () => { await tdb.stop(); });

describe('makeTeamsOnEvent', () => {
  it('on done edits the placeholder with the answer and persists the assistant message', async () => {
    const updated: any[] = [];
    const fakeClient = {
      updateActivity: async (_auth: any, u: any) => { updated.push(u); return { id: 'act-1' }; },
      sendActivity: async () => { return { id: 'act-new' }; },
    } as any;
    const onEvent = makeTeamsOnEvent({ db, client: fakeClient, auth: fakeAuth });

    const turn = {
      id: crypto.randomUUID(),
      laneId: conversationId,
      orgId,
      source: 'teams' as const,
      payload: {
        model: 'm',
        messages: [],
        teams: {
          serviceUrl: 'https://smba.trafficmanager.net/amer/',
          conversationId: 'conv-1',
          placeholderActivityId: 'act-placeholder',
          tenantId: 'tenant-1',
        },
      },
    } as any;

    await onEvent(turn, { type: 'text', delta: 'Four' }); // intermediate — should be ignored
    await onEvent(turn, { type: 'done', finishReason: 'stop', answer: 'Four.' });

    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      serviceUrl: 'https://smba.trafficmanager.net/amer/',
      conversationId: 'conv-1',
      activityId: 'act-placeholder',
    });
    // teamsReplyText wraps the text — just check it includes the answer
    expect(updated[0].text).toContain('Four.');

    const msgs = await listConversationMessages(db, conversationId);
    expect(msgs.at(-1)).toMatchObject({ role: 'assistant', content: 'Four.' });
  });

  it('ignores non-done events (placeholder stays "thinking…")', async () => {
    const updated: any[] = [];
    const fakeClient = {
      updateActivity: async (_auth: any, u: any) => { updated.push(u); return { id: 'act-1' }; },
      sendActivity: async () => { return { id: 'act-new' }; },
    } as any;
    const onEvent = makeTeamsOnEvent({ db, client: fakeClient, auth: fakeAuth });
    const turn = {
      id: 't-nondone',
      source: 'teams',
      laneId: conversationId,
      orgId,
      payload: {
        teams: {
          serviceUrl: 'https://smba.trafficmanager.net/amer/',
          conversationId: 'conv-1',
          placeholderActivityId: 'ph',
          tenantId: 'tenant-1',
        },
      },
    } as any;
    await onEvent(turn, { type: 'tool_call', call: { id: 'c1', name: 'fn', arguments: {} } });
    await onEvent(turn, { type: 'usage', inputTokens: 1, outputTokens: 2 });
    expect(updated).toHaveLength(0);
  });

  it('ignores non-teams turns', async () => {
    const updated: any[] = [];
    const fakeClient = {
      updateActivity: async (_auth: any, u: any) => { updated.push(u); return { id: 'act-1' }; },
      sendActivity: async () => { return { id: 'act-new' }; },
    } as any;
    const onEvent = makeTeamsOnEvent({ db, client: fakeClient, auth: fakeAuth });
    await onEvent({ id: 't2', source: 'web', payload: {} } as any, { type: 'done', finishReason: 'stop' });
    await onEvent({ id: 't3', source: 'slack', payload: {} } as any, { type: 'done', finishReason: 'stop', answer: 'hi' });
    expect(updated).toHaveLength(0);
  });

  it('emits (no response) when done has no answer', async () => {
    const updated: any[] = [];
    const fakeClient = {
      updateActivity: async (_auth: any, u: any) => { updated.push(u); return { id: 'act-1' }; },
      sendActivity: async () => { return { id: 'act-new' }; },
    } as any;
    const onEvent = makeTeamsOnEvent({ db, client: fakeClient, auth: fakeAuth });

    const turn = {
      id: crypto.randomUUID(),
      laneId: conversationId,
      orgId,
      source: 'teams' as const,
      payload: {
        teams: {
          serviceUrl: 'https://smba.trafficmanager.net/amer/',
          conversationId: 'conv-1',
          placeholderActivityId: 'ph-empty',
          tenantId: 'tenant-1',
        },
      },
    } as any;

    await onEvent(turn, { type: 'done', finishReason: 'stop' });
    expect(updated).toHaveLength(1);
    expect(updated[0].text).toContain('(no response)');
  });
});

describe('deliverTeamsError', () => {
  const sink = (overrides?: Partial<{ updated: any[]; sent: any[] }>) => {
    const updated: any[] = [];
    const sent: any[] = [];
    const client = {
      updateActivity: async (_auth: any, u: any) => { updated.push(u); return { id: 'act-1' }; },
      sendActivity: async (_auth: any, m: any) => { sent.push(m); return { id: 'act-new' }; },
    } as any;
    return { updated, sent, deps: { db, client, auth: fakeAuth } };
  };

  it('permanent error → sends an error message to the conversation', async () => {
    // Seed a teams turn with serviceUrl so getTeamsRootTarget can find it
    await enqueueTurn(db, {
      laneId: conversationId, orgId, source: 'teams',
      payload: {
        teams: {
          serviceUrl: 'https://smba.trafficmanager.net/amer/',
          conversationId: 'conv-1',
          tenantId: 'tenant-1',
        },
      },
    });
    const { sent, deps } = sink();
    const turn = {
      id: crypto.randomUUID(), laneId: conversationId, orgId, source: 'teams', status: 'failed',
      error: { class: 'permanent', name: 'ProviderError', message: 'gemini 400: {\n "error": {...}}' },
    } as any;
    await deliverTeamsError(deps, turn);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('gemini 400');
    expect(sent[0].text).not.toContain('{');
    expect(sent[0].text).toMatch(/admin/i);
  });

  it('retryable (temporary) error → asks user to try again', async () => {
    const { sent, deps } = sink();
    const turn = {
      id: crypto.randomUUID(), laneId: conversationId, orgId, source: 'teams', status: 'failed',
      error: { class: 'temporary', name: 'ProviderError', message: 'anthropic 429' },
    } as any;
    await deliverTeamsError(deps, turn);
    // sent may have length 1 (if the prior test seeded serviceUrl)
    const last = sent.at(-1) ?? sent[0];
    expect(sent.length).toBeGreaterThan(0);
    expect(last.text).toMatch(/try again/i);
    expect(last.text).not.toMatch(/admin/i);
  });

  it('edits the in-flight placeholder when the root has one (no dangling status)', async () => {
    await enqueueTurn(db, {
      laneId: conversationId, orgId, source: 'teams',
      payload: {
        teams: {
          serviceUrl: 'https://smba.trafficmanager.net/amer/',
          conversationId: 'conv-1',
          placeholderActivityId: 'ph-live',
          tenantId: 'tenant-1',
        },
      },
    });
    const { updated, sent, deps } = sink();
    const turn = {
      id: crypto.randomUUID(), laneId: conversationId, orgId, source: 'teams', status: 'failed',
      error: { class: 'permanent', message: 'kaboom' },
    } as any;
    await deliverTeamsError(deps, turn);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ activityId: 'ph-live' });
    expect(sent).toHaveLength(0);
  });

  it('does nothing for a cancelled turn', async () => {
    const { updated, sent, deps } = sink();
    await deliverTeamsError(deps, {
      id: 'x', laneId: conversationId, orgId, source: 'teams', status: 'cancelled',
      error: { class: 'permanent', message: 'c' },
    } as any);
    expect(updated).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('does nothing for a turn not rooted in teams', async () => {
    const { updated, sent, deps } = sink();
    await deliverTeamsError(deps, {
      id: 'y', laneId: crypto.randomUUID(), orgId, source: 'internal', status: 'failed', error: {},
    } as any);
    expect(updated).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('a failed INTERNAL child turn is reported to the ROOT teams conversation', async () => {
    const child = await createConversation(db, {
      orgId, projectId, assistantId: null, source: 'internal', rootConversationId: conversationId,
    });
    const { sent, updated, deps } = sink();
    const turn = {
      id: crypto.randomUUID(), laneId: child.id, orgId, source: 'internal', status: 'failed',
      error: { class: 'permanent', message: 'boom' },
    } as any;
    await deliverTeamsError(deps, turn);
    // The root has a placeholder now (from previous test), so updated is used
    expect(updated.length + sent.length).toBeGreaterThan(0);
    // Verify it targeted the right teams conversation
    const allCalls = [...updated, ...sent];
    expect(allCalls[0]).toMatchObject({ conversationId: 'conv-1' });
  });
});
