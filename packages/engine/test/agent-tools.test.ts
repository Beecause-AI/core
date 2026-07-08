import { describe, expect, it } from 'vitest';
import { AgentToolExecutor, type AgentCard } from '../src/tools/agents.js';
import { CompositeToolExecutor } from '../src/tools/mcp.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { addTool } from '../src/tools/builtins/add.js';

const cards: AgentCard[] = [
  { id: 'a1', name: 'Researcher', description: 'finds things' },
  { id: 'a2', name: 'Writer', description: '' },
];

describe('AgentToolExecutor', () => {
  it('lists only requested agent.<id> defs with kind agent + input param', async () => {
    const ex = new AgentToolExecutor(cards);
    const defs = await ex.toToolDefs(['agent.a1', 'builtin.add']);
    expect(defs).toHaveLength(1);
    const def = defs[0]!;
    expect(def).toMatchObject({ name: 'agent.a1', kind: 'agent', mutates: false, description: 'finds things' });
    expect(def.parameters).toMatchObject({ type: 'object', properties: { input: { type: 'string' } }, required: ['input'] });
  });
  it('falls back to name when description empty', async () => {
    const ex = new AgentToolExecutor(cards);
    const defs = await ex.toToolDefs(['agent.a2']);
    expect(defs[0]!.description).toBe('Writer');
  });
  it('execute returns isError (agent calls must suspend, not run inline)', async () => {
    const ex = new AgentToolExecutor(cards);
    const r = await ex.execute({ id: 'c', name: 'agent.a1', arguments: { input: 'x' } }, new AbortController().signal);
    expect(r.isError).toBe(true);
  });
});

describe('CompositeToolExecutor with agent source', () => {
  const reg = new ToolRegistry([addTool]);
  it('merges builtin + agent defs and routes agent.* / unknown', async () => {
    const agents = new AgentToolExecutor(cards);
    const comp = new CompositeToolExecutor(reg, /* mcp */ { toToolDefs: () => [], execute: async (c) => ({ toolCallId: c.id, name: c.name, content: '', isError: true }) }, agents);
    const defs = await comp.toToolDefs(['builtin.add', 'agent.a1']);
    expect(defs.map((d) => d.name).sort()).toEqual(['agent.a1', 'builtin.add']);
    const r = await comp.execute({ id: 'x', name: 'agent.a1', arguments: {} }, new AbortController().signal);
    expect(r.isError).toBe(true); // agent execute is defensive isError
  });
});
