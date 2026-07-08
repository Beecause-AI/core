import { describe, it, expect } from 'vitest';
import { CompositeToolExecutor } from './mcp.js';
import type { ToolExecutor } from './types.js';
import type { ToolCall, ToolDef, ToolResult } from '../provider.js';

const sig = new AbortController().signal;

function makeNoop(): ToolExecutor {
  return {
    toToolDefs: async () => [],
    execute: async (call) => ({ toolCallId: call.id, name: call.name, content: '', isError: false }),
  };
}

function fakeCall(name: string): ToolCall {
  return { id: 'c1', name, arguments: {} };
}

// ── recent.* routing ──────────────────────────────────────────────────────────

const recentDef: ToolDef = { name: 'recent.search', description: 'recent', kind: 'builtin', mutates: false, parameters: { type: 'object', properties: {} } };

function makeRecentExecutor(): ToolExecutor {
  return {
    toToolDefs: (_names) => [recentDef],
    execute: async (call) => ({ toolCallId: call.id, name: call.name, content: 'recent-result', isError: false }),
  };
}

describe('CompositeToolExecutor recent.* routing', () => {
  it('routes a recent.search call to the recent executor when present', async () => {
    const composite = new CompositeToolExecutor(makeNoop(), makeNoop(), undefined, undefined, undefined, makeRecentExecutor());
    const result = await composite.execute(fakeCall('recent.search'), sig);
    expect(result.isError).toBeFalsy();
    expect(result.content).toBe('recent-result');
  });

  it('returns a no-recent-source error when no recent executor is provided', async () => {
    const composite = new CompositeToolExecutor(makeNoop(), makeNoop());
    const result = await composite.execute(fakeCall('recent.search'), sig);
    expect(result.isError).toBe(true);
    expect(result.content).toBe('no recent source');
  });

  it('excludes recent.* defs from toToolDefs when no recent executor is provided', async () => {
    const composite = new CompositeToolExecutor(makeNoop(), makeNoop());
    const defs = await composite.toToolDefs(['recent.search']);
    expect(defs.map((d) => d.name).some((n) => n.startsWith('recent.'))).toBe(false);
  });
});

// ── skill.* routing ───────────────────────────────────────────────────────────

const skillDef: ToolDef = { name: 'skill.load', description: 'skill', kind: 'builtin', mutates: false, parameters: { type: 'object', properties: {} } };

function makeSkillExecutor(): ToolExecutor {
  return {
    toToolDefs: (_names) => [skillDef],
    execute: async (call) => ({ toolCallId: call.id, name: call.name, content: 'skill-result', isError: false }),
  };
}

describe('CompositeToolExecutor skill.* routing', () => {
  it('routes a skill.load call to the skill executor when present', async () => {
    const composite = new CompositeToolExecutor(makeNoop(), makeNoop(), undefined, undefined, undefined, undefined, makeSkillExecutor());
    const result = await composite.execute(fakeCall('skill.load'), sig);
    expect(result.isError).toBeFalsy();
    expect(result.content).toBe('skill-result');
  });

  it('returns a no-skill-source error when no skill executor is provided', async () => {
    const composite = new CompositeToolExecutor(makeNoop(), makeNoop());
    const result = await composite.execute(fakeCall('skill.load'), sig);
    expect(result.isError).toBe(true);
    expect(result.content).toBe('no skill source');
  });

  it('excludes skill.* defs from toToolDefs when no skill executor is provided', async () => {
    const composite = new CompositeToolExecutor(makeNoop(), makeNoop());
    const defs = await composite.toToolDefs(['skill.load']);
    expect(defs.map((d) => d.name).some((n) => n.startsWith('skill.'))).toBe(false);
  });
});
