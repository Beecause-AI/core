/**
 * E2E: a conversation turn run through the engine records a FULL model invocation.
 *
 * Builds the real engine deps via buildEngineDeps (so the production recorderFor
 * wiring is exercised), seeds a conversation + turn, runs it through a fake
 * provider, and asserts a model_invocations row with source='conversation',
 * the turn's orgId, model, the FULL request messages and FULL output text.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrgWithOwner,
  createProject,
  createAssistant,
  createConversation,
  enqueueTurn,
  listModelInvocations,
  getModelInvocation,
  type Store,
} from '@intellilabs/core';
import {
  runConversation,
  inMemoryDispatcher,
  fakeProvider,
  type ModelProvider,
} from '@intellilabs/engine';
import { buildEngineDeps } from '../src/engine/bootstrap.js';
import { startTestDb, type TestDb } from './helpers.js';

let tdb: TestDb;
let store: Store;
let db: any;
let orgId: string;
let projectId: string;
let assistantId: string;

beforeAll(async () => {
  tdb = startTestDb();
  store = tdb.store;
  db = tdb.db;

  const org = await createOrgWithOwner(db, { name: 'MI Org', slug: 'mi-org', userId: 'u-mi-1' });
  orgId = org.id;
  const project = await createProject(db, orgId, { name: 'MIProject', slug: 'mi-project' });
  projectId = project.id;
  const assistant = await createAssistant(db, projectId, {
    name: 'MI Assistant', persona: 'be helpful', model: 'fake-model', enabledTools: [],
  });
  assistantId = assistant.id;
}, 120_000);

afterAll(async () => {
  await tdb.stop();
});

describe('conversation turn → model_invocations (full payload)', () => {
  it('records source=conversation with full messages + output + usage', async () => {
    const provider: ModelProvider = fakeProvider('fake-model-provider', [
      { type: 'text', delta: 'Hello ' },
      { type: 'text', delta: 'there!' },
      { type: 'usage', inputTokens: 42, outputTokens: 7 },
      { type: 'done', finishReason: 'stop' },
    ]);

    const deps = buildEngineDeps({
      store,
      geminiApiKey: 'k',
      dispatcher: inMemoryDispatcher(),
      models: [{
        model: 'fake-model', provider: 'fake-model-provider',
        credentialSource: 'platform', cancellation: 'in-flight',
        capabilities: { tools: true, streaming: true },
      }],
    });
    // Register the fake provider under the entry's provider id.
    deps.providers.set(provider.id, provider);
    // The platform resolver only knows google/vertex; supply a trivial credential
    // for the fake provider so the turn reaches provider.run.
    deps.credentials = { resolve: async () => ({ apiKey: 'test-key' }) };

    const convo = await createConversation(db, { orgId, projectId, assistantId, source: 'web' });
    const laneId = convo.id;
    const messages = [
      { role: 'system' as const, content: 'be helpful' },
      { role: 'user' as const, content: 'say hello' },
    ];
    await enqueueTurn(db, {
      laneId, orgId, source: 'web',
      payload: { model: 'fake-model', messages, projectId, assistantId, enabledTools: [] },
    });

    const outcome = await runConversation(deps, laneId);
    expect(outcome.kind).toBe('done');

    const rows = await listModelInvocations(db, { source: 'conversation', orgId });
    expect(rows.length).toBe(1);
    const compact = rows[0]!;
    expect(compact.source).toBe('conversation');
    expect(compact.orgId).toBe(orgId);
    expect(compact.model).toBe('fake-model');
    expect(compact.conversationId).toBe(laneId);
    expect(compact.inputTokens).toBe(42);
    expect(compact.outputTokens).toBe(7);
    expect(compact.status).toBe('ok');

    const full = await getModelInvocation(db, compact.id);
    expect(full).not.toBeNull();
    // FULL messages preserved (not a 2000-char preview).
    expect(full!.messages).toEqual(messages);
    expect(full!.output).toBe('Hello there!');
    expect(full!.provider).toBe('fake-model-provider');
    expect(full!.truncated).toBe(false);
  }, 120_000);
});
