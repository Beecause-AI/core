import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults } from '../store/codec.js';
import { AlreadyExistsError } from '../ports/store.js';
import type { TeamsChannelBinding } from '../store/types.js';

/** Deterministic doc id for the (orgIntegrationId, teamsConversationId) unique pair.
 *  Teams conversation ids contain `:`, `;`, `@` which are illegal in Firestore doc ids,
 *  so we base64url-encode the conversation id. */
function bindingId(orgIntegrationId: string, teamsConversationId: string): string {
  return `${orgIntegrationId}_${Buffer.from(teamsConversationId).toString('base64url')}`;
}

export async function getBinding(db: Db, orgIntegrationId: string, teamsConversationId: string): Promise<TeamsChannelBinding | null> {
  const snap = await col(db, 'teams_channel_bindings').doc(bindingId(orgIntegrationId, teamsConversationId)).get();
  return snap.exists ? fromDoc<TeamsChannelBinding>(snap) : null;
}

export async function upsertPendingTeamsBinding(
  db: Db, input: { orgIntegrationId: string; teamsConversationId: string; channelName?: string | null },
): Promise<TeamsChannelBinding> {
  const ref = col(db, 'teams_channel_bindings').doc(bindingId(input.orgIntegrationId, input.teamsConversationId));
  const row = applyDefaults({
    orgIntegrationId: input.orgIntegrationId, teamsConversationId: input.teamsConversationId,
    channelName: input.channelName ?? null, projectId: null as string | null,
    status: 'pending', createdByUserId: null as string | null,
  }, ref.id);
  await ref.create(toDoc(row)).catch((e: unknown) => { if (!(e instanceof AlreadyExistsError)) throw e; });
  return (await getBinding(db, input.orgIntegrationId, input.teamsConversationId))!;
}

export async function setTeamsBinding(
  db: Db,
  input: { orgIntegrationId: string; teamsConversationId: string; projectId: string; createdByUserId?: string | null },
): Promise<TeamsChannelBinding> {
  const ref = col(db, 'teams_channel_bindings').doc(bindingId(input.orgIntegrationId, input.teamsConversationId));
  const row = applyDefaults({
    orgIntegrationId: input.orgIntegrationId, teamsConversationId: input.teamsConversationId,
    projectId: input.projectId, status: 'bound', createdByUserId: input.createdByUserId ?? null,
  }, ref.id);
  await ref.set(toDoc(row), { merge: true });
  return (await getBinding(db, input.orgIntegrationId, input.teamsConversationId))!;
}

export async function listTeamsBindings(db: Db, orgIntegrationId: string): Promise<TeamsChannelBinding[]> {
  const snaps = await col(db, 'teams_channel_bindings').where('orgIntegrationId', '==', orgIntegrationId).get();
  return snaps.map((d) => fromDoc<TeamsChannelBinding>(d));
}

export async function listTeamsBindingsForProject(db: Db, orgIntegrationId: string, projectId: string): Promise<TeamsChannelBinding[]> {
  const snaps = await col(db, 'teams_channel_bindings')
    .where('orgIntegrationId', '==', orgIntegrationId).where('projectId', '==', projectId).get();
  return snaps.map((d) => fromDoc<TeamsChannelBinding>(d));
}

export async function listTeamsBindingsByProject(db: Db, projectId: string): Promise<TeamsChannelBinding[]> {
  const snaps = await col(db, 'teams_channel_bindings').where('projectId', '==', projectId).get();
  return snaps.map((d) => fromDoc<TeamsChannelBinding>(d));
}

export async function listAvailableTeamsBindings(db: Db, orgIntegrationId: string): Promise<TeamsChannelBinding[]> {
  const snaps = await col(db, 'teams_channel_bindings')
    .where('orgIntegrationId', '==', orgIntegrationId).where('projectId', '==', null).get();
  return snaps.map((d) => fromDoc<TeamsChannelBinding>(d));
}

export async function deleteTeamsBinding(db: Db, orgIntegrationId: string, teamsConversationId: string): Promise<boolean> {
  const ref = col(db, 'teams_channel_bindings').doc(bindingId(orgIntegrationId, teamsConversationId));
  const snap = await ref.get();
  if (snap.exists) await ref.delete();
  return snap.exists;
}
