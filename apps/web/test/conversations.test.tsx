// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ConversationsTab } from '../src/components/project/conversations-tab';
import type { ConversationSummary, ConversationThread } from '../src/lib/api';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const summaries: ConversationSummary[] = [
  { id: 'c1', source: 'slack', status: 'done', title: 'Checkout 500s', preview: 'Root cause found', assistantIds: ['a1'], agentCount: 2, createdAt: '2026-06-22T14:31:00Z', lastActivityAt: '2026-06-22T14:43:00Z' },
];

const thread: ConversationThread = {
  conversationId: 'c1', source: 'slack', status: 'done', title: 'Checkout 500s',
  participants: [
    { key: 'human', name: 'Slack user', role: 'human', color: '#6366f1' },
    { key: 'c1', name: 'Triage', role: 'assistant', color: '#0ea5e9' },
  ],
  events: [
    { kind: 'message', id: 'u1', at: '2026-06-22T14:31:00Z', participantKey: 'human', conversationId: 'c1', text: 'Checkout 500s?' },
    { kind: 'message', id: 'a1', at: '2026-06-22T14:31:01Z', participantKey: 'c1', conversationId: 'c1', text: 'On it.' },
  ],
  totals: { inputTokens: 100, outputTokens: 20, costUsd: null },
};

describe('ConversationsTab', () => {
  test('list mode renders one row per conversation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(summaries), { status: 200, headers: { 'content-type': 'application/json' } })));
    render(<ConversationsTab slug="acme" />);
    await waitFor(() => expect(screen.getByText('Checkout 500s')).toBeDefined());
    expect(screen.getByText(/Root cause found/)).toBeDefined();
  });

  test('detail mode renders the thread + back link', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(thread), { status: 200, headers: { 'content-type': 'application/json' } })));
    render(<ConversationsTab slug="acme" conversationId="c1" />);
    await waitFor(() => expect(screen.getByText('Checkout 500s?')).toBeDefined());
    expect(screen.getByText('On it.')).toBeDefined();
    expect(screen.getByText('All conversations')).toBeDefined();
  });

  test('list mode shows the empty state when there are no conversations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })));
    render(<ConversationsTab slug="acme" />);
    await waitFor(() => expect(screen.getByText('No conversations yet')).toBeDefined());
  });

  test('list mode shows an error message when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Server error' }), { status: 500, headers: { 'content-type': 'application/json' } })));
    render(<ConversationsTab slug="acme" />);
    await waitFor(() => expect(screen.getByText('Server error')).toBeDefined());
  });
});
