// packages/engine/src/run-agent-loop-to-text.test.ts
import { describe, it, expect } from 'vitest';
import { runAgentLoopToText } from './run-agent-loop-to-text.js';
import type { ModelProvider, ModelEvent } from './provider.js';
import type { ToolExecutor } from './tools/types.js';

// Fake provider: round 1 emits a tool_call + usage; round 2 emits final text + usage + done.
function fakeProvider(): ModelProvider {
  let round = 0;
  return {
    id: 'fake',
    async *run(): AsyncGenerator<ModelEvent> {
      round += 1;
      if (round === 1) {
        yield { type: 'tool_call', call: { id: 'c0', name: 'recent.search', arguments: {} } };
        yield { type: 'usage', inputTokens: 10, outputTokens: 2 };
        yield { type: 'done', finishReason: 'tool_use' };
      } else {
        yield { type: 'text', delta: 'no recent precedent' };
        yield { type: 'usage', inputTokens: 5, outputTokens: 3 };
        yield { type: 'done', finishReason: 'stop' };
      }
    },
  } as unknown as ModelProvider;
}

const tools: ToolExecutor = {
  toToolDefs: async (names) => names.includes('recent.search')
    ? [{ name: 'recent.search', description: 'r', kind: 'builtin', mutates: false, parameters: { type: 'object', properties: {} } }]
    : [],
  execute: async (call) => ({ toolCallId: call.id, name: call.name, content: '(no recent conversation summaries)', isError: false }),
};

describe('runAgentLoopToText', () => {
  it('runs the loop to its final text and sums usage across rounds', async () => {
    const res = await runAgentLoopToText(
      { model: 'fake', messages: [{ role: 'user', content: 'hi' }] },
      { provider: fakeProvider(), ctx: { apiKey: 'k', baseUrl: 'b' }, tools, toolNames: ['recent.search'] },
    );
    expect(res.text).toBe('no recent precedent');
    expect(res.inputTokens).toBe(15);
    expect(res.outputTokens).toBe(5);
  });
});
