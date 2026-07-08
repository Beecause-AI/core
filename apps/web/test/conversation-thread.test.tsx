// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ConversationThread } from '../src/components/conversation/conversation-thread';
import type { ConversationThread as Thread } from '../src/lib/api';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const thread: Thread = {
  conversationId: 'c1', source: 'slack', status: 'done', title: 'Checkout 500s',
  participants: [
    { key: 'human', name: 'Slack user', role: 'human', color: '#6366f1' },
    { key: 'c1', name: 'Triage', role: 'assistant', color: '#0ea5e9' },
    { key: 'c2', name: 'Database Specialist', role: 'sub-agent', color: '#a855f7' },
  ],
  events: [
    { kind: 'message', id: 'u1', at: '2026-06-22T14:31:00Z', participantKey: 'human', conversationId: 'c1', text: 'Checkout 500s?' },
    { kind: 'message', id: 'a1', at: '2026-06-22T14:31:01Z', participantKey: 'c1', conversationId: 'c1', text: 'On it.' },
    { kind: 'handover', id: 'h1', at: '2026-06-22T14:31:02Z', fromKey: 'c1', toKey: 'c2', toName: 'Database Specialist', task: 'investigate db' },
    { kind: 'message', id: 'a2', at: '2026-06-22T14:31:03Z', participantKey: 'c2', conversationId: 'c2', text: 'Pool maxed.' },
    { kind: 'return', id: 'h1:ret', at: '2026-06-22T14:31:04Z', fromKey: 'c2', toKey: 'c1' },
  ],
  totals: { inputTokens: 1200, outputTokens: 340, costUsd: '0.012300' },
};

function stubFetch(t: Thread) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(t), { status: 200, headers: { 'content-type': 'application/json' } })));
}

describe('ConversationThread', () => {
  test('renders human + assistant + sub-agent turns and the handover marker', async () => {
    stubFetch(thread);
    render(<ConversationThread slug="acme" conversationId="c1" />);
    await waitFor(() => expect(screen.getByText('Checkout 500s?')).toBeDefined());
    expect(screen.getByText('On it.')).toBeDefined();
    expect(screen.getByText('Pool maxed.')).toBeDefined();
    expect(screen.getByText(/Triage → Database Specialist/)).toBeDefined();
    expect(screen.getByText(/investigate db/)).toBeDefined();
    expect(screen.getByText(/returned to Triage/)).toBeDefined();
  });

  test('collapses consecutive same-participant message + tool into one turn', async () => {
    const t: Thread = {
      conversationId: 'c1', source: 'web', status: 'done', title: 'x',
      participants: [{ key: 'c1', name: 'Triage', role: 'assistant', color: '#0ea5e9' }],
      events: [
        { kind: 'message', id: 'm1', at: '2026-06-22T14:31:00Z', participantKey: 'c1', conversationId: 'c1', text: 'Looking now.' },
        { kind: 'tool', id: 't1', at: '2026-06-22T14:31:01Z', participantKey: 'c1', conversationId: 'c1', name: 'gcp.logging.query', status: 'ok', latencyMs: 10, input: 'x', output: 'y', truncated: false, error: null },
      ],
      totals: { inputTokens: 0, outputTokens: 0, costUsd: null },
    };
    stubFetch(t);
    render(<ConversationThread slug="acme" conversationId="c1" />);
    await waitFor(() => expect(screen.getByText('Looking now.')).toBeDefined());
    expect(screen.getByText('gcp.logging.query')).toBeDefined();
    // both rendered under ONE turn → the participant header appears exactly once
    expect(screen.getAllByText('Triage')).toHaveLength(1);
  });

  test('top bar shows status + total tokens + cost when present', async () => {
    stubFetch(thread); // costUsd '0.012300', 1200+340 tokens
    render(<ConversationThread slug="acme" conversationId="c1" />);
    await waitFor(() => expect(screen.getByText('done')).toBeDefined());
    expect(screen.getByText(/1\.5k tokens/)).toBeDefined();
    expect(screen.getByText(/\$0\.0123/)).toBeDefined();
  });

  test('top bar hides cost when the org has not enabled it (costUsd null)', async () => {
    stubFetch({ ...thread, totals: { inputTokens: 100, outputTokens: 20, costUsd: null } });
    render(<ConversationThread slug="acme" conversationId="c1" />);
    await waitFor(() => expect(screen.getByText(/120 tokens/)).toBeDefined());
    expect(screen.queryByText(/^\$/)).toBeNull();
  });
});
