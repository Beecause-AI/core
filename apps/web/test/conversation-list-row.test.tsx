// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { ConversationListRow } from '../src/components/conversation/conversation-list-row';
import type { ConversationSummary } from '../src/lib/api';

afterEach(cleanup);

const summary: ConversationSummary = {
  id: 'c1', source: 'slack', status: 'done', title: 'Checkout 500s',
  preview: 'Root cause — deploy a3f9c1 cut the pool', assistantIds: ['a1', 'a2'],
  agentCount: 2, createdAt: '2026-06-22T14:31:00Z', lastActivityAt: '2026-06-22T14:43:00Z',
};

describe('ConversationListRow', () => {
  test('shows title, preview, source and status, linking to the detail route', () => {
    render(<ConversationListRow slug="acme" summary={summary} />);
    expect(screen.getByText('Checkout 500s')).toBeDefined();
    expect(screen.getByText(/Root cause/)).toBeDefined();
    expect(screen.getByText('done')).toBeDefined();
    const link = screen.getByRole('link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/p/acme/conversations/c1');
  });
});
