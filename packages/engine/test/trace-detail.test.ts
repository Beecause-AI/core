import { describe, expect, it } from 'vitest';
import { runAgentLoop } from '../src/loop.js';
import type { ModelEvent, ModelRequest, ToolDef, ToolCall, ToolResult } from '../src/provider.js';
import type { TurnTrace, ToolStepDetail } from '../src/trace.js';

// Recording trace that captures the full detail object passed to ToolCallSpan.end
function detailCapturingTrace() {
  const toolEnds: Array<{ status: string; detail?: ToolStepDetail }> = [];
  const trace: TurnTrace = {
    startModelCall: () => ({ setUsage() {}, end() {} }),
    startToolCall: () => ({ end: (s, d) => toolEnds.push({ status: s, detail: d }) }),
    end() {},
  };
  return { trace, toolEnds };
}

async function collect(it: AsyncIterable<ModelEvent>) {
  const out: ModelEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

// ── Tool-executing loop: argsPreview + resultPreview ─────────────────────────

const CALC_DEF: ToolDef = { name: 'calc.add', description: 'add', parameters: { type: 'object' }, kind: 'builtin', mutates: false };
function calcTools() {
  return {
    toToolDefs: (names: string[]) => names.includes('calc.add') ? [CALC_DEF] : [],
    execute: async (call: ToolCall): Promise<ToolResult> => ({
      toolCallId: call.id,
      name: call.name,
      content: '42',
    }),
  };
}

describe('ToolCallSpan.end detail — tool execution', () => {
  it('populates argsPreview and resultPreview for a normal inline tool execution', async () => {
    const tools = calcTools();
    let runs = 0;
    const provider = {
      id: 'm',
      async *run(): AsyncIterable<ModelEvent> {
        runs++;
        if (runs === 1) {
          yield { type: 'tool_call', call: { id: 't1', name: 'calc.add', arguments: { a: 10, b: 32 } } };
          yield { type: 'done', finishReason: 'tool_use' };
        } else {
          yield { type: 'text', delta: 'The answer is 42.' };
          yield { type: 'done', finishReason: 'stop' };
        }
      },
    };

    const base: ModelRequest = { model: 'm', messages: [{ role: 'user', content: 'add 10 and 32' }] };
    const { trace, toolEnds } = detailCapturingTrace();

    await collect(runAgentLoop(base, { provider, ctx: { apiKey: 'k' }, tools, toolNames: ['calc.add'], trace }, new AbortController().signal));

    expect(toolEnds).toHaveLength(1);
    const end0 = toolEnds[0]!;
    expect(end0.status).toBe('ok');
    expect(end0.detail).toMatchObject({
      argsPreview: JSON.stringify({ a: 10, b: 32 }),
      resultPreview: '42',
    });
    // no error or childConversationId on a normal tool call
    expect(end0.detail?.error).toBeUndefined();
    expect(end0.detail?.childConversationId).toBeUndefined();
  });

  it('populates error in detail when tool returns isError', async () => {
    const failTools = {
      toToolDefs: (names: string[]) => names.includes('calc.add') ? [CALC_DEF] : [],
      execute: async (call: ToolCall): Promise<ToolResult> => ({
        toolCallId: call.id,
        name: call.name,
        content: 'something went wrong',
        isError: true,
      }),
    };
    let runs = 0;
    const provider = {
      id: 'm',
      async *run(): AsyncIterable<ModelEvent> {
        runs++;
        if (runs === 1) {
          yield { type: 'tool_call', call: { id: 'e1', name: 'calc.add', arguments: { x: 0 } } };
          yield { type: 'done', finishReason: 'tool_use' };
        } else {
          yield { type: 'text', delta: 'error noted' };
          yield { type: 'done', finishReason: 'stop' };
        }
      },
    };

    const base: ModelRequest = { model: 'm', messages: [{ role: 'user', content: 'fail' }] };
    const { trace, toolEnds } = detailCapturingTrace();

    await collect(runAgentLoop(base, { provider, ctx: { apiKey: 'k' }, tools: failTools, toolNames: ['calc.add'], trace }, new AbortController().signal));

    expect(toolEnds).toHaveLength(1);
    const end0 = toolEnds[0]!;
    expect(end0.status).toBe('error');
    expect(end0.detail?.error).toBe('something went wrong');
    expect(end0.detail?.argsPreview).toBe(JSON.stringify({ x: 0 }));
  });
});

// ── Sub-agent resume: resultPreview + childConversationId ─────────────────────

const AGENT_DEF: ToolDef = { name: 'agent.worker', description: 'sub', parameters: { type: 'object' }, kind: 'agent', mutates: false };
function agentTools() {
  return {
    toToolDefs: (names: string[]) => names.includes('agent.worker') ? [AGENT_DEF] : [],
    execute: async (_call: ToolCall): Promise<ToolResult> => { throw new Error('agent must not be executed inline'); },
  };
}

describe('ToolCallSpan.end detail — sub-agent resume', () => {
  it('populates resultPreview and childConversationId from subagentResults + childConversationIds', async () => {
    const tools = agentTools();
    const provider = {
      id: 'm',
      async *run(): AsyncIterable<ModelEvent> {
        yield { type: 'text', delta: 'child done' };
        yield { type: 'done', finishReason: 'stop' };
      },
    };

    // Resume: messages end with the assistant agent-toolCall message (as saved by onState on suspend)
    const resumeReq: ModelRequest = {
      model: 'm',
      messages: [
        { role: 'user', content: 'delegate task' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'sa1', name: 'agent.worker', arguments: { task: 'build it' } }] },
      ],
    };

    const { trace, toolEnds } = detailCapturingTrace();

    await collect(
      runAgentLoop(resumeReq, {
        provider,
        ctx: { apiKey: 'k' },
        tools,
        toolNames: ['agent.worker'],
        subagentResults: { sa1: 'The sub-agent completed the build.' },
        childConversationIds: { sa1: 'conv-child-abc123' },
        trace,
      }, new AbortController().signal),
    );

    expect(toolEnds).toHaveLength(1);
    const end0 = toolEnds[0]!;
    expect(end0.status).toBe('ok');
    expect(end0.detail).toMatchObject({
      resultPreview: 'The sub-agent completed the build.',
      childConversationId: 'conv-child-abc123',
    });
    // no argsPreview or error on a sub-agent resume
    expect(end0.detail?.argsPreview).toBeUndefined();
    expect(end0.detail?.error).toBeUndefined();
  });

  it('uses "(sub-agent returned nothing)" when subagentResults has no entry for the call id', async () => {
    const tools = agentTools();
    const provider = {
      id: 'm',
      async *run(): AsyncIterable<ModelEvent> {
        yield { type: 'text', delta: 'noted' };
        yield { type: 'done', finishReason: 'stop' };
      },
    };

    const resumeReq: ModelRequest = {
      model: 'm',
      messages: [
        { role: 'user', content: 'delegate task' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'sa2', name: 'agent.worker', arguments: {} }] },
      ],
    };

    const { trace, toolEnds } = detailCapturingTrace();

    await collect(
      runAgentLoop(resumeReq, {
        provider,
        ctx: { apiKey: 'k' },
        tools,
        toolNames: ['agent.worker'],
        subagentResults: {}, // no entry for sa2
        trace,
      }, new AbortController().signal),
    );

    expect(toolEnds).toHaveLength(1);
    const end0 = toolEnds[0]!;
    expect(end0.detail?.resultPreview).toBe('(sub-agent returned nothing)');
    expect(end0.detail?.childConversationId).toBeUndefined();
  });
});

