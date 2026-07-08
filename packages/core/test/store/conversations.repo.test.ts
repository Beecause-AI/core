import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from './emulator.js';
import { col } from '../../src/store/collections.js';
import { toDoc, applyDefaults } from '../../src/store/codec.js';
import {
  findOrCreateSlackConversation,
  getSlackConversation,
  getConversation,
  createConversation,
  appendConversationMessage,
  listConversationMessages,
  listConversationsForProject,
  incidentRollup,
  setConversationSummary,
  getConversationTree,
} from '../../src/repos/conversations.js';

const store = testStore('conversations');
const db = store.db;

beforeEach(() => wipe(db));
afterAll(() => store.close());

const newConvo = (over: Partial<Parameters<typeof createConversation>[1]> = {}) =>
  createConversation(db, { orgId: 'o1', projectId: 'p1', assistantId: null, ...over });

async function seedInvocation(conversationId: string, costUsd: number) {
  const ref = col(db, 'model_invocations').doc();
  await ref.set(
    toDoc(applyDefaults({ conversationId, source: 'web', model: 'm', status: 'ok', costUsd: costUsd as number }, ref.id)),
  );
}

describe('conversations repo (Firestore)', () => {
  it('createConversation / getConversation round-trips', async () => {
    const c = await newConvo({ source: 'web' });
    expect(c.id).toBeTruthy();
    expect(c.source).toBe('web');
    expect(c.summary).toBe('');
    expect(c.rootConversationId).toBeNull();
    const got = await getConversation(db, c.id);
    expect(got?.id).toBe(c.id);
    expect(await getConversation(db, 'missing')).toBeNull();
  });

  it('getConversationTree returns a NULL root for a missing id (no ghost object)', async () => {
    const tree = await getConversationTree(db, 'does-not-exist');
    expect(tree.root).toBeNull();
    expect(tree.children).toEqual([]);
  });

  it('getConversationTree returns the root + its sub-agent children', async () => {
    const root = await newConvo({ source: 'slack' });
    const child = await newConvo({ source: 'internal', rootConversationId: root.id });
    const tree = await getConversationTree(db, root.id);
    expect(tree.root?.id).toBe(root.id);
    expect(tree.children.map((c) => c.id)).toContain(child.id);
  });

  it('listConversationsForProject returns newest-first', async () => {
    const a = await newConvo();
    await new Promise((r) => setTimeout(r, 10));
    const b = await newConvo();
    await newConvo({ projectId: 'other' });
    const rows = await listConversationsForProject(db, 'p1');
    expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it('appendConversationMessage assigns gap-free seq, order preserved', async () => {
    const c = await newConvo();
    const m1 = await appendConversationMessage(db, { conversationId: c.id, role: 'user', content: 'one' });
    const m2 = await appendConversationMessage(db, { conversationId: c.id, role: 'assistant', content: 'two' });
    expect(m1.seq).toBe(1);
    expect(m2.seq).toBe(2);
    const msgs = await listConversationMessages(db, c.id);
    expect(msgs.map((m) => m.content)).toEqual(['one', 'two']);
    expect(msgs.map((m) => m.seq)).toEqual([1, 2]);
  });

  it('appendConversationMessage is gap-free under concurrent appends', async () => {
    const c = await newConvo();
    const N = 15;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        appendConversationMessage(db, { conversationId: c.id, role: 'user', content: `m${i}` }),
      ),
    );
    const seqs = (await listConversationMessages(db, c.id)).map((m) => m.seq).sort((x, y) => x - y);
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i + 1)); // 1..N no gaps/dupes
  });

  it('findOrCreateSlackConversation is idempotent on (channel, thread)', async () => {
    const input = { orgId: 'o1', projectId: 'p1', assistantId: null, slackChannelId: 'C1', slackThreadTs: '123.45' };
    const a = await findOrCreateSlackConversation(db, input);
    const b = await findOrCreateSlackConversation(db, input);
    expect(a.id).toBe(b.id);
    expect(a.source).toBe('slack');
    const found = await getSlackConversation(db, 'C1', '123.45');
    expect(found?.id).toBe(a.id);
    expect(await getSlackConversation(db, 'C1', 'nope')).toBeNull();
  });

  it('incidentRollup sums cost + counts across root and children', async () => {
    const root = await newConvo();
    const child = await newConvo({ rootConversationId: root.id });
    const unrelated = await newConvo();
    await seedInvocation(root.id, 0.1);
    await seedInvocation(child.id, 0.2);
    await seedInvocation(unrelated.id, 5); // excluded
    const roll = await incidentRollup(db, root.id);
    expect(Number(roll.costUsd)).toBeCloseTo(0.3, 6);
    expect(roll.callCount).toBe(2);

    expect(await incidentRollup(db, 'no-such')).toEqual({ costUsd: '0', callCount: 0, rateLimitedCount: 0 });
  });

  it('setConversationSummary persists the summary field', async () => {
    const a = await newConvo();
    await setConversationSummary(db, a.id, 'summary text');
    const got = await getConversation(db, a.id);
    expect(got?.summary).toBe('summary text');
  });

  it('incidentRollup accumulates cost+count correctly across ≥2 chunk(30) batches', async () => {
    // 1 root + 30 children = 31 conversation ids → chunk(ids, 30) produces 2 batches.
    // Each conversation gets one model-invocation costing $0.01, so totals are known.
    const COST_PER = 0.01;
    const root = await newConvo();
    const children = await Promise.all(
      Array.from({ length: 30 }, () => newConvo({ rootConversationId: root.id })),
    );
    // Seed one invocation per conversation (root + all 30 children).
    await Promise.all([root, ...children].map((c) => seedInvocation(c.id, COST_PER)));

    const roll = await incidentRollup(db, root.id);

    const EXPECTED_COUNT = 31; // 1 root + 30 children
    expect(roll.callCount).toBe(EXPECTED_COUNT);
    expect(Number(roll.costUsd)).toBeCloseTo(COST_PER * EXPECTED_COUNT, 6);
  });
});
