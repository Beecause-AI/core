import { randomUUID } from 'node:crypto';
import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import type { OrgIntegration, GitlabEvents } from '../store/types.js';
import { AlreadyExistsError } from '../ports/store.js';

export type IntegrationEvents = { issues: boolean; pullRequests: boolean; branches: boolean };
export type IntegrationMetadata = {
  // GitHub
  installationId?: string; appId?: string; webhookSecretCiphertext?: string; events?: IntegrationEvents;
  issuesEnabled?: boolean;    // org master switch for GitHub issue creation from RCAs
  copilotEnabled?: boolean;   // org master switch for Copilot hand-off (requires issuesEnabled)
  // Slack
  teamId?: string; teamName?: string; botUserId?: string; signingSecretCiphertext?: string;
  // GitLab
  webhookTokenHash?: string;        // sha256 of the per-connection webhook secret (routing key)
  gitlabEvents?: GitlabEvents;      // push/issues/mergeRequests capture toggles
  // Teams
  tenantId?: string; tenantName?: string | null; serviceUrl?: string; botId?: string;
};
export type OrgIntegrationPublic = Omit<OrgIntegration, 'secretCiphertext'>;

export function toPublicIntegration(row: OrgIntegration): OrgIntegrationPublic {
  const { secretCiphertext, ...pub } = row;
  // Never ship any encrypted secret blob to clients — strip ciphertext fields living inside metadata.
  const meta = (pub.metadata as IntegrationMetadata) ?? {};
  if (meta.webhookSecretCiphertext !== undefined || meta.signingSecretCiphertext !== undefined) {
    const { webhookSecretCiphertext, signingSecretCiphertext, ...safeMeta } = meta;
    return { ...pub, metadata: safeMeta };
  }
  return pub;
}

export type UpsertIntegrationInput = {
  orgId: string; provider: string; mode: string;
  baseUrl?: string | null; accountLabel?: string | null;
  secretCiphertext?: string | null; secretHint?: string | null;
  metadata: IntegrationMetadata; connectedByUserId?: string | null; lastTestOk?: boolean;
};

/** Deterministic doc id for the single connection per (org, provider) — the SQL unique key.
 *  A generated `id` uuid lives inside the doc so downstream FKs (orgIntegrationId) stay stable
 *  across upserts. */
function integrationDocId(orgId: string, provider: string): string {
  return `${orgId}_${provider}`;
}

/** Upsert the single connection for (org, provider). Replaces mode/secret/metadata wholesale. */
export async function upsertIntegration(db: Db, input: UpsertIntegrationInput): Promise<void> {
  const ref = col(db, 'org_integrations').doc(integrationDocId(input.orgId, input.provider));
  const existing = await ref.get();
  const id = (existing.exists ? (existing.data()?.id as string) : undefined) ?? randomUUID();
  const values = {
    id,
    orgId: input.orgId, provider: input.provider, mode: input.mode,
    baseUrl: input.baseUrl ?? null, accountLabel: input.accountLabel ?? null,
    secretCiphertext: input.secretCiphertext ?? null, secretHint: input.secretHint ?? null,
    metadata: input.metadata, connectedByUserId: input.connectedByUserId ?? null,
    enabled: existing.exists ? (existing.data()?.enabled as boolean) : true,
    lastTestedAt: input.lastTestOk === undefined ? null : FieldValue.serverTimestamp(),
    lastTestOk: input.lastTestOk ?? null,
    updatedAt: FieldValue.serverTimestamp(),
  };
  // First write also stamps createdAt; merge-set replaces the conflicting fields on re-upsert.
  await ref.set(toDoc(existing.exists ? values : applyDefaults(values, id)), { merge: true });
}

export async function getIntegration(db: Db, orgId: string, provider: string): Promise<OrgIntegration | null> {
  const snap = await col(db, 'org_integrations').doc(integrationDocId(orgId, provider)).get();
  return snap.exists ? fromDoc<OrgIntegration>(snap) : null;
}

