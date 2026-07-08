import { describe, expect, it } from 'vitest';
import type { ConversationThread } from '../src/conversations/thread.js';
import { serializeThread, stripCodeFences, generateReportHtml } from '../src/reports/generate.js';
import { REPORT_STYLE_PROMPT } from '../src/reports/style-prompt.js';

const fakeThread: ConversationThread = {
  conversationId: 'conv-1',
  source: 'slack',
  status: 'closed',
  title: 'Test incident',
  participants: [
    { key: 'human', name: 'Slack user', role: 'human', color: '#6366f1' },
    { key: 'agent-1', name: 'Lead', role: 'assistant', color: '#0ea5e9' },
  ],
  events: [
    {
      kind: 'message',
      id: 'msg-1',
      at: '2026-06-28T10:00:00.000Z',
      participantKey: 'human',
      conversationId: 'conv-1',
      text: 'What caused the outage?',
    },
    {
      kind: 'tool',
      id: 'tool-1',
      at: '2026-06-28T10:01:00.000Z',
      participantKey: 'agent-1',
      conversationId: 'conv-1',
      name: 'gcp.metrics.query',
      status: 'success',
      latencyMs: 342,
      input: JSON.stringify({ query: 'rate(http_requests_total[5m])' }),
      output: JSON.stringify({ values: [1.23, 4.56] }),
      truncated: false,
      error: null,
    },
    {
      kind: 'message',
      id: 'msg-2',
      at: '2026-06-28T10:02:00.000Z',
      participantKey: 'agent-1',
      conversationId: 'conv-1',
      text: 'The root cause was a spike in traffic.',
    },
  ],
  totals: { inputTokens: 100, outputTokens: 50, costUsd: '0.001234' },
} as ConversationThread;

describe('serializeThread', () => {
  it('includes human message text', () => {
    const out = serializeThread(fakeThread);
    expect(out).toContain('What caused the outage?');
  });

  it('includes assistant message text', () => {
    const out = serializeThread(fakeThread);
    expect(out).toContain('The root cause was a spike in traffic.');
  });

  it('includes the tool name', () => {
    const out = serializeThread(fakeThread);
    expect(out).toContain('gcp.metrics.query');
  });

  it('includes the full tool input (the query for replication)', () => {
    const out = serializeThread(fakeThread);
    expect(out).toContain('rate(http_requests_total[5m])');
  });

  it('includes the tool output', () => {
    const out = serializeThread(fakeThread);
    expect(out).toContain('1.23');
  });
});

describe('stripCodeFences', () => {
  it('strips ```html ... ``` wrapper', () => {
    const result = stripCodeFences('```html\n<!doctype html><html></html>\n```');
    expect(result).toBe('<!doctype html><html></html>');
  });

  it('strips ``` ... ``` wrapper (no lang tag)', () => {
    const result = stripCodeFences('```\n<!doctype html><html></html>\n```');
    expect(result).toBe('<!doctype html><html></html>');
  });

  it('returns a plain string unchanged', () => {
    const result = stripCodeFences('<!doctype html><html></html>');
    expect(result).toBe('<!doctype html><html></html>');
  });
});

describe('generateReportHtml', () => {
  it('strips fences, includes transcript, includes style prompt', async () => {
    let receivedPrompt = '';
    const deps = {
      complete: async (prompt: string) => {
        receivedPrompt = prompt;
        return '```html\n<!doctype html><html><body>ok</body></html>\n```';
      },
    };

    const { html } = await generateReportHtml(deps, { thread: fakeThread });

    // Fences must be stripped
    expect(html).toMatch(/^<!doctype html>/i);

    // Prompt must include the style prompt marker
    expect(receivedPrompt).toContain('INVESTIGATION TRANSCRIPT');

    // Prompt must include the tool query (proving transcript was embedded)
    expect(receivedPrompt).toContain('rate(http_requests_total[5m])');

    // Prompt must include the style prompt content
    expect(receivedPrompt).toContain('report writer for Beecause');
  });

  it('uses skillPrompt when provided, not REPORT_STYLE_PROMPT', async () => {
    let receivedPrompt = '';
    const deps = {
      complete: async (prompt: string) => {
        receivedPrompt = prompt;
        return '<!doctype html><html></html>';
      },
    };

    const { html } = await generateReportHtml(deps, { thread: fakeThread, skillPrompt: 'CUSTOM SKILL PROMPT' });

    expect(receivedPrompt).toContain('CUSTOM SKILL PROMPT');
    expect(receivedPrompt).not.toContain(REPORT_STYLE_PROMPT);
    expect(html).toMatch(/^<!doctype html>/i);
  });
});
