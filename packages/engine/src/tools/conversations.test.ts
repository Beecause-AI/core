import { describe, it, expect } from 'vitest';
import { ConversationsReadToolExecutor, formatTranscript, type ConversationsReadClient } from './conversations.js';

const sig = new AbortController().signal;
const client: ConversationsReadClient = {
  read: async (projectId, id) => (projectId === 'p' && id === 'c1' ? 'user: it broke\nassistant: fixed' : null),
};

describe('ConversationsReadToolExecutor', () => {
  it('exposes conversations.read only when requested AND scoped', async () => {
    const ex = new ConversationsReadToolExecutor(client, 'p');
    expect((await ex.toToolDefs(['conversations.read'])).map((d) => d.name)).toEqual(['conversations.read']);
    expect(await ex.toToolDefs(['builtin.add'])).toEqual([]);
    expect(await new ConversationsReadToolExecutor(client, undefined).toToolDefs(['conversations.read'])).toEqual([]);
  });
  it('reads a conversation in this project', async () => {
    const ex = new ConversationsReadToolExecutor(client, 'p');
    const r = await ex.execute({ id: '1', name: 'conversations.read', arguments: { conversationId: 'c1' } }, sig);
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain('it broke');
  });
  it('rejects a conversation not in this project', async () => {
    const ex = new ConversationsReadToolExecutor(client, 'p');
    const r = await ex.execute({ id: '1', name: 'conversations.read', arguments: { conversationId: 'other' } }, sig);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not found/i);
  });
  it('errors when conversationId is missing', async () => {
    const ex = new ConversationsReadToolExecutor(client, 'p');
    const r = await ex.execute({ id: '1', name: 'conversations.read', arguments: {} }, sig);
    expect(r.isError).toBe(true);
  });
});

describe('formatTranscript', () => {
  it('prefixes roles and truncates to maxChars', () => {
    const rows = [{ role: 'user', content: 'a'.repeat(50) }, { role: 'assistant', content: 'b'.repeat(50) }];
    const out = formatTranscript(rows, 20);
    expect(out.length).toBe(20);
    expect(out.endsWith('…')).toBe(true);
  });
});