/** Resolve a connection from a webhook/callback installation id (metadata.installationId). */
export async function getIntegrationByInstallationId(db: Db, provider: string, installationId: string): Promise<OrgIntegration | null> {
  const snaps = await col(db, 'org_integrations')
    .where('provider', '==', provider)
    .where('metadata.installationId', '==', installationId)
    .limit(1)
    .get();
  return snaps[0] ? fromDoc<OrgIntegration>(snaps[0]) : null;
}

/** Resolve a connection from an inbound webhook's hashed token (metadata.webhookTokenHash). */
export async function getIntegrationByWebhookTokenHash(db: Db, provider: string, hash: string): Promise<OrgIntegration | null> {
  const snaps = await col(db, 'org_integrations')
    .where('provider', '==', provider)
    .where('metadata.webhookTokenHash', '==', hash)
    .limit(1)
    .get();
  return snaps[0] ? fromDoc<OrgIntegration>(snaps[0]) : null;
}

/** Resolve a Teams connection from its tenant_id (metadata.tenantId). */
export async function getIntegrationByTenantId(db: Db, tenantId: string): Promise<OrgIntegration | null> {
  const snaps = await col(db, 'org_integrations')
    .where('provider', '==', 'teams')
    .where('metadata.tenantId', '==', tenantId)
    .limit(1).get();
  return snaps[0] ? fromDoc<OrgIntegration>(snaps[0]) : null;
}

/** Create-or-update the single teams integration for an org (one per (orgId,'teams')).
 *  No secret: outbound auth uses global platform creds. Refreshes serviceUrl (it can rotate). */
export async function upsertTeamsIntegration(db: Db, input: {
  orgId: string; tenantId: string; tenantName?: string | null; serviceUrl: string; botId: string; connectedByUserId: string | null;
}): Promise<OrgIntegration> {
  await upsertIntegration(db, {
    orgId: input.orgId, provider: 'teams', mode: 'central', accountLabel: input.tenantName ?? input.tenantId, baseUrl: null,
    secretCiphertext: null, secretHint: null,
    metadata: { tenantId: input.tenantId, tenantName: input.tenantName ?? null, serviceUrl: input.serviceUrl, botId: input.botId },
    connectedByUserId: input.connectedByUserId, lastTestOk: true,
  });
  return (await getIntegration(db, input.orgId, 'teams'))!;
}

/** Resolve a Slack connection from its team_id (metadata.teamId). */
export async function getIntegrationByTeamId(db: Db, teamId: string): Promise<OrgIntegration | null> {
  const snaps = await col(db, 'org_integrations')
    .where('provider', '==', 'slack')
    .where('metadata.teamId', '==', teamId)
    .limit(1)
    .get();
  return snaps[0] ? fromDoc<OrgIntegration>(snaps[0]) : null;
}

export async function setIntegrationTested(db: Db, orgId: string, provider: string, ok: boolean): Promise<boolean> {
  const ref = col(db, 'org_integrations').doc(integrationDocId(orgId, provider));
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.update(toDoc({ lastTestedAt: FieldValue.serverTimestamp(), lastTestOk: ok, updatedAt: FieldValue.serverTimestamp() }));
  return true;
}

/** Merge a partial event-toggle set into metadata.events. */
export async function setIntegrationEvents(db: Db, orgId: string, provider: string, partial: Partial<IntegrationEvents>): Promise<boolean> {
  const current = await getIntegration(db, orgId, provider);
  if (!current) return false;
  const meta = (current.metadata as IntegrationMetadata) ?? {};
  const events: IntegrationEvents = { issues: true, pullRequests: true, branches: true, ...(meta.events ?? {}), ...partial };
  await col(db, 'org_integrations').doc(integrationDocId(orgId, provider))
    .update(toDoc({ metadata: { ...meta, events }, updatedAt: FieldValue.serverTimestamp() }));
  return true;
}

