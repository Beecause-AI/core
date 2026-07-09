import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createOrgWithOwner, encryptSecret,
  upsertIntegration, findOrCreateSlackConversation,
  listConversationMessages,
  createProject, createAssistant, createConversation, enqueueTurn,
  createCopilotIssueOffer, getCopilotIssueOffer,
  createReportOffer, getReportOffer,
} from '@intellilabs/core';
import { makeSlackOnEvent, deliverSlackError } from '../src/engine/slack-delivery.js';
import { startTestDb, type TestDb } from './helpers.js';

const secretsKeyBuf = Buffer.alloc(32, 1);

let tdb: TestDb; let db: any;
let orgId: string; let conversationId: string; let projectId: string; let assistantId: string;

beforeAll(async () => {
  tdb = startTestDb();
  db = tdb.db;

  const org = await createOrgWithOwner(db, { name: 'Slack Org', slug: 'slack-org-sd', userId: 'u1' });
  orgId = org.id;

  const project = await createProject(db, orgId, { name: 'P', slug: 'p' });
  projectId = project.id;
  const assistant = await createAssistant(db, project.id, { name: 'A', model: 'fake-model' });
  assistantId = assistant.id;

  // Seed a Slack org integration with an encrypted bot token
  const ciphertext = encryptSecret('xoxb-test-token', secretsKeyBuf);
  await upsertIntegration(db, {
    orgId,
    provider: 'slack',
    mode: 'bot',
    secretCiphertext: ciphertext,
    metadata: { teamId: 'T1', teamName: 'Test Team', botUserId: 'U1' },
  });

  // Create a conversation row whose id we will use as the turn's laneId
  const conv = await findOrCreateSlackConversation(db, {
    orgId,
    projectId: project.id,
    assistantId: assistant.id,
    slackChannelId: 'C1',
    slackThreadTs: '1.1',
  });
  conversationId = conv.id;
});

afterAll(async () => { await tdb.stop(); });

