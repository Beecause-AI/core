import { describe, expect, it } from 'vitest';
import { runAgentLoop } from '../src/loop.js';
import type { ModelEvent, ModelRequest, ToolDef, ToolCall, ToolResult } from '../src/provider.js';
import type { ApprovalContext } from '../src/approval.js';

// A ToolExecutor that exposes one agent tool (kind:'agent') for 'agent.a1'.
const AGENT_DEF: ToolDef = { name: 'agent.a1', description: 'sub', parameters: { type: 'object' }, kind: 'agent', mutates: false };

function agentTools() {
  return {
    toToolDefs: (names: string[]) => names.includes('agent.a1') ? [AGENT_DEF] : [],
    execute: async (_call: ToolCall): Promise<ToolResult> => { throw new Error('agent execute must not be called'); },
  };
}

async function collect(it: AsyncIterable<ModelEvent>) {
  const out: ModelEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const base: ModelRequest = { model: 'm', messages: [{ role: 'user', content: 'delegate to sub-agent' }] };

describe('runAgentLoop sub-agent', () => {
  it('suspend: suspends on an agent.a1 call without executing it', async () => {
    const tools = agentTools();
    const provider = {
      id: 'm',
      async *run(): AsyncIterable<ModelEvent> {
        yield { type: 'tool_call', call: { id: 'sa1', name: 'agent.a1', arguments: { task: 'do it' } } };
        yield { type: 'done', finishReason: 'tool_use' };
      },
    };
    let capturedMessages: any[] | undefined;
    const events = await collect(
      runAgentLoop(base, {
        provider,
        ctx: { apiKey: 'k' },
        tools,
        toolNames: ['agent.a1'],
        onState: (m) => { capturedMessages = m; },
      }, new AbortController().signal),
    );

    // should yield awaiting_subagent with the agent call
    expect(events).toContainEqual({
      type: 'awaiting_subagent',
      calls: [{ id: 'sa1', name: 'agent.a1', arguments: { task: 'do it' } }],
    });

    // must NOT yield done (loop returned early)
    expect(events.some((e) => e.type === 'done')).toBe(false);

    // onState must have been called with messages ending with the assistant tool-call message
    expect(capturedMessages?.at(-1)).toMatchObject({
      role: 'assistant',
      toolCalls: [{ id: 'sa1', name: 'agent.a1' }],
    });
  });

  it('resume: injects sub-agent result as tool message then continues to done', async () => {
    const tools = agentTools();
    let runs = 0;
    const provider = {
      id: 'm',
      async *run(): AsyncIterable<ModelEvent> {
        runs++;
        // After the sub-agent result is injected, the model gives a final answer.
        yield { type: 'text', delta: 'child finished' };
        yield { type: 'done', finishReason: 'stop' };
      },
    };

    // Resume: messages already end with the assistant agent-toolCall message (as saved by onState).
    const resumeReq: ModelRequest = {
      model: 'm',
      messages: [
        { role: 'user', content: 'delegate to sub-agent' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'sa1', name: 'agent.a1', arguments: { task: 'do it' } }] },
      ],
    };

    const events = await collect(
      runAgentLoop(resumeReq, {
        provider,
        ctx: { apiKey: 'k' },
        tools,
        toolNames: ['agent.a1'],
        subagentResults: { sa1: 'the child answer' },
      }, new AbortController().signal),
    );

    // loop should inject a tool_result with the child answer
    const tr = events.find((e) => e.type === 'tool_result') as any;
    expect(tr).toBeDefined();
    expect(tr.result).toMatchObject({ toolCallId: 'sa1', name: 'agent.a1', content: 'the child answer' });

    // then yields text and done
    expect(events).toContainEqual({ type: 'text', delta: 'child finished' });
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'stop' });

    // provider was called exactly once (after injecting the sub-agent result)
    expect(runs).toBe(1);
  });

  it('mixed batch: executes non-agent calls inline before suspending, so every call gets a result', async () => {
    // The orchestrator-style turn that broke prod: one model turn emits BOTH an agent.*
    // delegation AND a non-agent builtin (e.g. memory.recall / team.submit_proposal). The
    // non-agent call MUST be resolved before we suspend for the sub-agent, otherwise the
    // resumed turn has more functionCall parts than functionResponse parts and Gemini 400s
    // with "number of function response parts is equal to the number of function call parts".
    const BUILTIN: ToolDef = { name: 'memory.recall', description: 'recall', parameters: { type: 'object' }, kind: 'builtin', mutates: false };
    const executed: ToolCall[] = [];
    const tools = {
      toToolDefs: (names: string[]) => [AGENT_DEF, BUILTIN].filter((d) => names.includes(d.name)),
      execute: async (call: ToolCall): Promise<ToolResult> => {
        if (call.name === 'agent.a1') throw new Error('agent execute must not be called');
        executed.push(call);
        return { toolCallId: call.id, name: call.name, content: 'recalled' };
      },
    };
    const provider = {
      id: 'm',
      async *run(): AsyncIterable<ModelEvent> {
        yield { type: 'tool_call', call: { id: 'sa1', name: 'agent.a1', arguments: { task: 'do it' } } };
        yield { type: 'tool_call', call: { id: 'b1', name: 'memory.recall', arguments: { q: 'x' } } };
        yield { type: 'done', finishReason: 'tool_use' };
      },
    };
    let capturedMessages: any[] | undefined;
    const events = await collect(
      runAgentLoop(base, {
        provider, ctx: { apiKey: 'k' }, tools, toolNames: ['agent.a1', 'memory.recall'],
        onState: (m) => { capturedMessages = m; },
      }, new AbortController().signal),
    );

    // the builtin call was executed inline
    expect(executed.map((c) => c.id)).toEqual(['b1']);
    // a tool_result was emitted for the builtin
    expect(events).toContainEqual({ type: 'tool_result', result: { toolCallId: 'b1', name: 'memory.recall', content: 'recalled' } });
    // suspended for ONLY the agent call
    expect(events).toContainEqual({ type: 'awaiting_subagent', calls: [{ id: 'sa1', name: 'agent.a1', arguments: { task: 'do it' } }] });

    // PARITY INVARIANT: the saved state has a tool message for every non-agent call in the
    // assistant turn (here: the one builtin call), so the resumed turn is well-formed.
    const assistantMsg = capturedMessages!.find((m) => m.role === 'assistant' && m.toolCalls?.length);
    expect(assistantMsg.toolCalls.map((c: ToolCall) => c.id)).toEqual(['sa1', 'b1']);
    const toolMsgIds = capturedMessages!.filter((m) => m.role === 'tool').map((m) => m.toolCallId);
    expect(toolMsgIds).toContain('b1');

    // RESUME from that saved state (which ends with the builtin tool message, NOT the assistant
    // turn). The agent result must still be injected, so the resumed turn is parity-complete.
    let resumeRuns = 0;
    const resumeProvider = {
      id: 'm',
      async *run(): AsyncIterable<ModelEvent> {
        resumeRuns++;
        yield { type: 'text', delta: 'all done' };
        yield { type: 'done', finishReason: 'stop' };
      },
    };
    const resumeEvents = await collect(
      runAgentLoop(
        { model: 'm', messages: capturedMessages! },
        { provider: resumeProvider, ctx: { apiKey: 'k' }, tools, toolNames: ['agent.a1', 'memory.recall'], subagentResults: { sa1: 'child answer' } },
        new AbortController().signal,
      ),
    );
    // the sub-agent result for sa1 was injected on resume
    expect(resumeEvents).toContainEqual({ type: 'tool_result', result: { toolCallId: 'sa1', name: 'agent.a1', content: 'child answer' } });
    // the builtin (b1) was NOT re-executed on resume (still one inline execution total)
    expect(executed.map((c) => c.id)).toEqual(['b1']);
    expect(resumeRuns).toBe(1);
    expect(resumeEvents.at(-1)).toMatchObject({ type: 'done', finishReason: 'stop' });
  });

  it('resume injects the delegate result even when its call id collides with an earlier tool result', async () => {
    // Reproduces the prod bug: gemini-sse restarts its call-id counter per model call, so an
    // earlier memory.recall and the later agent delegate are BOTH 'call_0'. The resume must still
    // inject the delegate's result (the earlier tool result is BEFORE the assistant batch).
    const tools = agentTools();
    const provider = { id: 'm', async *run(): AsyncIterable<ModelEvent> { yield { type: 'text', delta: 'done' }; yield { type: 'done', finishReason: 'stop' }; } };
    const resumeReq: ModelRequest = {
      model: 'm',
      messages: [
        { role: 'user', content: 'go' },
        // turn 1: an assistant tool call (memory.recall) with id 'call_0' …
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_0', name: 'memory.recall', arguments: {} }] },
        { role: 'tool', content: 'no memories', toolCallId: 'call_0', name: 'memory.recall' },
        // turn 2: the delegate, ALSO id 'call_0' (counter reset) — this is the pending batch
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_0', name: 'agent.a1', arguments: { input: 'x' } }] },
      ],
    };
    const events = await collect(runAgentLoop(resumeReq, {
      provider, ctx: { apiKey: 'k' }, tools, toolNames: ['agent.a1'],
      subagentResults: { call_0: 'the specialist answer' },
    }, new AbortController().signal));
    // the delegate result WAS injected (not skipped as "already answered")
    expect(events).toContainEqual({ type: 'tool_result', result: { toolCallId: 'call_0', name: 'agent.a1', content: 'the specialist answer' } });
    expect(events).toContainEqual({ type: 'text', delta: 'done' });
  });

  it('non-agent tools unaffected: mutating tool still gates on approval, read-tool still executes inline', async () => {
    // --- mutating tool with approval still gates ---
    const WRITE: ToolDef = { name: 'mcp.write', description: 'w', parameters: { type: 'object' }, kind: 'mcp', mutates: true };
    const writeTools = {
      toToolDefs: (names: string[]) => names.includes('mcp.write') ? [WRITE] : [],
      execute: async (call: ToolCall): Promise<ToolResult> => ({ toolCallId: call.id, name: call.name, content: 'did-it' }),
    };
    const gateAll: ApprovalContext = { required: (_n, mutates) => mutates };
    const providerWrite = {
      id: 'm',
      async *run(): AsyncIterable<ModelEvent> {
        yield { type: 'tool_call', call: { id: 'w1', name: 'mcp.write', arguments: {} } };
        yield { type: 'done', finishReason: 'tool_use' };
      },
    };
    const writeEvents = await collect(
      runAgentLoop(
        { model: 'm', messages: [{ role: 'user', content: 'write' }] },
        { provider: providerWrite, ctx: { apiKey: 'k' }, tools: writeTools, toolNames: ['mcp.write'], approval: gateAll },
        new AbortController().signal,
      ),
    );
    // approval gate fires, not sub-agent gate
    expect(writeEvents).toContainEqual({ type: 'awaiting_approval', calls: [{ id: 'w1', name: 'mcp.write', arguments: {} }] });
    expect(writeEvents.some((e) => e.type === 'awaiting_subagent')).toBe(false);
    expect(writeEvents.some((e) => e.type === 'done')).toBe(false);

    // --- read-only tool executes inline (no gate at all) ---
    const READ: ToolDef = { name: 'mcp.read', description: 'r', parameters: { type: 'object' }, kind: 'mcp', mutates: false };
    const executedCalls: ToolCall[] = [];
    const readTools = {
      toToolDefs: (names: string[]) => names.includes('mcp.read') ? [READ] : [],
      execute: async (call: ToolCall): Promise<ToolResult> => { executedCalls.push(call); return { toolCallId: call.id, name: call.name, content: 'read-result' }; },
    };
    let readRuns = 0;
    const providerRead = {
      id: 'm',
      async *run(): AsyncIterable<ModelEvent> {
        readRuns++;
        if (readRuns === 1) {
          yield { type: 'tool_call', call: { id: 'r1', name: 'mcp.read', arguments: {} } };
          yield { type: 'done', finishReason: 'tool_use' };
        } else {
          yield { type: 'text', delta: 'done' };
          yield { type: 'done', finishReason: 'stop' };
        }
      },
    };
    const readEvents = await collect(
      runAgentLoop(
        { model: 'm', messages: [{ role: 'user', content: 'read' }] },
        { provider: providerRead, ctx: { apiKey: 'k' }, tools: readTools, toolNames: ['mcp.read'], approval: gateAll },
        new AbortController().signal,
      ),
    );
    // executed inline, no suspension
    expect(executedCalls.map((c) => c.id)).toEqual(['r1']);
    expect(readEvents.some((e) => e.type === 'awaiting_approval')).toBe(false);
    expect(readEvents.some((e) => e.type === 'awaiting_subagent')).toBe(false);
    expect(readEvents.at(-1)).toMatchObject({ type: 'done', finishReason: 'stop' });
  });
});
