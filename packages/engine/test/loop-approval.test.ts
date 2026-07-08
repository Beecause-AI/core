import { describe, expect, it } from 'vitest';
import { runAgentLoop } from '../src/loop.js';
import type { ModelEvent, ModelRequest, ToolDef, ToolCall, ToolResult } from '../src/provider.js';
import type { ApprovalContext } from '../src/approval.js';

// a ToolExecutor with one write tool (mutates:true) and one read tool
const WRITE: ToolDef = { name: 'mcp.write', description: 'w', parameters: { type: 'object' }, kind: 'mcp', mutates: true };
function execz(): { toToolDefs: any; execute: any; calls: ToolCall[] } {
  const calls: ToolCall[] = [];
  return {
    calls,
    toToolDefs: (names: string[]) => names.includes('mcp.write') ? [WRITE] : [],
    execute: async (call: ToolCall): Promise<ToolResult> => { calls.push(call); return { toolCallId: call.id, name: call.name, content: 'did-it' }; },
  };
}
const base: ModelRequest = { model: 'm', messages: [{ role: 'user', content: 'do the write' }] };
async function collect(it: AsyncIterable<ModelEvent>) { const o: ModelEvent[] = []; for await (const e of it) o.push(e); return o; }
const gateAll: ApprovalContext = { required: (_n, mutates) => mutates };

describe('runAgentLoop approval', () => {
  it('suspends on a gated write tool without executing it', async () => {
    const tools = execz();
    const provider = { id: 'm', async *run() {
      yield { type: 'tool_call', call: { id: 'w1', name: 'mcp.write', arguments: { x: 1 } } } as ModelEvent;
      yield { type: 'done', finishReason: 'tool_use' } as ModelEvent;
    } };
    let captured: any[] | undefined;
    const events = await collect(runAgentLoop(base, { provider, ctx: { apiKey: 'k' }, tools, toolNames: ['mcp.write'], approval: gateAll, onState: (m) => { captured = m; } }, new AbortController().signal));
    expect(events).toContainEqual({ type: 'awaiting_approval', calls: [{ id: 'w1', name: 'mcp.write', arguments: { x: 1 } }] });
    expect(tools.calls).toHaveLength(0); // NOT executed
    expect(events.some((e) => e.type === 'done')).toBe(false); // loop returns without done
    // onState captured the working messages incl. the assistant tool-call message
    expect(captured?.at(-1)).toMatchObject({ role: 'assistant', toolCalls: [{ id: 'w1', name: 'mcp.write' }] });
  });

  it('resume approved: executes the pending call then continues to a final answer', async () => {
    const tools = execz();
    let runs = 0;
    const provider = { id: 'm', async *run() { runs++; yield { type: 'text', delta: 'done writing' } as ModelEvent; yield { type: 'done', finishReason: 'stop' } as ModelEvent; } };
    // resume baseReq: messages already end with the assistant tool-call message
    const resumeReq: ModelRequest = { model: 'm', messages: [
      { role: 'user', content: 'do the write' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'w1', name: 'mcp.write', arguments: { x: 1 } }] },
    ] };
    const events = await collect(runAgentLoop(resumeReq, { provider, ctx: { apiKey: 'k' }, tools, toolNames: ['mcp.write'], approval: { required: () => true, decision: 'approved' } }, new AbortController().signal));
    expect(tools.calls.map((c) => c.id)).toEqual(['w1']); // executed on resume
    expect(events).toContainEqual({ type: 'tool_result', result: { toolCallId: 'w1', name: 'mcp.write', content: 'did-it' } });
    expect(events).toContainEqual({ type: 'text', delta: 'done writing' });
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'stop' });
    expect(runs).toBe(1); // one model call after resolving the pending tool
  });

  it('resume denied: injects a denial result without executing, then continues', async () => {
    const tools = execz();
    const provider = { id: 'm', async *run() { yield { type: 'text', delta: 'ok, skipped' } as ModelEvent; yield { type: 'done', finishReason: 'stop' } as ModelEvent; } };
    const resumeReq: ModelRequest = { model: 'm', messages: [
      { role: 'user', content: 'do the write' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'w1', name: 'mcp.write', arguments: { x: 1 } }] },
    ] };
    const events = await collect(runAgentLoop(resumeReq, { provider, ctx: { apiKey: 'k' }, tools, toolNames: ['mcp.write'], approval: { required: () => true, decision: 'denied' } }, new AbortController().signal));
    expect(tools.calls).toHaveLength(0); // NOT executed
    const tr = events.find((e) => e.type === 'tool_result') as any;
    expect(tr.result).toMatchObject({ toolCallId: 'w1', isError: true });
    expect(tr.result.content).toMatch(/denied/i);
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'stop' });
  });

  it('read-only tools still execute inline (no gate, no suspend)', async () => {
    const tools = execz();
    let runs = 0;
    const provider = { id: 'm', async *run() { runs++; if (runs===1) { yield { type:'tool_call', call:{ id:'r1', name:'mcp.read', arguments:{} } } as ModelEvent; yield { type:'done', finishReason:'tool_use' } as ModelEvent; } else { yield { type:'text', delta:'x' } as ModelEvent; yield { type:'done', finishReason:'stop' } as ModelEvent; } } };
    // mcp.read not in toToolDefs → defByName has no entry → mutates undefined → required(...,false)=false (gateAll gates only mutates)
    const tdefs = { toToolDefs: () => [{ name:'mcp.read', description:'r', parameters:{type:'object'}, kind:'mcp', mutates:false } as ToolDef], execute: tools.execute, calls: tools.calls };
    const events = await collect(runAgentLoop(base, { provider, ctx:{apiKey:'k'}, tools: tdefs as any, toolNames:['mcp.read'], approval: gateAll }, new AbortController().signal));
    expect(tools.calls.map(c=>c.id)).toEqual(['r1']); // executed, no suspend
    expect(events.some(e=>e.type==='awaiting_approval')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type:'done', finishReason:'stop' });
  });
});
