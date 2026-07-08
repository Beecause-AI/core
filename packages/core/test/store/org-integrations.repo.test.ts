import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from './emulator.js';
import {
  upsertIntegration, getIntegration, getIntegrationByInstallationId, getIntegrationByTeamId,
  setIntegrationTested, setIntegrationEvents, deleteIntegration, createInstallState,
  consumeInstallState, insertIntegrationEvent, disableIntegrationByInstallationId, toPublicIntegration,
} from '../../src/repos/org-integrations.js';
import type { OrgIntegration } from '../../src/store/types.js';

const store = testStore('org-integrations');
const db = store.db;
const orgId = 'org-acme';

beforeEach(() => wipe(db));
afterAll(() => store.close());

describe('org-integrations repo (Firestore)', () => {
  it('upserts then reads back; metadata round-trips; id is stable across upserts', async () => {
    await upsertIntegration(db, {
      orgId, provider: 'github', mode: 'pat', accountLabel: 'acme-corp',
      secretCiphertext: 'ct', secretHint: '…abcd', baseUrl: null,
      metadata: { events: { issues: true, pullRequests: true, branches: false } },
      connectedByUserId: 'u1', lastTestOk: true,
    });
    const row = await getIntegration(db, orgId, 'github');
    expect(row).toMatchObject({ provider: 'github', mode: 'pat', accountLabel: 'acme-corp', secretHint: '…abcd' });
    expect((row!.metadata as any).events.branches).toBe(false);
    const firstId = row!.id;

    await upsertIntegration(db, {
      orgId, provider: 'github', mode: 'agent_app', accountLabel: 'acme-corp',
      secretCiphertext: null, secretHint: null, baseUrl: null,
      metadata: { installationId: '555', events: { issues: true, pullRequests: true, branches: true } },
      connectedByUserId: 'u1',
    });
    const after = await getIntegration(db, orgId, 'github');
    expect(after!.id).toBe(firstId); // FK-stable id preserved on re-upsert
    expect(after!.mode).toBe('agent_app');
  });

  it('toPublicIntegration omits the ciphertext', async () => {
    await upsertIntegration(db, {
      orgId, provider: 'github', mode: 'pat', accountLabel: 'acme',
      secretCiphertext: 'ct', secretHint: '…abcd', baseUrl: null, metadata: {}, connectedByUserId: 'u1',
    });
    const pub = toPublicIntegration((await getIntegration(db, orgId, 'github'))!);
    expect((pub as any).secretCiphertext).toBeUndefined();
    expect(pub.secretHint).toBe('…abcd');
  });

  it('resolves by installationId and teamId', async () => {
    await upsertIntegration(db, {
      orgId, provider: 'github', mode: 'agent_app', accountLabel: null, secretCiphertext: null,
      secretHint: null, baseUrl: null, metadata: { installationId: '999' }, connectedByUserId: 'u1',
    });
    const byInst = await getIntegrationByInstallationId(db, 'github', '999');
    expect(byInst?.orgId).toBe(orgId);

    await upsertIntegration(db, {
      orgId, provider: 'slack', mode: 'custom_app', accountLabel: null, secretCiphertext: null,
      secretHint: null, baseUrl: null, metadata: { teamId: 'T123' }, connectedByUserId: 'u1',
    });
    expect((await getIntegrationByTeamId(db, 'T123'))?.provider).toBe('slack');
  });

  it('setIntegrationEvents merges toggles; setIntegrationTested stamps result', async () => {
    await upsertIntegration(db, {
      orgId, provider: 'github', mode: 'pat', accountLabel: null, secretCiphertext: null,
      secretHint: null, baseUrl: null, metadata: { events: { issues: true, pullRequests: true, branches: true } }, connectedByUserId: 'u1',
    });
    expect(await setIntegrationEvents(db, orgId, 'github', { branches: false })).toBe(true);
    const r1 = await getIntegration(db, orgId, 'github');
    expect((r1!.metadata as any).events).toMatchObject({ issues: true, pullRequests: true, branches: false });
    expect(await setIntegrationTested(db, orgId, 'github', false)).toBe(true);
    expect((await getIntegration(db, orgId, 'github'))!.lastTestOk).toBe(false);
    expect(await setIntegrationEvents(db, orgId, 'nope', {})).toBe(false);
    expect(await setIntegrationTested(db, orgId, 'nope', true)).toBe(false);
  });

  it('disableIntegrationByInstallationId flips enabled off', async () => {
    await upsertIntegration(db, {
      orgId, provider: 'github', mode: 'agent_app', accountLabel: null, secretCiphertext: null,
      secretHint: null, baseUrl: null, metadata: { installationId: 'inst-1' }, connectedByUserId: 'u1',
    });
    expect(await disableIntegrationByInstallationId(db, 'github', 'inst-1')).toBe(true);
    expect((await getIntegration(db, orgId, 'github'))!.enabled).toBe(false);
    expect(await disableIntegrationByInstallationId(db, 'github', 'missing')).toBe(false);
  });

  it('install state is single-use and rejects expired/replayed nonces', async () => {
    await createInstallState(db, { nonce: 'n1', orgId, provider: 'github', userId: 'u1', expiresAt: new Date(Date.now() + 60_000) });
    expect(await consumeInstallState(db, 'n1')).toMatchObject({ orgId, userId: 'u1' });
    expect(await consumeInstallState(db, 'n1')).toBeNull(); // replay
    await createInstallState(db, { nonce: 'n2', orgId, provider: 'github', userId: 'u1', expiresAt: new Date(Date.now() - 1000) });
    expect(await consumeInstallState(db, 'n2')).toBeNull(); // expired
    expect(await consumeInstallState(db, 'missing')).toBeNull();
  });

  it('insertIntegrationEvent is idempotent on deliveryId', async () => {
    const ev = {
      orgId, provider: 'github', category: 'issues', eventType: 'issues', action: 'opened',
      deliveryId: 'd1', repoFullName: 'a/b', actorLogin: 'me', mentionsBot: false, payload: { x: 1 },
    };
    expect(await insertIntegrationEvent(db, ev)).toBe(true);
    expect(await insertIntegrationEvent(db, ev)).toBe(false); // redelivery
  });

  it('delete removes the row', async () => {
    await upsertIntegration(db, {
      orgId, provider: 'github', mode: 'pat', accountLabel: null, secretCiphertext: null,
      secretHint: null, baseUrl: null, metadata: {}, connectedByUserId: 'u1',
    });
    expect(await deleteIntegration(db, orgId, 'github')).toBe(true);
    expect(await getIntegration(db, orgId, 'github')).toBeNull();
    expect(await deleteIntegration(db, orgId, 'github')).toBe(false);
  });
});

describe('toPublicIntegration — Slack secrets (pure)', () => {
  it('strips metadata.signingSecretCiphertext', () => {
    const row = {
      id: 'i1', orgId: 'o1', provider: 'slack', mode: 'custom_app', baseUrl: null, accountLabel: 'Acme HQ',
      secretCiphertext: 'cipher', secretHint: '…abcd',
      metadata: { teamId: 'T1', teamName: 'Acme HQ', botUserId: 'U1', signingSecretCiphertext: 'SECRET' },
      enabled: true, lastTestedAt: null, lastTestOk: true, connectedByUserId: 'u-owner', createdAt: new Date(), updatedAt: new Date(),
    } as unknown as OrgIntegration;
    const pub = toPublicIntegration(row);
    expect((pub as { secretCiphertext?: string }).secretCiphertext).toBeUndefined();
    expect((pub.metadata as Record<string, unknown>).signingSecretCiphertext).toBeUndefined();
    expect((pub.metadata as Record<string, unknown>).teamId).toBe('T1');
  });
});
