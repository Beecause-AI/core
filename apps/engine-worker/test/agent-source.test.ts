import { describe, expect, it, vi } from 'vitest';
import { makeAgentSource } from '../src/engine/agent-source.js';

// Mock @intellilabs/core — keep all real exports, only replace listAssistants / getOrgById / listSystemAgents
vi.mock('@intellilabs/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@intellilabs/core')>();
  return {
    ...real,
    listAssistants: vi.fn(),
    getOrgById: vi.fn(),
    listSystemAgents: vi.fn(),
  };
});

import { listAssistants, getOrgById, listSystemAgents } from '@intellilabs/core';

const mockListAssistants = listAssistants as unknown as ReturnType<typeof vi.fn>;
const mockGetOrgById = getOrgById as unknown as ReturnType<typeof vi.fn>;
const mockListSystemAgents = listSystemAgents as unknown as ReturnType<typeof vi.fn>;

const fakeDb = {} as any;
const ORG_ID = 'org-1';

// Default: org without hindsight, no system agents
function setupOrgNoHindsight() {
  mockGetOrgById.mockResolvedValue({ id: ORG_ID, hindsightEnabled: false });
  mockListSystemAgents.mockReturnValue([]);
}

function setupOrgWithHindsight() {
  mockGetOrgById.mockResolvedValue({ id: ORG_ID, hindsightEnabled: true });
  mockListSystemAgents.mockReturnValue([
    { key: 'slack', name: 'Slack Intake', persona: 'You are the Slack front door for incident reports.', model: 'gemini-3-flash-preview', tier: 'cheap', tools: [] },
  ]);
}

describe('makeAgentSource', () => {
  it('returns [] when projectId is undefined', async () => {
    const source = makeAgentSource(fakeDb, ORG_ID, undefined, undefined);
    const defs = await source.toToolDefs(['agent.a1', 'builtin.add']);
    expect(defs).toEqual([]);
    expect(mockListAssistants).not.toHaveBeenCalled();
  });

  it('lists sibling assistants and excludes self (selfAssistantId)', async () => {
    setupOrgNoHindsight();
    mockListAssistants.mockResolvedValue([
      { id: 'a1', name: 'Researcher', persona: 'finds things', model: 'm', enabledTools: [] },
      { id: 'self', name: 'Orchestrator', persona: 'I orchestrate', model: 'm', enabledTools: [] },
    ]);

    const source = makeAgentSource(fakeDb, ORG_ID, 'proj-1', 'self');
    // Request agent.a1, agent.self, and a builtin — only agent.a1 should be returned
    const defs = await source.toToolDefs(['agent.a1', 'agent.self', 'builtin.add']);

    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({ name: 'agent.a1', kind: 'agent' });
    expect(defs.find((d) => d.name === 'agent.self')).toBeUndefined();
    expect(defs.find((d) => d.name === 'builtin.add')).toBeUndefined();
  });

  it('returns [] for agent tools when all are self-excluded', async () => {
    setupOrgNoHindsight();
    mockListAssistants.mockResolvedValue([
      { id: 'self', name: 'Solo', persona: 'I am alone', model: 'm', enabledTools: [] },
    ]);

    const source = makeAgentSource(fakeDb, ORG_ID, 'proj-1', 'self');
    const defs = await source.toToolDefs(['agent.self']);
    expect(defs).toEqual([]);
  });

  it('returns [] when no agent names are requested', async () => {
    setupOrgNoHindsight();
    mockListAssistants.mockResolvedValue([
      { id: 'a1', name: 'Researcher', persona: 'finds things', model: 'm', enabledTools: [] },
    ]);

    const source = makeAgentSource(fakeDb, ORG_ID, 'proj-1', 'self');
    const defs = await source.toToolDefs(['builtin.add']);
    // AgentToolExecutor filters to only agent.* names — no agent names means empty
    expect(defs).toEqual([]);
  });

  it('uses assistant name as description fallback when persona is null/undefined', async () => {
    setupOrgNoHindsight();
    mockListAssistants.mockResolvedValue([
      { id: 'a2', name: 'Helper', persona: null, model: 'm', enabledTools: [] },
    ]);

    const source = makeAgentSource(fakeDb, ORG_ID, 'proj-1', 'self');
    const defs = await source.toToolDefs(['agent.a2']);
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({ name: 'agent.a2', description: 'Helper' });
  });

  it('execute returns isError=true with the suspend message', async () => {
    const source = makeAgentSource(fakeDb, ORG_ID, 'proj-1', 'self');
    const result = await source.execute(
      { id: 'call-1', name: 'agent.a1', arguments: { input: 'research X' } },
      new AbortController().signal,
    );
    expect(result.isError).toBe(true);
    expect(result.toolCallId).toBe('call-1');
    expect(result.name).toBe('agent.a1');
    expect(result.content).toContain('sub-agent suspend');
  });

  describe('system agent cards (delegation via hindsightEnabled)', () => {
    it('returns agent.sys.slack when hindsightEnabled=true and it is requested', async () => {
      setupOrgWithHindsight();
      mockListAssistants.mockResolvedValue([
        { id: 'a1', name: 'Researcher', persona: 'finds things', model: 'm', enabledTools: [] },
        { id: 'self', name: 'Orchestrator', persona: 'I orchestrate', model: 'm', enabledTools: [] },
      ]);

      const source = makeAgentSource(fakeDb, ORG_ID, 'proj-1', 'self');
      const defs = await source.toToolDefs(['agent.a1', 'agent.sys.slack']);

      expect(defs).toHaveLength(2);
      expect(defs.find((d) => d.name === 'agent.sys.slack')).toBeDefined();
      expect(defs.find((d) => d.name === 'agent.a1')).toBeDefined();
    });

    it('returns [] for agent.sys.slack when hindsightEnabled=false', async () => {
      setupOrgNoHindsight();
      mockListAssistants.mockResolvedValue([
        { id: 'a1', name: 'Researcher', persona: 'finds things', model: 'm', enabledTools: [] },
        { id: 'self', name: 'Orchestrator', persona: 'I orchestrate', model: 'm', enabledTools: [] },
      ]);

      const source = makeAgentSource(fakeDb, ORG_ID, 'proj-1', 'self');
      const defs = await source.toToolDefs(['agent.sys.slack']);

      expect(defs).toHaveLength(0);
      expect(defs.find((d) => d.name === 'agent.sys.slack')).toBeUndefined();
    });

    it('sibling assistant card still appears alongside system agent when hindsightEnabled=true', async () => {
      setupOrgWithHindsight();
      mockListAssistants.mockResolvedValue([
        { id: 'a1', name: 'Researcher', persona: 'finds things', model: 'm', enabledTools: [] },
        { id: 'self', name: 'Orchestrator', persona: 'I orchestrate', model: 'm', enabledTools: [] },
      ]);

      const source = makeAgentSource(fakeDb, ORG_ID, 'proj-1', 'self');
      const defs = await source.toToolDefs(['agent.a1', 'agent.sys.slack', 'agent.self']);

      // self is excluded, a1 and sys.slack remain
      expect(defs).toHaveLength(2);
      expect(defs.find((d) => d.name === 'agent.a1')).toBeDefined();
      expect(defs.find((d) => d.name === 'agent.sys.slack')).toBeDefined();
      expect(defs.find((d) => d.name === 'agent.self')).toBeUndefined();
    });
  });
});
