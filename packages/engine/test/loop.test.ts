import { describe, expect, it } from 'vitest';
import { runAgentLoop } from '../src/loop.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { addTool } from '../src/tools/builtins/add.js';
import { fakeProvider } from '../src/providers/fake.js';
import type { ModelEvent, ModelRequest, ToolDef, ToolCall, ToolResult } from '../src/provider.js';

const reg = new ToolRegistry([addTool]);
const base: ModelRequest = { model: 'm', messages: [{ role: 'user', content: 'add 2 and 3' }] };

async function collect(it: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const out: ModelEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('runAgentLoop', () => {
  it('passes a text-only turn straight through with one done', async () => {
    const provider = fakeProvider('m', [{ type: 'text', delta: 'hi' }, { type: 'done', finishReason: 'stop' }]);
    const events = await collect(runAgentLoop(base, {
      provider, ctx: { apiKey: 'k' }, tools: reg, toolNames: ['builtin.add'],
    }, new AbortController().signal));
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1);
    expect(events).toContainEqual({ type: 'text', delta: 'hi' });
  });

  it('executes a tool call, feeds the result back, and re-invokes the model', async () => {
    let runs = 0;
    const provider = {
      id: 'm',
      async *run() {
        runs++;
        if (runs === 1) {
          yield { type: 'tool_call', call: { id: 'c1', name: 'builtin.add', arguments: { a: 2, b: 3 } } } as ModelEvent;
          yield { type: 'done', finishReason: 'tool_use' } as ModelEvent;
        } else {
          yield { type: 'text', delta: 'The sum is 5.' } as ModelEvent;
          yield { type: 'done', finishReason: 'stop' } as ModelEvent;
        }
      },
    };
    const events = await collect(runAgentLoop(base, {
      provider, ctx: { apiKey: 'k' }, tools: reg, toolNames: ['builtin.add'],
    }, new AbortController().signal));
    expect(runs).toBe(2);
    expect(events).toContainEqual({ type: 'tool_call', call: { id: 'c1', name: 'builtin.add', arguments: { a: 2, b: 3 } } });
    expect(events).toContainEqual({ type: 'tool_result', result: { toolCallId: 'c1', name: 'builtin.add', content: '5' } });
    expect(events).toContainEqual({ type: 'text', delta: 'The sum is 5.' });
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'stop' });
  });

  it('stops at the iteration cap with finishReason max_iterations', async () => {
    const provider = {
      id: 'm',
      async *run() {
        yield { type: 'tool_call', call: { id: 'c', name: 'builtin.add', arguments: { a: 1, b: 1 } } } as ModelEvent;
        yield { type: 'done', finishReason: 'tool_use' } as ModelEvent;
      },
    };
    const events = await collect(runAgentLoop(base, {
      provider, ctx: { apiKey: 'k' }, tools: reg, toolNames: ['builtin.add'], maxIterations: 3,
    }, new AbortController().signal));
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'max_iterations' });
    expect(events.filter((e) => e.type === 'tool_call')).toHaveLength(3);
  });

  it('terminates with done(max_iterations) when the model never stops asking for tools', async () => {
    const provider = {
      id: 'm',
      async *run() {
        yield { type: 'tool_call', call: { id: 'c', name: 'builtin.add', arguments: { a: 1, b: 1 } } } as ModelEvent;
        yield { type: 'done', finishReason: 'tool_use' } as ModelEvent;
      },
    };
    const events = await collect(runAgentLoop(base, {
      provider, ctx: { apiKey: 'k' }, tools: reg, toolNames: ['builtin.add'], maxIterations: 3,
    }, new AbortController().signal));
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'max_iterations' });
  });

  it('never ends silently: emits a graceful fallback carrying the last tool error at the iteration cap', async () => {
    const FAIL: ToolDef = { name: 'flaky.read', description: 'r', parameters: { type: 'object' }, kind: 'mcp', mutates: false };
    const tools = {
      toToolDefs: (names: string[]) => names.includes('flaky.read') ? [FAIL] : [],
      execute: async (call: ToolCall): Promise<ToolResult> => ({
        toolCallId: call.id, name: call.name, isError: true,
        content: 'Invalid response body while trying to fetch https://www.googleapis.com',
      }),
    };
    const provider = {
      id: 'm',
      async *run(): AsyncIterable<ModelEvent> {
        yield { type: 'tool_call', call: { id: 'c', name: 'flaky.read', arguments: {} } };
        yield { type: 'done', finishReason: 'tool_use' };
      },
    };
    const events = await collect(runAgentLoop(
      { model: 'm', messages: [{ role: 'user', content: 'go' }] },
      { provider, ctx: { apiKey: 'k' }, tools, toolNames: ['flaky.read'], maxIterations: 2 },
      new AbortController().signal,
    ));
    const done = events.at(-1) as { type: 'done'; finishReason: string; answer?: string };
    expect(done.finishReason).toBe('max_iterations');
    // The graceful fallback now rides on done.answer (not a synthetic text event), and still
    // carries the underlying tool error.
    expect(done.answer).toMatch(/ran out of steps|couldn't/i);
    expect(done.answer).toContain('Invalid response body'); // underlying cause propagates
  });

  it('keeps the conclusion when the agent ends with text + a tool call then an empty round', async () => {
    // Mirrors the front-door offer flow: round 1 = conclusion + a (terminal-ish) tool call;
    // round 2 (forced by the tool result) returns empty. The answer must be the conclusion,
    // not "I couldn't produce a response.".
    let runs = 0;
    const provider = {
      id: 'm',
      async *run(): AsyncIterable<ModelEvent> {
        runs++;
        if (runs === 1) {
          yield { type: 'text', delta: 'Root cause: the widget is null.' };
          yield { type: 'tool_call', call: { id: 'c1', name: 'builtin.add', arguments: { a: 1, b: 1 } } };
          yield { type: 'done', finishReason: 'tool_use' };
        } else {
          yield { type: 'done', finishReason: 'stop' }; // empty follow-up round
        }
      },
    };
    const events = await collect(runAgentLoop(base, {
      provider, ctx: { apiKey: 'k' }, tools: reg, toolNames: ['builtin.add'],
    }, new AbortController().signal));
    expect(runs).toBe(2);
    const done = events.at(-1) as { type: 'done'; answer?: string };
    expect(done.answer).toBe('Root cause: the widget is null.');
    const texts = events.filter((e) => e.type === 'text') as Array<{ type: 'text'; delta: string }>;
    expect(texts.some((t) => /couldn't produce a response/i.test(t.delta))).toBe(false);
  });

  it('emits the empty fallback on done.answer when the turn produces no text at all', async () => {
    const provider = fakeProvider('m', [{ type: 'done', finishReason: 'stop' }]);
    const events = await collect(runAgentLoop(base, {
      provider, ctx: { apiKey: 'k' }, tools: reg, toolNames: ['builtin.add'],
    }, new AbortController().signal));
    const done = events.at(-1) as { type: 'done'; answer?: string };
    expect(done.answer).toMatch(/couldn't produce a response/i);
  });

  it('completes a tool-using turn without re-running on a different model', async () => {
    // Delegated sub-tasks no longer auto-escalate: the loop runs once on its configured
    // model and terminates with done — it never asks for a re-run on a bigger model.
    let runs = 0;
    const provider = {
      id: 'm',
      async *run() {
        runs++;
        if (runs === 1) {
          yield { type: 'tool_call', call: { id: 'c1', name: 'builtin.add', arguments: { a: 2, b: 3 } } } as ModelEvent;
          yield { type: 'done', finishReason: 'tool_use' } as ModelEvent;
        } else {
          yield { type: 'text', delta: 'The sum is 5.' } as ModelEvent;
          yield { type: 'done', finishReason: 'stop' } as ModelEvent;
        }
      },
    };
    const events = await collect(runAgentLoop(base, {
      provider, ctx: { apiKey: 'k' }, tools: reg, toolNames: ['builtin.add'],
    }, new AbortController().signal));
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'stop' });
  });
});