describe('makeSlackOnEvent', () => {
  it('on done persists the authoritative answer + updates the placeholder', async () => {
    const updated: any[] = [];
    const fakeClient = {
      chatUpdate: async (_token: string, u: any) => { updated.push(u); return { ok: true as const }; },
    } as any;
    const onEvent = makeSlackOnEvent({ db, secretsKey: () => secretsKeyBuf, client: fakeClient });

    const turn = {
      id: crypto.randomUUID(),
      laneId: conversationId,
      orgId,
      source: 'slack' as const,
      payload: {
        model: 'm',
        messages: [],
        slack: { channel: 'C1', threadTs: '1.1', placeholderTs: 'ph.1' },
      },
    } as any;

    await onEvent(turn, { type: 'text', delta: 'Four' }); // streamed text is informational only now
    await onEvent(turn, { type: 'done', finishReason: 'stop', answer: 'Four.' });

    expect(updated).toEqual([{
      channel: 'C1',
      ts: 'ph.1',
      text: 'Four.',
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Four.' } }],
    }]);
    const msgs = await listConversationMessages(db, conversationId);
    expect(msgs.at(-1)).toMatchObject({ role: 'assistant', content: 'Four.' });
  });

  it('ignores non-slack turns', async () => {
    const called: any[] = [];
    const onEvent = makeSlackOnEvent({
      db,
      secretsKey: () => secretsKeyBuf,
      client: { chatUpdate: async () => { called.push(true); return { ok: true as const }; } } as any,
    });
    await onEvent({ id: 't2', source: 'web', payload: {} } as any, { type: 'done', finishReason: 'stop' });
    expect(called).toHaveLength(0);
  });

  it('emits (no response) when no text was streamed', async () => {
    const updated: any[] = [];
    const fakeClient = {
      chatUpdate: async (_token: string, u: any) => { updated.push(u); return { ok: true as const }; },
    } as any;
    const onEvent = makeSlackOnEvent({ db, secretsKey: () => secretsKeyBuf, client: fakeClient });

    const turn = {
      id: crypto.randomUUID(),
      laneId: conversationId,
      orgId,
      source: 'slack' as const,
      payload: {
        model: 'm',
        messages: [],
        slack: { channel: 'C1', threadTs: '1.1', placeholderTs: 'ph.2' },
      },
    } as any;

    await onEvent(turn, { type: 'done', finishReason: 'stop' });
    expect(updated[0]?.text).toBe('(no response)');
  });

  it('shows NO status edit on tool_call and ignores usage (placeholder stays "thinking…")', async () => {
    const updated: any[] = [];
    const fakeClient = {
      chatUpdate: async (_token: string, u: any) => { updated.push(u); return { ok: true as const }; },
    } as any;
    const onEvent = makeSlackOnEvent({ db, secretsKey: () => secretsKeyBuf, client: fakeClient });
    const turn = { id: 't-misc', source: 'slack', payload: { slack: { channel: 'C1', threadTs: '1', placeholderTs: 'ph' } }, orgId, laneId: conversationId } as any;
    await onEvent(turn, { type: 'tool_call', call: { id: 'c1', name: 'fn', arguments: {} } });
    await onEvent(turn, { type: 'usage', inputTokens: 1, outputTokens: 2 });
    expect(updated).toHaveLength(0); // no per-tool status churn
  });

  it('shows NO "Delegating to …" status when delegating to a sub-agent (agent.<id>)', async () => {
    const updated: any[] = [];
    const fakeClient = {
      chatUpdate: async (_token: string, u: any) => { updated.push(u); return { ok: true as const }; },
    } as any;
    const onEvent = makeSlackOnEvent({ db, secretsKey: () => secretsKeyBuf, client: fakeClient });
    const turn = { id: 't-deleg', source: 'slack', payload: { projectId, slack: { channel: 'C1', threadTs: '1', placeholderTs: 'ph' } }, orgId, laneId: conversationId } as any;
    await onEvent(turn, { type: 'tool_call', call: { id: 'c1', name: `agent.${assistantId}`, arguments: {} } });
    expect(updated).toHaveLength(0);
  });

  it('tool_call is a silent no-op: never calls chatUpdate, never rejects', async () => {
    let calls = 0;
    const fakeClient = {
      chatUpdate: async () => { calls++; throw new Error('slack down'); },
    } as any;
    const onEvent = makeSlackOnEvent({ db, secretsKey: () => secretsKeyBuf, client: fakeClient });
    const turn = { id: 't-err', source: 'slack', payload: { slack: { channel: 'C1', threadTs: '1', placeholderTs: 'ph' } }, orgId, laneId: conversationId } as any;
    await expect(onEvent(turn, { type: 'tool_call', call: { id: 'c', name: 'fn', arguments: {} } })).resolves.toBeUndefined();
    expect(calls).toBe(0); // chatUpdate not even attempted for a tool call
  });

  it('posts done.answer even when text was streamed before a tool_result (the front-door fix)', async () => {
    const updated: any[] = [];
    const fakeClient = {
      chatUpdate: async (_token: string, u: any) => { updated.push(u); return { ok: true as const }; },
    } as any;
    const onEvent = makeSlackOnEvent({ db, secretsKey: () => secretsKeyBuf, client: fakeClient });

    const turn = {
      id: crypto.randomUUID(),
      laneId: conversationId,
      orgId,
      source: 'slack' as const,
      payload: {
        model: 'm',
        messages: [],
        slack: { channel: 'C1', threadTs: '1.1', placeholderTs: 'ph.answer' },
      },
    } as any;

    // The conclusion was produced in the SAME round as a tool call (e.g. offer_github_issue),
    // then an empty follow-up round. Streamed text + tool_result no longer decide the reply —
    // done.answer (the loop's authoritative answer) does.
    await onEvent(turn, { type: 'text', delta: 'The answer is 5.' });
    await onEvent(turn, { type: 'tool_call', call: { id: 'c1', name: 'calc', arguments: {} } });
    await onEvent(turn, { type: 'tool_result', result: { toolCallId: 'c1', name: 'calc', content: '5' } } as any);
    await onEvent(turn, { type: 'done', finishReason: 'stop', answer: 'The answer is 5.' });

    const finalUpdate = updated.find((u) => u.ts === 'ph.answer');
    expect(finalUpdate?.text).toBe('The answer is 5.');
    expect(finalUpdate?.blocks).toEqual([{ type: 'section', text: { type: 'mrkdwn', text: 'The answer is 5.' } }]);

    const msgs = await listConversationMessages(db, conversationId);
    expect(msgs.at(-1)).toMatchObject({ role: 'assistant', content: 'The answer is 5.' });
  });

  it('(c) only the final done edit is sent — tool_call produces nothing', async () => {
    const updated: any[] = [];
    const fakeClient = {
      chatUpdate: async (_token: string, u: any) => { updated.push(u); return { ok: true as const }; },
    } as any;
    const onEvent = makeSlackOnEvent({ db, secretsKey: () => secretsKeyBuf, client: fakeClient });

    const turn = {
      id: crypto.randomUUID(),
      laneId: conversationId,
      orgId,
      source: 'slack' as const,
      payload: {
        model: 'm',
        messages: [],
        slack: { channel: 'C1', threadTs: '1.1', placeholderTs: 'ph.cache' },
      },
    } as any;

    await onEvent(turn, { type: 'tool_call', call: { id: 'c1', name: 'fn', arguments: {} } });
    await onEvent(turn, { type: 'done', finishReason: 'stop' });

    // Only the done final edit (with blocks); the tool_call is silent.
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      ts: 'ph.cache',
      text: '(no response)',
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '(no response)' } }],
    });
  });
  it('converts markdown to Block Kit on final delivery while persisting raw markdown to DB', async () => {
    const updated: any[] = [];
    const fakeClient = {
      chatUpdate: async (_token: string, u: any) => { updated.push(u); return { ok: true as const }; },
    } as any;
    const onEvent = makeSlackOnEvent({ db, secretsKey: () => secretsKeyBuf, client: fakeClient });

    const turn = {
      id: crypto.randomUUID(),
      laneId: conversationId,
      orgId,
      source: 'slack' as const,
      payload: {
        model: 'm',
        messages: [],
        slack: { channel: 'C1', threadTs: '1.1', placeholderTs: 'ph.md' },
      },
    } as any;

    await onEvent(turn, { type: 'done', finishReason: 'stop', answer: '**bold** answer' });

    // Block Kit blocks: ** becomes * (Slack mrkdwn bold)
    expect(updated).toHaveLength(1);
    expect(updated[0].blocks[0].text.text).toBe('*bold* answer');
    // Fallback text: ** stripped entirely
    expect(updated[0].text).toBe('bold answer');

    // Raw markdown persisted to DB
    const msgs = await listConversationMessages(db, conversationId);
    expect(msgs.at(-1)).toMatchObject({ role: 'assistant', content: '**bold** answer' });
  });

  it('posts a queued GitHub-issue offer AFTER the reply on done, and records its ts', async () => {
    const updates: any[] = []; const posts: any[] = [];
    const fakeClient = {
      chatUpdate: async (_t: string, u: any) => { updates.push(u); return { ok: true as const }; },
      chatPostMessage: async (_t: string, m: any) => { posts.push(m); return { ok: true as const, ts: 'offer.posted.1' }; },
    } as any;
    const onEvent = makeSlackOnEvent({ db, secretsKey: () => secretsKeyBuf, client: fakeClient });

    // A queued offer was recorded during the turn (no slackMessageTs yet).
    const offer = await createCopilotIssueOffer(db, {
      orgId, projectId, conversationId,
      slackChannelId: 'C1', slackThreadTs: '1.1',
      repo: 'acme/api', candidateRepos: [], title: 'T', body: 'B', summary: 'Raise a fix?', provider: 'github' as const,
    });

    const turn = {
      id: crypto.randomUUID(), laneId: conversationId, orgId, source: 'slack' as const,
      payload: { slack: { channel: 'C1', threadTs: '1.1', placeholderTs: 'ph.offer' } },
    } as any;

    await onEvent(turn, { type: 'done', finishReason: 'stop', answer: 'Root cause found.' });

    // The reply edited the placeholder, and the offer was posted as a NEW threaded message after it.
    expect(updates.some((u) => u.ts === 'ph.offer' && u.text === 'Root cause found.')).toBe(true);
    expect(posts).toHaveLength(1);
    expect(posts[0].channel).toBe('C1');
    expect(posts[0].threadTs).toBe('1.1');
    expect(posts[0].blocks.some((b: any) => b.type === 'actions')).toBe(true);

    // slackMessageTs recorded so the interactions handler can edit the prompt on click.
    const updated = await getCopilotIssueOffer(db, offer.id);
    expect(updated?.slackMessageTs).toBe('offer.posted.1');
  });

  it('posts a queued report offer AFTER the reply on done with correct action_ids, and records its ts', async () => {
    const updates: any[] = []; const posts: any[] = [];
    const fakeClient = {
      chatUpdate: async (_t: string, u: any) => { updates.push(u); return { ok: true as const }; },
      chatPostMessage: async (_t: string, m: any) => { posts.push(m); return { ok: true as const, ts: 'report.offer.posted.1' }; },
    } as any;
    const onEvent = makeSlackOnEvent({ db, secretsKey: () => secretsKeyBuf, client: fakeClient });

    // Seed a report offer that has not been posted yet (no slackMessageTs).
    const offer = await createReportOffer(db, {
      orgId, projectId, conversationId,
      slackChannelId: 'C1', slackThreadTs: '1.1',
    });

    const turn = {
      id: crypto.randomUUID(), laneId: conversationId, orgId, source: 'slack' as const,
      payload: { slack: { channel: 'C1', threadTs: '1.1', placeholderTs: 'ph.report-offer' } },
    } as any;

    await onEvent(turn, { type: 'done', finishReason: 'stop', answer: 'Analysis complete.' });

    // The reply edited the placeholder.
    expect(updates.some((u) => u.ts === 'ph.report-offer' && u.text === 'Analysis complete.')).toBe(true);

    // A NEW threaded message was posted for the report offer.
    const reportPost = posts.find((p: any) =>
      p.blocks?.some((b: any) => b.type === 'actions' &&
        b.elements?.some((e: any) => e.action_id === `report_offer:${offer.id}:generate`))
    );
    expect(reportPost).toBeDefined();
    expect(reportPost.channel).toBe('C1');
    expect(reportPost.threadTs).toBe('1.1');

    // decline button also present
    const actions = reportPost.blocks.find((b: any) => b.type === 'actions');
    expect(actions.elements.some((e: any) => e.action_id === `report_offer:${offer.id}:decline`)).toBe(true);

    // slackMessageTs persisted so the interactions handler can resolve this offer on click.
    const saved = await getReportOffer(db, offer.id);
    expect(saved?.slackMessageTs).toBe('report.offer.posted.1');
  });

  it('no report offer → nothing posted for reports', async () => {
    const posts: any[] = [];
    const fakeClient = {
      chatUpdate: async (_t: string, u: any) => ({ ok: true as const }),
      chatPostMessage: async (_t: string, m: any) => { posts.push(m); return { ok: true as const, ts: 'x' }; },
    } as any;
    const onEvent = makeSlackOnEvent({ db, secretsKey: () => secretsKeyBuf, client: fakeClient });

    // No report offer seeded for this distinct conversation id.
    const noOfferConvId = crypto.randomUUID();

    const turn = {
      id: crypto.randomUUID(), laneId: noOfferConvId, orgId, source: 'slack' as const,
      payload: { slack: { channel: 'C1', threadTs: '1.1', placeholderTs: 'ph.no-report' } },
    } as any;

    await onEvent(turn, { type: 'done', finishReason: 'stop', answer: 'Done.' });

    // No post for a missing report offer (the token lookup returns null for an unknown laneId,
    // so the early-return guard fires before any postMessage).
    const reportPosts = posts.filter((p: any) =>
      p.blocks?.some((b: any) => b.type === 'actions' &&
        b.elements?.some((e: any) => typeof e.action_id === 'string' && e.action_id.startsWith('report_offer:')))
    );
    expect(reportPosts).toHaveLength(0);
  });
});

