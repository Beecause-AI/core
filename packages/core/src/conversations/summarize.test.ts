import { describe, it, expect } from 'vitest';
import { summarizeConversation } from './summarize.js';

describe('summarizeConversation', () => {
  it('folds the latest exchange into the prior summary and trims', async () => {
    let prompt = '';
    const out = await summarizeConversation(
      { llm: async (p) => { prompt = p; return { text: '  Investigating 5xx on api; DB latency suspected.  ', inputTokens: 12, outputTokens: 8 }; } },
      { priorSummary: 'Investigating 5xx on api.', latestExchange: 'assistant: DB p99 latency is up 4x.' },
    );
    expect(out.summary).toBe('Investigating 5xx on api; DB latency suspected.');
    expect(out.inputTokens).toBe(12);
    expect(prompt).toContain('Investigating 5xx on api.'); // prior summary fed in
    expect(prompt).toContain('DB p99 latency is up 4x.');   // latest exchange fed in
  });

  it('handles an empty prior summary', async () => {
    const out = await summarizeConversation(
      { llm: async () => ({ text: 'New incident: checkout failing.', inputTokens: 1, outputTokens: 1 }) },
      { priorSummary: '', latestExchange: 'user: checkout is failing' },
    );
    expect(out.summary).toBe('New incident: checkout failing.');
  });
});
