import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from './emulator.js';
import {
  startOperation, startOrReuseOperation, finishOperation, getOperation, setOperationConversation,
} from '../../src/repos/operations.js';

const store = testStore('operations');
const db = store.db;

beforeEach(() => wipe(db));
afterAll(() => store.close());

const orgId = 'org-1';

describe('operations repo (Firestore)', () => {
  it('starts running and finishes with totals', async () => {
    const op = await startOperation(db, { orgId, kind: 'kg-build', refId: randomUUID() });
    expect(op.status).toBe('running');
    expect(op.finishedAt).toBeNull();
    expect(op.startedAt).toBeInstanceOf(Date);

    await finishOperation(db, op.id, { status: 'done', costUsd: '0.070000', inputTokens: 1000, outputTokens: 200 });
    const got = await getOperation(db, op.id);
    expect(got!.status).toBe('done');
    // numeric cost round-trips as a string
    expect(got!.costUsd).toBe('0.07');
    expect(got!.inputTokens).toBe(1000);
    expect(got!.finishedAt).toBeInstanceOf(Date);
  });

  it('getOperation returns null for a missing id', async () => {
    expect(await getOperation(db, randomUUID())).toBeNull();
  });

  it('startOrReuseOperation reuses the latest op for the same (kind, refId)', async () => {
    const refId = randomUUID();
    const first = await startOperation(db, { orgId, kind: 'kg-build', refId });
    await finishOperation(db, first.id, { status: 'done' });

    const reused = await startOrReuseOperation(db, { orgId, kind: 'kg-build', refId });
    expect(reused.id).toBe(first.id);
    expect(reused.status).toBe('running');
    expect(reused.finishedAt).toBeNull();
  });

  it('startOrReuseOperation inserts fresh when refId is null', async () => {
    const a = await startOrReuseOperation(db, { orgId, kind: 'embedding', refId: null });
    const b = await startOrReuseOperation(db, { orgId, kind: 'embedding', refId: null });
    expect(a.id).not.toBe(b.id);
  });

  it('startOrReuseOperation does not reuse across a different kind', async () => {
    const refId = randomUUID();
    const a = await startOperation(db, { orgId, kind: 'kg-build', refId });
    const b = await startOrReuseOperation(db, { orgId, kind: 'team-autogen', refId });
    expect(b.id).not.toBe(a.id);
  });

  it('setOperationConversation links the run conversation', async () => {
    const op = await startOperation(db, { orgId, kind: 'team-autogen' });
    const convId = randomUUID();
    await setOperationConversation(db, op.id, convId);
    expect((await getOperation(db, op.id))!.runConversationId).toBe(convId);
  });
});
