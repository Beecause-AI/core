import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from './store/emulator.js';
import {
  addAwsConnection, getAwsConnection, listAwsOrgConnections,
  addAwsTarget, listAwsTargets, awsTargetExists, removeAwsTarget,
} from '../src/index.js';

const store = testStore('aws-repos');
const db = store.db;

beforeEach(async () => { await wipe(db); });
afterAll(() => store.close());

describe('aws connections', () => {
  it('adds and lists an org connection', async () => {
    const c = await addAwsConnection(db, {
      orgId: 'o1', projectId: null, name: 'prod', mode: 'access_key',
      defaultRegion: 'us-east-1', secretCiphertext: 'enc', secretHint: '…1234',
    });
    expect(c.awsAccountId).toBeNull();
    const list = await listAwsOrgConnections(db, 'o1');
    expect(list.map((x) => x.id)).toEqual([c.id]);
    expect(await getAwsConnection(db, 'o1', c.id)).not.toBeNull();
    expect(await getAwsConnection(db, 'other-org', c.id)).toBeNull();
  });
});

describe('aws targets', () => {
  it('targets are unique per (account, region) within a project', async () => {
    const t = await addAwsTarget(db, {
      projectId: 'p1', connectionId: 'c1', awsAccountId: '111122223333',
      awsRegion: 'us-east-1', label: 'prod', addedByUserId: 'u1',
    });
    expect(await awsTargetExists(db, 'p1', '111122223333', 'us-east-1')).toBe(true);
    expect(await awsTargetExists(db, 'p1', '111122223333', 'eu-west-1')).toBe(false);
    expect((await listAwsTargets(db, 'p1')).map((x) => x.id)).toEqual([t.id]);
    expect(await removeAwsTarget(db, 'p1', t.id)).toBe(true);
    expect(await listAwsTargets(db, 'p1')).toEqual([]);
  });
});
