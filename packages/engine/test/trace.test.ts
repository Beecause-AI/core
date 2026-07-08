import { describe, expect, it } from 'vitest';
import { runAgentLoop } from '../src/loop.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { addTool } from '../src/tools/builtins/add.js';
import type { ModelEvent, ModelRequest } from '../src/provider.js';
import type { TurnTrace } from '../src/trace.js';

function recordingTrace() {
  const events: string[] = [];
  const trace: TurnTrace = {
    startModelCall(model) {
      events.push(`model:start:${model}`);
      return { setUsage: (i, o) => events.push(`model:usage:${i}/${o}`), end: (s) => events.push(`model:end:${s}`) };
    },
    startToolCall(name) {
      events.push(`tool:start:${name}`);
      return { end: (s) => events.push(`tool:end:${s}`) };
    },
    end: (s, fr) => events.push(`turn:end:${s}:${fr ?? ''}`),
  };
  return { trace, events };
}

const reg = new ToolRegistry([addTool]);
const base: ModelRequest = { model: 'm', messages: [{ role: 'user', content: 'add 2 and 3' }] };

describe('runAgentLoop tracing', () => {
  it('model-call span per iteration with usage, tool-call span per tool, ends on no-tool done', async () => {
    let runs = 0;
    const provider = {
      id: 'm',
      async *run() {
        runs++;
        if (runs === 1) {
          yield { type: 'usage', inputTokens: 3, outputTokens: 2 } as ModelEvent;
          yield { type: 'tool_call', call: { id: 'c1', name: 'builtin.add', arguments: { a: 2, b: 3 } } } as ModelEvent;
          yield { type: 'done', finishReason: 'tool_use' } as ModelEvent;
        } else {
          yield { type: 'text', delta: '5' } as ModelEvent;
          yield { type: 'done', finishReason: 'stop' } as ModelEvent;
        }
      },
    };
    const { trace, events } = recordingTrace();
    const out: ModelEvent[] = [];
    for await (const ev of runAgentLoop(base, { provider, ctx: { apiKey: 'k' }, tools: reg, toolNames: ['builtin.add'], trace }, new AbortController().signal)) out.push(ev);
    expect(events).toEqual([
      'model:start:m','model:usage:3/2','model:end:ok','tool:start:builtin.add','tool:end:ok','model:start:m','model:end:ok',
    ]);
  });

  it('works with no trace provided (noop)', async () => {
    const provider = { id: 'm', async *run() { yield { type: 'text', delta: 'hi' } as ModelEvent; yield { type: 'done', finishReason: 'stop' } as ModelEvent; } };
    const out: ModelEvent[] = [];
    for await (const ev of runAgentLoop(base, { provider, ctx: { apiKey: 'k' }, tools: reg, toolNames: [] }, new AbortController().signal)) out.push(ev);
    expect(out.at(-1)).toMatchObject({ type: 'done', finishReason: 'stop' });
  });
});
