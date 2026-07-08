import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import { col } from '../../src/store/collections.js';
import { toDoc, applyDefaults } from '../../src/store/codec.js';
import {
  getOrgApprovalPolicy, getProjectApprovalPolicy, setProjectApprovalPolicy,
} from '../../src/repos/approval-policy.js';

const store = testStore('approval-policy');
const db = store.db;

beforeEach(() => wipe(db));
afterAll(() => store.close());

async function seedOrg(id: string, approvalPolicy: unknown = null) {
  await col(db, 'organizations').doc(id).set(toDoc(applyDefaults({ id, name: id, slug: id, approvalPolicy }, id)));
}
async function seedProject(id: string, approvalPolicy: unknown = null) {
  await col(db, 'projects').doc(id).set(toDoc(applyDefaults({ id, orgId: 'o1', name: id, slug: id, approvalPolicy }, id)));
}

describe('approval-policy repo (Firestore)', () => {
  it('getOrgApprovalPolicy returns null when unset (or org missing)', async () => {
    expect(await getOrgApprovalPolicy(db, 'missing')).toBeNull();
    await seedOrg('o1');
    expect(await getOrgApprovalPolicy(db, 'o1')).toBeNull();
  });

  it('getOrgApprovalPolicy returns a stored policy', async () => {
    const policy = { writeToolsRequireApproval: true, overrides: { 'mcp.x': false } };
    await seedOrg('o2', policy);
    expect(await getOrgApprovalPolicy(db, 'o2')).toEqual(policy);
  });

  it('getProjectApprovalPolicy returns null when unset', async () => {
    await seedProject('p1');
    expect(await getProjectApprovalPolicy(db, 'p1')).toBeNull();
  });

  it('setProjectApprovalPolicy stores and clears the policy', async () => {
    await seedProject('p2');
    const input = { writeToolsRequireApproval: true, overrides: { 'mcp.x': false } };
    await setProjectApprovalPolicy(db, 'p2', input);
    expect(await getProjectApprovalPolicy(db, 'p2')).toEqual(input);

    await setProjectApprovalPolicy(db, 'p2', null);
    expect(await getProjectApprovalPolicy(db, 'p2')).toBeNull();
  });
});