// ── preview() truncation — tested indirectly via a long-arg tool call ─────────

describe('preview truncation', () => {
  it('truncates argsPreview for large argument objects', async () => {
    const longStr = 'x'.repeat(3000);
    const longArgTools = {
      toToolDefs: (names: string[]) => names.includes('calc.add') ? [CALC_DEF] : [],
      execute: async (call: ToolCall): Promise<ToolResult> => ({ toolCallId: call.id, name: call.name, content: 'done' }),
    };
    let runs = 0;
    const provider = {
      id: 'm',
      async *run(): AsyncIterable<ModelEvent> {
        runs++;
        if (runs === 1) {
          yield { type: 'tool_call', call: { id: 'p1', name: 'calc.add', arguments: { data: longStr } } };
          yield { type: 'done', finishReason: 'tool_use' };
        } else {
          yield { type: 'done', finishReason: 'stop' };
        }
      },
    };

    const base: ModelRequest = { model: 'm', messages: [{ role: 'user', content: 'go' }] };
    const { trace, toolEnds } = detailCapturingTrace();

    await collect(runAgentLoop(base, { provider, ctx: { apiKey: 'k' }, tools: longArgTools, toolNames: ['calc.add'], trace }, new AbortController().signal));

    expect(toolEnds).toHaveLength(1);
    const end0 = toolEnds[0]!;
    // preview truncates to 2000 chars (2000 - 1 content + '…' = 2000 chars total)
    expect(end0.detail?.argsPreview?.length).toBe(2000);
    expect(end0.detail?.argsPreview?.endsWith('…')).toBe(true);
  });
});
