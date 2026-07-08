import { describe, expect, it, vi } from 'vitest';
import type { QueuedTurn, Store } from '@intellilabs/core';
import { buildEngineDeps } from '../src/engine/bootstrap.js';
import { inMemoryDispatcher, CompositeToolExecutor } from '@intellilabs/engine';

// Mock listAssistants so toolsFor tests don't need a real DB
vi.mock('@intellilabs/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@intellilabs/core')>();
  return { ...real, listAssistants: vi.fn().mockResolvedValue([]) };
});

/** A no-DB Store stub: these tests never touch Firestore — they only assert on the
 *  assembled deps (registry/providers/credentials/toolsFor). */
function fakeStore(): Store {
  return {
    db: {} as any,
    vector: { async upsert() {}, async remove() {}, async findNeighbors() { return []; } },
    close: async () => {},
  };
}

describe('buildEngineDeps', () => {
  it('assembles deps with a Gemini registry entry and the google provider', () => {
    const deps = buildEngineDeps({
      store: fakeStore(),
      geminiApiKey: 'k',
      dispatcher: inMemoryDispatcher(),
      models: [{ model: 'gemini-3-flash-preview', provider: 'google', credentialSource: 'platform', cancellation: 'in-flight', capabilities: { tools: false, streaming: true } }],
    });
    expect(deps.registry.get('gemini-3-flash-preview').provider).toBe('google');
    expect(deps.providers.get('google')?.id).toBe('google');
  });

  it('buildRequest maps a turn payload through to a ModelRequest', () => {
    const deps = buildEngineDeps({
      store: fakeStore(),
      geminiApiKey: 'k',
      dispatcher: inMemoryDispatcher(),
      models: [],
    });
    expect(typeof deps.buildRequest).toBe('function');
    expect(
      deps.buildRequest({ payload: { model: 'm', messages: [{ role: 'user', content: 'hi' }] } } as any as QueuedTurn),
    ).toEqual({ model: 'm', provider: null, messages: [{ role: 'user', content: 'hi' }] });
    expect(
      deps.buildRequest({ payload: { model: 'm' } } as any as QueuedTurn),
    ).toEqual({ model: 'm', provider: null, messages: [] });
  });

  it('buildRequest forwards maxOutputTokens and temperature when present', () => {
    const deps = buildEngineDeps({ store: fakeStore(), geminiApiKey: 'k', dispatcher: inMemoryDispatcher(), models: [] });
    expect(
      deps.buildRequest({ payload: { model: 'm', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 8192, temperature: 0.2 } } as any as QueuedTurn),
    ).toEqual({ model: 'm', provider: null, messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 8192, temperature: 0.2 });
  });

  it('registers both the google and openai-compatible providers', () => {
    const deps = buildEngineDeps({
      store: fakeStore(),
      geminiApiKey: 'k',
      dispatcher: inMemoryDispatcher(),
      models: [],
    });
    expect(deps.providers.get('google')?.id).toBe('google');
    expect(deps.providers.get('openai-compatible')?.id).toBe('openai-compatible');
  });

  it('registers the google-vertex provider and resolves a vertex platform entry', async () => {
    const deps = buildEngineDeps({
      store: fakeStore(),
      geminiApiKey: undefined,
      vertex: { project: 'proj', location: 'global', getAccessToken: async () => 'ya29.tok' },
      dispatcher: inMemoryDispatcher(),
      models: [{ model: 'gemini-3-flash-preview', provider: 'google-vertex', credentialSource: 'platform', cancellation: 'in-flight', capabilities: { tools: false, streaming: true } }],
    });
    expect(deps.providers.get('google-vertex')?.id).toBe('google-vertex');
    // adding vertex must not drop the existing providers
    expect(deps.providers.get('google')?.id).toBe('google');
    expect(deps.providers.get('openai-compatible')?.id).toBe('openai-compatible');
    const entry = deps.registry.get('gemini-3-flash-preview');
    await expect(deps.credentials.resolve(entry, 'org')).resolves.toMatchObject({ apiKey: 'ya29.tok' });
  });

  it('wires the platform credential resolver', async () => {
    const deps = buildEngineDeps({
      store: fakeStore(),
      geminiApiKey: 'k',
      dispatcher: inMemoryDispatcher(),
      models: [],
    });
    await expect(
      deps.credentials.resolve(
        { model: 'm', provider: 'google', credentialSource: 'platform', cancellation: 'in-flight', capabilities: { tools: false, streaming: true } },
        'org',
      ),
    ).resolves.toEqual({ apiKey: 'k' });
  });

  it('toolsFor always returns a CompositeToolExecutor (even with no MCP gateway)', () => {
    const deps = buildEngineDeps({
      store: fakeStore(),
      geminiApiKey: 'k',
      dispatcher: inMemoryDispatcher(),
      models: [],
    });
    const turn = { payload: { model: 'm', messages: [], enabledTools: [] }, orgId: 'org-1' } as any as QueuedTurn;
    const executor = deps.agentLoop!.toolsFor!(turn);
    expect(executor).toBeInstanceOf(CompositeToolExecutor);
  });

  it('toolsFor(turn with no projectId) builtins path still resolves builtin.add', async () => {
    const deps = buildEngineDeps({
      store: fakeStore(),
      geminiApiKey: 'k',
      dispatcher: inMemoryDispatcher(),
      models: [],
    });
    const turn = { payload: { model: 'm', messages: [], enabledTools: ['builtin.add'] }, orgId: 'org-1' } as any as QueuedTurn;
    const executor = deps.agentLoop!.toolsFor!(turn);
    const defs = await executor.toToolDefs(['builtin.add']);
    expect(defs).toHaveLength(1);
    expect(defs[0]!.name).toBe('builtin.add');
  });

  it('advertises team.submit_proposal only when proposalId is present (never advertised-but-unexecutable)', () => {
    const deps = buildEngineDeps({ store: fakeStore(), geminiApiKey: 'k', dispatcher: inMemoryDispatcher(), models: [] });
    const withP = { payload: { model: 'm', messages: [], enabledTools: ['memory.recall', 'team.submit_proposal'], proposalId: 'P1' }, orgId: 'o' } as any as QueuedTurn;
    expect(deps.agentLoop!.toolNamesFor!(withP)).toContain('team.submit_proposal');
    const noP = { payload: { model: 'm', messages: [], enabledTools: ['memory.recall', 'team.submit_proposal'] }, orgId: 'o' } as any as QueuedTurn;
    expect(deps.agentLoop!.toolNamesFor!(noP)).not.toContain('team.submit_proposal');
    expect(deps.agentLoop!.toolNamesFor!(noP)).toContain('memory.recall');
  });
});
