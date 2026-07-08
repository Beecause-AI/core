import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from './emulator.js';
import { col } from '../../src/store/collections.js';
import { toDoc, applyDefaults } from '../../src/store/codec.js';
import { startRcaRun, finishRcaRun } from '../../src/repos/rca-runs.js';

const store = testStore('rca-runs');
const db = store.db;

beforeEach(() => wipe(db));
afterAll(() => store.close());

async function seedConversation(id: string, status = 'open') {
  await col(db, 'conversations').doc(id).set(toDoc(applyDefaults({
    orgId: 'o', projectId: 'p', assistantId: 'a', rootConversationId: null,
    source: 'web', status, summary: '', slackChannelId: null, slackThreadTs: null,
  }, id)));
}
const statusOf = async (id: string) => (await col(db, 'conversations').doc(id).get()).data()?.['status'];

describe('rca-runs: single-flight start/finish (Firestore txn)', () => {
  it('first start flips the conversation to investigating', async () => {
    await seedConversation('c1');
    const first = await startRcaRun(db, { incidentConversationId: 'c1' });
    expect(first.alreadyRunning).toBe(false);
    expect(await statusOf('c1')).toBe('investigating');
  });

  it('second start for the same conversation is a single-flight no-op', async () => {
    await seedConversation('c2');
    await startRcaRun(db, { incidentConversationId: 'c2' });
    const second = await startRcaRun(db, { incidentConversationId: 'c2' });
    expect(second.alreadyRunning).toBe(true);
    expect(await statusOf('c2')).toBe('investigating');
  });

  it('concurrent starts elect exactly one winner', async () => {
    await seedConversation('c3');
    const results = await Promise.all(
      Array.from({ length: 8 }, () => startRcaRun(db, { incidentConversationId: 'c3' })),
    );
    expect(results.filter((r) => !r.alreadyRunning)).toHaveLength(1);
    expect(await statusOf('c3')).toBe('investigating');
  });

  it('finish marks the conversation done', async () => {
    await seedConversation('c4');
    await startRcaRun(db, { incidentConversationId: 'c4' });
    await finishRcaRun(db, { incidentConversationId: 'c4', status: 'done' });
    expect(await statusOf('c4')).toBe('done');
  });
});
