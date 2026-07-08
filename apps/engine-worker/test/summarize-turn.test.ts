/**
 * Tests for the summarize-turn helper.
 *
 * Uses the Firestore emulator via the shared startTestDb() harness.
 *
 * Covered cases:
 *   1. hindsightEnabled=true + non-internal convo with messages → summary written + operation/invocation recorded
 *   2. hindsightEnabled=false (flag off) → no-op; summary stays empty
 *   3. internal conversation (source='internal') → no-op
 *   4. no messages → no-op
 *   5. operation is 'done' with token counts after success
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrgWithOwner,
  createProject,
  createConversation,
  appendConversationMessage,
  getConversation,
  setOrgHindsightEnabled,
  InMemoryVectorIndex,
} from '@intellilabs/core';
import type { QueuedTurn } from '@intellilabs/core';
import { summarizeTurn } from '../src/engine/summarize-turn.js';
import { startTestDb, type TestDb } from './helpers.js';

let tdb: TestDb;
let db: any;
let orgId: string;
let projectId: string;

/** Query the operations collection by parentConversationId (Firestore-native; there is
 *  no list-by-conversation repo fn). Returns plain doc data objects. */
async function operationsForConversation(conversationId: string): Promise<any[]> {
  const snap = await db.collection('operations')
    .where('parentConversationId', '==', conversationId)
    .get();
  return snap.map((d: any) => d.data());
}

beforeAll(async () => {
  tdb = startTestDb();
  db = tdb.db;
  const org = await createOrgWithOwner(db, { name: 'TestOrg', slug: 'test-org-s', userId: 'u1' });
  orgId = org.id;
  const project = await createProject(db, orgId, { name: 'TestProject', slug: 'test-proj-s' });
  projectId = project.id;
});
afterAll(async () => { await tdb.stop(); });

/** Fake LLM that returns a fixed summary. */
function fakeLlm(text = 'Rolling summary text.') {
  return async (_prompt: string) => ({ text, inputTokens: 10, outputTokens: 5 });
}

function makeTurn(laneId: string): QueuedTurn {
  return { id: crypto.randomUUID(), laneId, orgId, source: 'slack', payload: {}, status: 'done' } as unknown as QueuedTurn;
}

describe('summarizeTurn', () => {
  it('writes the summary when hindsightEnabled=true and convo has messages', async () => {
    await setOrgHindsightEnabled(db, orgId, true);

    const convo = await createConversation(db, { orgId, projectId, assistantId: null, source: 'slack' });
    await appendConversationMessage(db, { conversationId: convo.id, role: 'user', content: 'What is the CPU spike?' });
    await appendConversationMessage(db, { conversationId: convo.id, role: 'assistant', content: 'The CPU spike is from process X.' });

    const llm = fakeLlm('The CPU spike is from process X. Under investigation.');
    await summarizeTurn({ db, llm }, makeTurn(convo.id));

    const updated = await getConversation(db, convo.id);
    expect(updated?.summary).toBe('The CPU spike is from process X. Under investigation.');
  });

  it('records a finished operation with token counts after a successful summary', async () => {
    await setOrgHindsightEnabled(db, orgId, true);

    const convo = await createConversation(db, { orgId, projectId, assistantId: null, source: 'slack' });
    await appendConversationMessage(db, { conversationId: convo.id, role: 'user', content: 'Latency issue?' });
    await appendConversationMessage(db, { conversationId: convo.id, role: 'assistant', content: 'Yes, latency from DB.' });

    await summarizeTurn({ db, llm: fakeLlm('Latency from DB.') }, makeTurn(convo.id));

    const ops = await operationsForConversation(convo.id);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('conversation-summary');
    expect(ops[0].status).toBe('done');
    expect(Number(ops[0].inputTokens)).toBe(10);
    expect(Number(ops[0].outputTokens)).toBe(5);
  });

  it('does nothing when hindsightEnabled=false (org flag off)', async () => {
    await setOrgHindsightEnabled(db, orgId, false);

    const convo = await createConversation(db, { orgId, projectId, assistantId: null, source: 'slack' });
    await appendConversationMessage(db, { conversationId: convo.id, role: 'user', content: 'Hello?' });

    let called = false;
    const llm = async (_prompt: string) => { called = true; return { text: 'x', inputTokens: 1, outputTokens: 1 }; };
    await summarizeTurn({ db, llm }, makeTurn(convo.id));

    expect(called).toBe(false);
    const updated = await getConversation(db, convo.id);
    expect(updated?.summary ?? '').toBe('');

    await setOrgHindsightEnabled(db, orgId, true);
  });

  it('does nothing for an internal conversation', async () => {
    await setOrgHindsightEnabled(db, orgId, true);

    const convo = await createConversation(db, { orgId, projectId, assistantId: null, source: 'internal' });
    await appendConversationMessage(db, { conversationId: convo.id, role: 'user', content: 'Sub-agent call' });

    let called = false;
    const llm = async (_prompt: string) => { called = true; return { text: 'x', inputTokens: 1, outputTokens: 1 }; };
    await summarizeTurn({ db, llm }, makeTurn(convo.id));

    expect(called).toBe(false);
    const updated = await getConversation(db, convo.id);
    expect(updated?.summary ?? '').toBe('');
  });

  it('does nothing when the conversation has no messages', async () => {
    await setOrgHindsightEnabled(db, orgId, true);

    const convo = await createConversation(db, { orgId, projectId, assistantId: null, source: 'slack' });
    // No messages appended

    let called = false;
    const llm = async (_prompt: string) => { called = true; return { text: 'x', inputTokens: 1, outputTokens: 1 }; };
    await summarizeTurn({ db, llm }, makeTurn(convo.id));

    expect(called).toBe(false);
  });

  it('marks the operation failed and rethrows when the llm throws (best-effort isolation is the caller\'s job)', async () => {
    await setOrgHindsightEnabled(db, orgId, true);

    const convo = await createConversation(db, { orgId, projectId, assistantId: null, source: 'slack' });
    await appendConversationMessage(db, { conversationId: convo.id, role: 'user', content: 'boom?' });

    const llm = async (_prompt: string): Promise<{ text: string; inputTokens: number; outputTokens: number }> => { throw new Error('llm down'); };
    await expect(summarizeTurn({ db, llm }, makeTurn(convo.id))).rejects.toThrow('llm down');

    const ops = await operationsForConversation(convo.id);
    expect(ops).toHaveLength(1);
    expect(ops[0].status).toBe('failed');
    const updated = await getConversation(db, convo.id);
    expect(updated?.summary ?? '').toBe(''); // no partial summary written
  });

  it('embeds and upserts the new summary into the vector index', async () => {
    await setOrgHindsightEnabled(db, orgId, true);

    const convo = await createConversation(db, { orgId, projectId, assistantId: null, source: 'slack' });
    await appendConversationMessage(db, { conversationId: convo.id, role: 'user', content: 'What is the CPU spike?' });
    await appendConversationMessage(db, { conversationId: convo.id, role: 'assistant', content: 'The CPU spike is from process X.' });

    const vector = new InMemoryVectorIndex();
    const embed = async (_text: string) => [1, 0, 0];
    const llm = fakeLlm('The CPU spike is from process X. Under investigation.');

    await summarizeTurn({ db, llm, vector, embed }, makeTurn(convo.id));

    const hits = await vector.findNeighbors([1, 0, 0], { limit: 5, filter: { kind: ['summary'] } });
    expect(hits.map((h) => h.id)).toContain(convo.id);
  });
});