describe('deliverSlackError', () => {
  const sink = () => {
    const updated: any[] = []; const posted: any[] = [];
    const client = {
      chatUpdate: async (_t: string, u: any) => { updated.push(u); return { ok: true as const }; },
      chatPostMessage: async (_t: string, m: any) => { posted.push(m); return { ok: true as const, ts: 'x' }; },
    } as any;
    return { updated, posted, deps: { db, secretsKey: () => secretsKeyBuf, client } };
  };

  it('permanent error → posts a simple error + "reach out to an admin" to the thread', async () => {
    const { posted, deps } = sink();
    const turn = { id: crypto.randomUUID(), laneId: conversationId, orgId, source: 'slack', status: 'failed',
      error: { class: 'permanent', name: 'ProviderError', message: 'gemini 400: {\n "error": {...}}' } } as any;
    await deliverSlackError(deps, turn);
    expect(posted).toHaveLength(1);
    expect(posted[0].channel).toBe('C1');
    expect(posted[0].threadTs).toBe('1.1');
    expect(posted[0].text).toContain('gemini 400'); // simple underlying error, JSON blob stripped
    expect(posted[0].text).not.toContain('{');
    expect(posted[0].text).toMatch(/admin/i);
  });

  it('retryable (temporary) error → asks the user to try again, no underlying error dump', async () => {
    const { posted, deps } = sink();
    const turn = { id: crypto.randomUUID(), laneId: conversationId, orgId, source: 'slack', status: 'failed',
      error: { class: 'temporary', name: 'ProviderError', message: 'anthropic 429' } } as any;
    await deliverSlackError(deps, turn);
    expect(posted[0].text).toMatch(/try again/i);
    expect(posted[0].text).not.toMatch(/admin/i);
  });

  it('a failed INTERNAL child turn is reported to the ROOT slack thread', async () => {
    const child = await createConversation(db, { orgId, projectId, assistantId: null, source: 'internal', rootConversationId: conversationId });
    const { posted, deps } = sink();
    const turn = { id: crypto.randomUUID(), laneId: child.id, orgId, source: 'internal', status: 'failed',
      error: { class: 'permanent', message: 'boom' } } as any;
    await deliverSlackError(deps, turn);
    expect(posted).toHaveLength(1);
    expect(posted[0].channel).toBe('C1'); // resolved to the root slack thread
    expect(posted[0].threadTs).toBe('1.1');
  });

  it('edits the in-flight placeholder when the root has one (no dangling status)', async () => {
    // Give the slack conversation a slack turn carrying a placeholder ts.
    await enqueueTurn(db, { laneId: conversationId, orgId, source: 'slack',
      payload: { slack: { channel: 'C1', threadTs: '1.1', placeholderTs: 'ph.live' } } });
    const { updated, posted, deps } = sink();
    const turn = { id: crypto.randomUUID(), laneId: conversationId, orgId, source: 'slack', status: 'failed',
      error: { class: 'permanent', message: 'kaboom' } } as any;
    await deliverSlackError(deps, turn);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ channel: 'C1', ts: 'ph.live' });
    expect(posted).toHaveLength(0);
  });

  it('does nothing for a cancelled turn', async () => {
    const { updated, posted, deps } = sink();
    await deliverSlackError(deps, { id: 'x', laneId: conversationId, orgId, source: 'slack', status: 'cancelled', error: { class: 'permanent', message: 'c' } } as any);
    expect(updated).toHaveLength(0); expect(posted).toHaveLength(0);
  });

  it('does nothing for a turn not rooted in slack', async () => {
    const { updated, posted, deps } = sink();
    await deliverSlackError(deps, { id: 'y', laneId: crypto.randomUUID(), orgId, source: 'internal', status: 'failed', error: {} } as any);
    expect(updated).toHaveLength(0); expect(posted).toHaveLength(0);
  });
});
