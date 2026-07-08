// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { ToolChip } from '../src/components/conversation/tool-chip';
import type { ThreadEvent } from '../src/lib/api';

afterEach(cleanup);

const tool: Extract<ThreadEvent, { kind: 'tool' }> = {
  kind: 'tool', id: 't1', at: '2026-06-22T14:31:00Z', participantKey: 'c1', conversationId: 'c1',
  name: 'gcp.logging.query', status: 'ok', latencyMs: 1200,
  input: 'severity>=ERROR', output: '312 matches', truncated: false, error: null,
};

describe('ToolChip', () => {
  test('shows the tool name collapsed; reveals input/output on click', () => {
    render(<ToolChip tool={tool} />);
    expect(screen.getByText('gcp.logging.query')).toBeDefined();
    expect(screen.queryByText('312 matches')).toBeNull();
    fireEvent.click(screen.getByText('gcp.logging.query'));
    expect(screen.getByText('312 matches')).toBeDefined();
    expect(screen.getByText('severity>=ERROR')).toBeDefined();
  });
});