/** Merge a partial gitlab event-toggle set into metadata.gitlabEvents. */
export async function setGitlabIntegrationEvents(db: Db, orgId: string, partial: Partial<GitlabEvents>): Promise<boolean> {
  const current = await getIntegration(db, orgId, 'gitlab');
  if (!current) return false;
  const meta = (current.metadata as IntegrationMetadata) ?? {};
  const gitlabEvents: GitlabEvents = { push: true, issues: true, mergeRequests: true, ...(meta.gitlabEvents ?? {}), ...partial };
  await col(db, 'org_integrations').doc(`${orgId}_gitlab`)
    .update(toDoc({ metadata: { ...meta, gitlabEvents }, updatedAt: FieldValue.serverTimestamp() }));
  return true;
}

/** Flip the org-level GitHub issue-creation master switch, stored on the integration metadata.
 *  Returns false if the org has no integration row for this provider. */
export async function setIntegrationIssuesEnabled(
  db: Db,
  orgId: string,
  provider: string,
  enabled: boolean,
): Promise<boolean> {
  const current = await getIntegration(db, orgId, provider);
  if (!current) return false;
  const meta = (current.metadata as IntegrationMetadata) ?? {};
  await col(db, 'org_integrations').doc(integrationDocId(orgId, provider)).update(
    toDoc({ metadata: { ...meta, issuesEnabled: enabled }, updatedAt: FieldValue.serverTimestamp() }),
  );
  return true;
}

export async function deleteIntegration(db: Db, orgId: string, provider: string): Promise<boolean> {
  const ref = col(db, 'org_integrations').doc(integrationDocId(orgId, provider));
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}

export async function createInstallState(
  db: Db, input: { nonce: string; orgId: string; provider: string; userId: string; expiresAt: Date },
): Promise<void> {
  // nonce is the natural PK → doc id.
  await col(db, 'integration_install_states').doc(input.nonce)
    .set(toDoc(applyDefaults({ ...input, consumedAt: null }, input.nonce)));
}

/** Atomically consume a nonce: succeeds once, only if unexpired and not yet consumed. */
export async function consumeInstallState(db: Db, nonce: string): Promise<{ orgId: string; provider: string; userId: string } | null> {
  const ref = col(db, 'integration_install_states').doc(nonce);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data()!;
    if ((data.consumedAt as unknown) != null) return null;
    const expires = data.expiresAt as Date | undefined;
    if (!expires || expires.getTime() <= Date.now()) return null;
    tx.update(ref, toDoc({ consumedAt: FieldValue.serverTimestamp() }));
    return {
      orgId: data.orgId as string,
      provider: data.provider as string,
      userId: data.userId as string,
    };
  });
}

export type InsertEventInput = {
  orgId: string; provider: string; category: string; eventType: string; action: string | null;
  deliveryId: string; repoFullName: string | null; actorLogin: string | null; mentionsBot: boolean; payload: unknown;
};

/** Insert one event; idempotent on deliveryId. Returns false if it was a redelivery.
 *  deliveryId is unique, so it doubles as the doc id and `create` gives the idempotency. */
export async function insertIntegrationEvent(db: Db, input: InsertEventInput): Promise<boolean> {
  const ref = col(db, 'integration_events').doc(input.deliveryId);
  const id = randomUUID();
  try {
    await ref.create(toDoc({
      id,
      orgId: input.orgId, provider: input.provider, category: input.category, eventType: input.eventType,
      action: input.action, deliveryId: input.deliveryId, repoFullName: input.repoFullName,
      actorLogin: input.actorLogin, mentionsBot: input.mentionsBot, payload: input.payload,
      processed: false, receivedAt: new Date(),
    }));
    return true;
  } catch (e) {
    if (e instanceof AlreadyExistsError) return false; // redelivery
    throw e;
  }
}

/** Disable the connection for a given installation (e.g. on installation.deleted). */
export async function disableIntegrationByInstallationId(db: Db, provider: string, installationId: string): Promise<boolean> {
  const snaps = await col(db, 'org_integrations')
    .where('provider', '==', provider)
    .where('metadata.installationId', '==', installationId)
    .get();
  if (snaps.length === 0) return false;
  await Promise.all(snaps.map((d) => col(db, 'org_integrations').doc(d.id).update(toDoc({ enabled: false, updatedAt: FieldValue.serverTimestamp() }))));
  return true;
}
