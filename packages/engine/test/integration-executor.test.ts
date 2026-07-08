import { describe, it, expect } from 'vitest';
import { IntegrationToolExecutor, type IntegrationToolsClient } from '../src/tools/integrations.js';

const client: IntegrationToolsClient = {
  listTools: async (_orgId, _projectId) => [{ name: 'integration.github.get_file', description: '', parameters: {}, kind: 'integration', mutates: false }],
  callTool: async (orgId, projectId, name) => ({ content: `${orgId}/${projectId}:${name}` }),
};

describe('IntegrationToolExecutor', () => {
  it('lists only requested integration.* tools and executes via client', async () => {
    const ex = new IntegrationToolExecutor(client, 'org1', 'proj1');
    const defs = await ex.toToolDefs(['integration.github.get_file', 'builtin.add']);
    expect(defs.map((d) => d.name)).toEqual(['integration.github.get_file']);
    const r = await ex.execute({ id: '1', name: 'integration.github.get_file', arguments: {} }, new AbortController().signal);
    expect(r.content).toBe('org1/proj1:integration.github.get_file');
  });
});
