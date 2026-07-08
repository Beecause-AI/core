import { describe, expect, it } from 'vitest';
import { parseProjectPath, PROJECT_TABS, integrationProviderHref } from './project-path';

describe('parseProjectPath', () => {
  it('parses slug + default overview tab', () => {
    expect(parseProjectPath('/p/checkout-revamp')).toEqual({ slug: 'checkout-revamp', tab: 'overview', sub: null, rest: [] });
    expect(parseProjectPath('/p/checkout-revamp/')).toEqual({ slug: 'checkout-revamp', tab: 'overview', sub: null, rest: [] });
  });
  it('parses an explicit tab', () => {
    expect(parseProjectPath('/p/web/integrations')).toEqual({ slug: 'web', tab: 'integrations', sub: null, rest: [] });
    expect(parseProjectPath('/p/web/settings')).toEqual({ slug: 'web', tab: 'settings', sub: null, rest: [] });
  });
  it('falls back to overview for an unknown tab', () => {
    expect(parseProjectPath('/p/web/bogus')).toEqual({ slug: 'web', tab: 'overview', sub: null, rest: [] });
  });
  it('returns null slug when path has none', () => {
    expect(parseProjectPath('/p')).toEqual({ slug: null, tab: 'overview', sub: null, rest: [] });
  });
  it('exposes the tab list', () => {
    expect(PROJECT_TABS).toEqual(['overview', 'integrations', 'knowledge-graph', 'assistants', 'memory', 'skills', 'conversations', 'members', 'settings']);
  });
});

describe('parseProjectPath sub-view', () => {
  it('captures a third segment as sub', () => {
    expect(parseProjectPath('/p/web/integrations/github')).toEqual({ slug: 'web', tab: 'integrations', sub: 'github', rest: [] });
  });
  it('sub is null without a third segment', () => {
    expect(parseProjectPath('/p/web/integrations')).toEqual({ slug: 'web', tab: 'integrations', sub: null, rest: [] });
    expect(parseProjectPath('/p/web')).toEqual({ slug: 'web', tab: 'overview', sub: null, rest: [] });
  });
  it('integrationProviderHref builds the provider path', () => {
    expect(integrationProviderHref('web', 'github')).toBe('/p/web/integrations/github');
  });
  it('captures path parts after sub as rest', () => {
    expect(parseProjectPath('/p/web/integrations/cloudflare/scope/new').rest).toEqual(['scope', 'new']);
    expect(parseProjectPath('/p/web/integrations/cloudflare/scope/t1').rest).toEqual(['scope', 't1']);
  });
});
