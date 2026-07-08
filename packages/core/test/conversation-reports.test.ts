import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { testStore } from './store/emulator.js';
import { createConversationReport, listReportsForConversation, getConversationReport, getLatestReport } from '../src/repos/conversation-reports.js';

const t = testStore('conversation-reports');
afterAll(() => t.close());

describe('conversation_reports repo', () => {
  it('assigns incrementing versions per conversation and round-trips html', async () => {
    const cid = randomUUID();
    const r1 = await createConversationReport(t.db, { conversationId: cid, orgId: 'o1', projectId: 'p1', html: '<!doctype html><html>...v1...</html>' });
    const r2 = await createConversationReport(t.db, { conversationId: cid, orgId: 'o1', projectId: 'p1', html: '<!doctype html><html>...v2...</html>' });
    expect(r1.version).toBe(1);
    expect(r2.version).toBe(2);
    const latest = await getLatestReport(t.db, cid);
    expect(latest?.version).toBe(2);
    const list = await listReportsForConversation(t.db, cid);
    expect(list.map((r) => r.version)).toEqual([2, 1]);
    const got = await getConversationReport(t.db, r1.id);
    expect(got?.html).toBe('<!doctype html><html>...v1...</html>');
  });
  it('returns null for unknown conversation / id', async () => {
    expect(await getLatestReport(t.db, randomUUID())).toBeNull();
    expect(await getConversationReport(t.db, randomUUID())).toBeNull();
  });
});
