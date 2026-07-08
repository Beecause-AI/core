import { describe, it, expect } from 'vitest';
import { validateGraphqlScope, validateGraphqlScopes, type CfAllowed } from './validate.js';

const ZONE = { kind: 'zone' as const, zoneTag: 'zone-aaa' };
const ACCT = { kind: 'account' as const, accountTag: 'acct-xyz' };

const zoneQuery = (tag: string) => `{ viewer { zones(filter: { zoneTag: "${tag}" }) { httpRequestsAdaptiveGroups(limit: 1) { count } } } }`;
const acctQuery = (tag: string) => `{ viewer { accounts(filter: { accountTag: "${tag}" }) { workersInvocationsAdaptiveGroups(limit: 1) { sum { requests } } } } }`;

describe('validateGraphqlScope — zone target', () => {
  it('accepts a query scoped to the bound zoneTag', () => {
    expect(validateGraphqlScope(zoneQuery('zone-aaa'), ZONE)).toEqual({ ok: true });
  });
  it('rejects a query scoped to a different zoneTag', () => {
    const r = validateGraphqlScope(zoneQuery('zone-bbb'), ZONE);
    expect(r.ok).toBe(false);
  });
  it('rejects a query with no scope filter', () => {
    const r = validateGraphqlScope('{ viewer { zones { httpRequestsAdaptiveGroups(limit:1){count} } } }', ZONE);
    expect(r.ok).toBe(false);
  });
  it('rejects an accounts block under a zone target', () => {
    const r = validateGraphqlScope(acctQuery('acct-xyz'), ZONE);
    expect(r.ok).toBe(false);
  });
  it('rejects malformed GraphQL', () => {
    const r = validateGraphqlScope('{ viewer { zones(', ZONE);
    expect(r.ok).toBe(false);
  });
  it('resolves the zoneTag from a variable', () => {
    const q = 'query($z:string){ viewer { zones(filter:{zoneTag:$z}){ httpRequestsAdaptiveGroups(limit:1){count} } } }';
    expect(validateGraphqlScope(q, ZONE, { z: 'zone-aaa' })).toEqual({ ok: true });
    expect(validateGraphqlScope(q, ZONE, { z: 'zone-bbb' }).ok).toBe(false);
  });
  it('rejects a variable-scoped tag that cannot be resolved', () => {
    const q = 'query($z:string){ viewer { zones(filter:{zoneTag:$z}){ httpRequestsAdaptiveGroups(limit:1){count} } } }';
    expect(validateGraphqlScope(q, ZONE, {}).ok).toBe(false);
  });
});

describe('validateGraphqlScope — account target', () => {
  it('accepts a query scoped to the bound accountTag', () => {
    expect(validateGraphqlScope(acctQuery('acct-xyz'), ACCT)).toEqual({ ok: true });
  });
  it('rejects a different accountTag', () => {
    expect(validateGraphqlScope(acctQuery('acct-other'), ACCT).ok).toBe(false);
  });
  it('rejects a top-level zones block under an account target', () => {
    expect(validateGraphqlScope(zoneQuery('zone-aaa'), ACCT).ok).toBe(false);
  });
  it('allows a zoneTag used as a dataset filter dimension inside accounts', () => {
    const q = `{ viewer { accounts(filter: { accountTag: "acct-xyz" }) {
      httpRequestsAdaptiveGroups(filter: { zoneTag: "any-zone" }, limit: 1) { count } } } }`;
    expect(validateGraphqlScope(q, ACCT)).toEqual({ ok: true });
  });
});

