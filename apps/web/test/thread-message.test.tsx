// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { ThreadMessage } from '../src/components/conversation/thread-message';
import type { Participant, ThreadEvent } from '../src/lib/api';

afterEach(cleanup);

const participant: Participant = { key: 'c1', name: 'Triage', role: 'assistant', color: '#0ea5e9' };
const items: ThreadEvent[] = [
  { kind: 'message', id: 'm1', at: '2026-06-22T14:31:00Z', participantKey: 'c1', conversationId: 'c1', text: 'On it.' },
  { kind: 'tool', id: 't1', at: '2026-06-22T14:31:02Z', participantKey: 'c1', conversationId: 'c1', name: 'gcp.logging.query', status: 'ok', latencyMs: 1200, input: 'x', output: 'y', truncated: false, error: null },
];

describe('ThreadMessage', () => {
  test('renders the participant name, role chip, the message text and a tool chip', () => {
    render(<ThreadMessage participant={participant} items={items} />);
    expect(screen.getByText('Triage')).toBeDefined();
    expect(screen.getByText('assistant')).toBeDefined();
    expect(screen.getByText('On it.')).toBeDefined();
    expect(screen.getByText('gcp.logging.query')).toBeDefined();
  });
});
