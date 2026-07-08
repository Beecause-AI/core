import { describe, it, expect } from 'vitest';
import { renderCloudflareSkill, renderSentrySkill } from './skill.js';

describe('renderCloudflareSkill', () => {
  it('scopes guidance to enabled tools and lists restricted resources', () => {
    const block = renderCloudflareSkill(
      ['integration.cloudflare.list_scope', 'integration.cloudflare.query_graphql'],
      { account: 'a1', unrestricted: false, resources: [{ kind: 'zone', name: 'beecause.ai' }] },
    );
    expect(block).toMatch(/Cloudflare observability tools/);
    expect(block).toMatch(/viewer\.zones/);
    expect(block).toMatch(/beecause\.ai \(zone\)/);
  });
  it('renders an unrestricted scope line', () => {
    const block = renderCloudflareSkill(
      ['integration.cloudflare.list_scope'],
      { account: 'a1', unrestricted: true, resources: [] },
    );
    expect(block).toMatch(/any zone\/account on account a1/);
  });
  it('returns empty when no tools are enabled', () => {
    expect(renderCloudflareSkill([], { account: null, unrestricted: true, resources: [] })).toBe('');
  });
});

describe('renderSentrySkill', () => {
  it('scopes guidance to enabled tools and lists restricted projects', () => {
    const block = renderSentrySkill(
      ['integration.sentry.list_scope', 'integration.sentry.list_issues', 'integration.sentry.get_latest_event'],
      { org: 'acme', unrestricted: false, projects: [{ slug: 'web', name: 'Web' }] },
    );
    expect(block).toMatch(/Sentry tools/);
    expect(block).toMatch(/get_latest_event` is the key RCA tool/);
    expect(block).toMatch(/Web \(web\)/);
  });
  it('renders an unrestricted scope line with the org', () => {
    const block = renderSentrySkill(
      ['integration.sentry.list_scope'],
      { org: 'acme', unrestricted: true, projects: [] },
    );
    expect(block).toMatch(/any project in the acme Sentry organization/);
  });
  it('returns empty when no tools are enabled', () => {
    expect(renderSentrySkill([], { org: null, unrestricted: true, projects: [] })).toBe('');
  });
});
