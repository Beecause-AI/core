import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listIssues, getIssue, getLatestEvent, listSentryTargets, getSentryProjectConnection, getSentryConnection } = vi.hoisted(() => ({
  listIssues: vi.fn(async () => [{ id: '1', title: 'boom' }]),
  getIssue: vi.fn(async () => ({ id: '42', project: { slug: 'web' } })),
  getLatestEvent: vi.fn(async () => ({ eventID: 'e1' })),
  listSentryTargets: vi.fn(async () => [] as any[]),
  getSentryProjectConnection: vi.fn(async () => ({ connectionId: 'c1', orgId: 'o1' }) as any),
  getSentryConnection: vi.fn(async () => ({ id: 'c1', mode: 'auth_token', baseUrl: 'https://sentry.io', secretCiphertext: 'ct', metadata: { sentryOrgSlug: 'acme' } }) as any),
}));

vi.mock('@intellilabs/core', () => ({
  getSentryProjectConnection,
  getSentryConnection,
  listSentryTargets,
  sentryCredsForConnection: vi.fn(() => ({ mode: 'auth_token', token: 'tok' })),
  sentryAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer tok' })),
  realSentryClient: { listIssues, getIssue, getLatestEvent },
}));

import { sentryToolDefs, filterSentryToolDefs, callSentryTool } from './tools.js';

const ctx = () => ({ db: {} as any, orgId: 'o1', projectId: 'p1', config: { SECRETS_KEY: 'k' } });
const TARGET = { sentryProjectSlug: 'web', sentryProjectId: '111', name: 'Web' };

beforeEach(() => {
  vi.clearAllMocks();
  listSentryTargets.mockResolvedValue([]); // unrestricted by default
  getSentryProjectConnection.mockResolvedValue({ connectionId: 'c1', orgId: 'o1' });
  getSentryConnection.mockResolvedValue({ id: 'c1', mode: 'auth_token', baseUrl: 'https://sentry.io', secretCiphertext: 'ct', metadata: { sentryOrgSlug: 'acme' } });
  getIssue.mockResolvedValue({ id: '42', project: { slug: 'web' } });
});

describe('sentryToolDefs / filter', () => {
  it('defines the four read tools, all non-mutating', () => {
    const defs = sentryToolDefs();
    expect(defs.map((d) => d.name.replace('integration.sentry.', '')).sort()).toEqual([
      'get_issue', 'get_latest_event', 'list_issues', 'list_scope',
    ]);
    expect(defs.every((d) => d.mutates === false)).toBe(true);
  });
  it('returns nothing when there is no connection', () => {
    expect(filterSentryToolDefs(sentryToolDefs(), false)).toEqual([]);
  });
  it('returns all defs when there is a connection', () => {
    expect(filterSentryToolDefs(sentryToolDefs(), true)).toHaveLength(sentryToolDefs().length);
  });
});

describe('callSentryTool', () => {
  it('no connection ⇒ isError', async () => {
    getSentryProjectConnection.mockResolvedValueOnce(null);
    const r = await callSentryTool(ctx(), 'integration.sentry.list_scope', {});
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/no Sentry connection/);
  });

  it('list_scope shows unrestricted when no targets', async () => {
    const r = await callSentryTool(ctx(), 'integration.sentry.list_scope', {});
    expect(JSON.parse(r.content)).toEqual({ org: 'acme', unrestricted: true, projects: [] });
  });

  it('list_scope lists projects when restricted', async () => {
    listSentryTargets.mockResolvedValue([TARGET]);
    const r = await callSentryTool(ctx(), 'integration.sentry.list_scope', {});
    const parsed = JSON.parse(r.content);
    expect(parsed.unrestricted).toBe(false);
    expect(parsed.projects).toEqual([{ slug: 'web', name: 'Web' }]);
  });

  it('list_issues requires project', async () => {
    const r = await callSentryTool(ctx(), 'integration.sentry.list_issues', {});
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/project is required/);
  });

  it('list_issues allows any project when unrestricted', async () => {
    const r = await callSentryTool(ctx(), 'integration.sentry.list_issues', { project: 'anything', query: 'is:unresolved' });
    expect(r.isError).toBeUndefined();
    expect(listIssues).toHaveBeenCalledWith('https://sentry.io', { Authorization: 'Bearer tok' }, 'acme', 'anything', expect.objectContaining({ query: 'is:unresolved' }));
  });

  it('list_issues rejects a project not in scope when restricted', async () => {
    listSentryTargets.mockResolvedValue([TARGET]);
    const r = await callSentryTool(ctx(), 'integration.sentry.list_issues', { project: 'other' });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not in this project's scope/);
    expect(listIssues).not.toHaveBeenCalled();
  });

  it('list_issues allows a project in scope when restricted', async () => {
    listSentryTargets.mockResolvedValue([TARGET]);
    const r = await callSentryTool(ctx(), 'integration.sentry.list_issues', { project: 'web' });
    expect(r.isError).toBeUndefined();
    expect(listIssues).toHaveBeenCalled();
  });

  it('get_issue returns the issue when unrestricted', async () => {
    const r = await callSentryTool(ctx(), 'integration.sentry.get_issue', { issueId: '42' });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content)).toEqual({ id: '42', project: { slug: 'web' } });
  });

  it('get_issue rejects when the issue project is not in scope', async () => {
    listSentryTargets.mockResolvedValue([{ ...TARGET, sentryProjectSlug: 'web', name: 'Web' }]);
    getIssue.mockResolvedValue({ id: '99', project: { slug: 'secret' } });
    const r = await callSentryTool(ctx(), 'integration.sentry.get_issue', { issueId: '99' });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not in this project's scope/);
  });

  it('get_latest_event returns the event when unrestricted', async () => {
    const r = await callSentryTool(ctx(), 'integration.sentry.get_latest_event', { issueId: '42' });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content)).toEqual({ eventID: 'e1' });
    expect(getLatestEvent).toHaveBeenCalled();
  });

  it('get_latest_event rejects when restricted and the issue project is out of scope', async () => {
    listSentryTargets.mockResolvedValue([TARGET]);
    getIssue.mockResolvedValue({ id: '99', project: { slug: 'secret' } });
    const r = await callSentryTool(ctx(), 'integration.sentry.get_latest_event', { issueId: '99' });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not in this project's scope/);
    expect(getLatestEvent).not.toHaveBeenCalled();
  });
});
