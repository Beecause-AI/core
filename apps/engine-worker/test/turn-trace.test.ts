import { describe, expect, it, vi, beforeEach } from 'vitest';

const { createTrace, addTraceStep, finalizeTrace } = vi.hoisted(() => ({
  createTrace: vi.fn(async () => ({ id: 'trace-1' })),
  addTraceStep: vi.fn(async () => ({})),
  finalizeTrace: vi.fn(async () => {}),
}));
// Spread the real module (so MODEL_PRICES etc. survive for cost.ts) and stub only the trace fns.
vi.mock('@intellilabs/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@intellilabs/core')>()),
  createTrace, addTraceStep, finalizeTrace,
}));

import { makeTurnTrace } from '../src/engine/turn-trace.js';

function stubTracer() {
  const span = () => ({
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    end: vi.fn(),
    spanContext: () => ({ traceId: 'otelabc', spanId: 's', traceFlags: 1 }),
  });
  return { startSpan: vi.fn(() => span()) } as any;
}

const turn = { id: 't1', orgId: 'org1', laneId: 'lane1', source: 'slack' } as any;

beforeEach(() => {
  createTrace.mockClear();
  addTraceStep.mockClear();
  finalizeTrace.mockClear();
});

describe('makeTurnTrace', () => {
  it('creates a trace, writes a model_call + tool_call step, and finalizes with rollup', async () => {
    const factory = makeTurnTrace({} as any, stubTracer());
    const t = factory(turn);
    const m = t.startModelCall('gemini-3-flash-preview');
    m.setUsage(1_000_000, 1_000_000);
    m.end('ok');
    const tool = t.startToolCall('builtin.add', 'builtin');
    tool.end('ok');
    t.end('ok', 'stop');
    // allow the async DB writes (fire-and-forget) to settle
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(createTrace).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addCalls = addTraceStep.mock.calls as any[][];
    const stepTypes = addCalls.map((c) => c[1].type);
    expect(stepTypes).toContain('model_call');
    expect(stepTypes).toContain('tool_call');
    const modelStep = addCalls.find((c) => c[1].type === 'model_call')?.[1] as any;
    expect(modelStep).toBeDefined();
    expect(modelStep.inputTokens).toBe(1_000_000);
    expect(modelStep.outputTokens).toBe(1_000_000);
    expect(modelStep.costUsd).toBeGreaterThan(0); // costUsd('gemini-3-flash-preview', 1e6, 1e6) = 0.375
    expect(finalizeTrace).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalizeCalls = finalizeTrace.mock.calls as any[][];
    const rollup = finalizeCalls[0]?.[2] as any;
    expect(rollup).toBeDefined();
    expect(rollup.modelCallCount).toBe(1);
    expect(rollup.toolCallCount).toBe(1);
    expect(rollup.totalInputTokens).toBe(1_000_000);
    expect(rollup.status).toBe('ok');
    expect(rollup.otelTraceId).toBe('otelabc');
  });

  it('end() is idempotent (finalize once)', async () => {
    const t = makeTurnTrace({} as any, stubTracer())(turn);
    t.end('ok', 'stop');
    t.end('ok', 'stop');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(finalizeTrace).toHaveBeenCalledTimes(1);
  });

  it('tool span end() with detail writes argsPreview, resultPreview, childConversationId', async () => {
    const factory = makeTurnTrace({} as any, stubTracer());
    const t = factory(turn);
    const tool = t.startToolCall('agent.researcher', 'agent');
    tool.end('ok', {
      argsPreview: 'input: research X',
      resultPreview: 'the answer',
      childConversationId: 'child-lane-id-123',
    });
    t.end('ok', 'stop');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addCalls = addTraceStep.mock.calls as any[][];
    const toolStep = addCalls.find((c) => c[1].type === 'tool_call')?.[1] as any;
    expect(toolStep).toBeDefined();
    expect(toolStep.argsPreview).toBe('input: research X');
    expect(toolStep.resultPreview).toBe('the answer');
    expect(toolStep.childConversationId).toBe('child-lane-id-123');
    expect(toolStep.error).toBeNull();
  });

  it('tool span end() with error detail sets error and null previews', async () => {
    const factory = makeTurnTrace({} as any, stubTracer());
    const t = factory(turn);
    const tool = t.startToolCall('agent.researcher', 'agent');
    tool.end('error', { error: 'sub-agent failed' });
    t.end('ok', 'stop');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addCalls = addTraceStep.mock.calls as any[][];
    const toolStep = addCalls.find((c) => c[1].type === 'tool_call')?.[1] as any;
    expect(toolStep).toBeDefined();
    expect(toolStep.error).toBe('sub-agent failed');
    expect(toolStep.argsPreview).toBeNull();
    expect(toolStep.resultPreview).toBeNull();
    expect(toolStep.childConversationId).toBeNull();
  });
});
