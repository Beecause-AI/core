import { describe, expect, it } from 'vitest';
import { buildGroups } from './tool-picker';
import type { IntegrationTool, McpTool } from '../../lib/api';

const integrationTools: IntegrationTool[] = [
  { name: 'integration.github.get_file', mutates: false, description: 'Read a file.' },
];
const mcpTools: McpTool[] = [
  { name: 'mcp.server.do_thing', kind: 'mcp', mutates: false, description: 'Do a thing.' },
];

describe('buildGroups', () => {
  it('has no "Built-in" group', () => {
    const groups = buildGroups(integrationTools, mcpTools);
    expect(groups.map((g) => g.label)).not.toContain('Built-in');
  });

  it('groups memory.recall under a "Memory" group', () => {
    const groups = buildGroups(integrationTools, mcpTools);
    const memory = groups.find((g) => g.label === 'Memory');
    expect(memory).toBeDefined();
    expect(memory!.tools.map((t) => t.name)).toContain('memory.recall');
  });

  it('never exposes builtin.add', () => {
    const groups = buildGroups(integrationTools, mcpTools);
    const allNames = groups.flatMap((g) => g.tools.map((t) => t.name));
    expect(allNames).not.toContain('builtin.add');
  });

  it('groups recent.search and conversations.read under a "History" group', () => {
    const groups = buildGroups([], []);
    const hist = groups.find((g) => g.label === 'History');
    expect(hist).toBeTruthy();
    expect(hist!.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['recent.search', 'conversations.read']));
  });
});