describe('validateGraphqlScope — fragments', () => {
  it('rejects an out-of-scope accounts selector hidden in an inline fragment', () => {
    const q = `{ viewer { zones(filter:{zoneTag:"zone-aaa"}){httpRequestsAdaptiveGroups(limit:1){count}} ... on Viewer { accounts(filter:{accountTag:"acct-evil"}){ workersInvocationsAdaptiveGroups(limit:1){sum{requests}} } } } }`;
    const r = validateGraphqlScope(q, ZONE);
    expect(r.ok).toBe(false);
  });
  it('rejects an out-of-scope zones selector hidden in a named fragment', () => {
    const q = `{ viewer { zones(filter:{zoneTag:"zone-aaa"}){httpRequestsAdaptiveGroups(limit:1){count}} ...EvilFrag } } fragment EvilFrag on Viewer { zones(filter:{zoneTag:"zone-evil"}){httpRequestsAdaptiveGroups(limit:1){count}} }`;
    const r = validateGraphqlScope(q, ZONE);
    expect(r.ok).toBe(false);
  });
  it('rejects an unknown fragment spread', () => {
    const q = `{ viewer { zones(filter:{zoneTag:"zone-aaa"}){httpRequestsAdaptiveGroups(limit:1){count}} ...Missing } }`;
    const r = validateGraphqlScope(q, ZONE);
    expect(r.ok).toBe(false);
  });
  it('accepts the required scope selector placed inside an inline fragment', () => {
    const q = `{ viewer { ... on Viewer { zones(filter:{zoneTag:"zone-aaa"}){httpRequestsAdaptiveGroups(limit:1){count}} } } }`;
    expect(validateGraphqlScope(q, ZONE)).toEqual({ ok: true });
  });
  it('accepts a benign named fragment for the selected fields under a scoped zone', () => {
    const q = `{ viewer { zones(filter:{zoneTag:"zone-aaa"}){ ...Cols } } } fragment Cols on Zone { httpRequestsAdaptiveGroups(limit:1){count} }`;
    expect(validateGraphqlScope(q, ZONE)).toEqual({ ok: true });
  });
});

const restricted = (zones: string[], accounts: string[]): CfAllowed => ({
  zones: new Set(zones), accounts: new Set(accounts), unrestricted: false,
});
const UNRESTRICTED: CfAllowed = { zones: new Set(), accounts: new Set(), unrestricted: false };
UNRESTRICTED.unrestricted = true;

describe('validateGraphqlScopes — restricted', () => {
  it('allows a zoneTag in the allowed set', () => {
    expect(validateGraphqlScopes(zoneQuery('zone-aaa'), restricted(['zone-aaa'], []))).toEqual({ ok: true });
  });
  it('rejects a zoneTag not in the allowed set', () => {
    expect(validateGraphqlScopes(zoneQuery('zone-bbb'), restricted(['zone-aaa'], [])).ok).toBe(false);
  });
  it('allows an accountTag in the allowed set', () => {
    expect(validateGraphqlScopes(acctQuery('acct-xyz'), restricted([], ['acct-xyz']))).toEqual({ ok: true });
  });
  it('rejects an accountTag not in the allowed set', () => {
    expect(validateGraphqlScopes(acctQuery('acct-other'), restricted([], ['acct-xyz'])).ok).toBe(false);
  });
  it('rejects a query with no scope selector', () => {
    const q = '{ viewer { zones { httpRequestsAdaptiveGroups(limit:1){count} } } }';
    expect(validateGraphqlScopes(q, restricted(['zone-aaa'], [])).ok).toBe(false);
  });
  it('rejects a tag hidden in a named fragment when out of scope', () => {
    const q = `{ viewer { zones(filter:{zoneTag:"zone-aaa"}){httpRequestsAdaptiveGroups(limit:1){count}} ...Evil } } fragment Evil on Viewer { accounts(filter:{accountTag:"acct-evil"}){workersInvocationsAdaptiveGroups(limit:1){sum{requests}}} }`;
    expect(validateGraphqlScopes(q, restricted(['zone-aaa'], [])).ok).toBe(false);
  });
});

describe('validateGraphqlScopes — unrestricted', () => {
  it('allows any zoneTag', () => {
    expect(validateGraphqlScopes(zoneQuery('any-zone'), UNRESTRICTED)).toEqual({ ok: true });
  });
  it('allows any accountTag', () => {
    expect(validateGraphqlScopes(acctQuery('any-acct'), UNRESTRICTED)).toEqual({ ok: true });
  });
  it('still rejects a query with no resolvable scope selector', () => {
    const q = '{ viewer { zones { httpRequestsAdaptiveGroups(limit:1){count} } } }';
    expect(validateGraphqlScopes(q, UNRESTRICTED).ok).toBe(false);
  });
  it('rejects malformed GraphQL', () => {
    expect(validateGraphqlScopes('{ viewer { zones(', UNRESTRICTED).ok).toBe(false);
  });
});
