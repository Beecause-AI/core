import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Firestore } from '@google-cloud/firestore';
import {
  createOrgWithOwner, enqueueTurn, getTurn, listLaneQueue, requestCancel, getBreaker, saveBreaker,
} from '@intellilabs/core';
import type { Db, QueuedTurn } from '@intellilabs/core';
import { FirestoreStore } from '../../core/src/adapters/store/firestore.js';
import { runConversation, drainLane, MAX_ATTEMPTS, MAX_DELIVERIES, type EngineDeps } from '../src/engine.js';
import {
  ModelRegistry, breakerKeyFor, type ModelEntry, type CredentialResolver, type ProviderContextResolved,
} from '../src/registry.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { addTool } from '../src/tools/builtins/add.js';
import { FAILURE_THRESHOLD } from '../src/breaker.js';
import { fakeProvider } from '../src/providers/fake.js';
import { ProviderError, type ModelEvent, type ModelProvider, type ToolCall, type ToolDef, type ModelMessage, type ToolResult } from '../src/provider.js';
import type { ToolExecutor } from '../src/tools/types.js';

let db: Db;
let raw: Firestore;
let orgId: string;

/** Delete every doc in a collection (between cases / setup). Uses the raw handle because
 *  collection enumeration (listDocuments) is not part of the DocStore port. */
async function clearCollection(name: string): Promise<void> {
  const docs = await raw.collection(name).listDocuments();
  await Promise.all(docs.map((d) => d.delete()));
}

const ENTRIES: ModelEntry[] = [
  {
    model: 'fake-model',
    provider: 'fake',
    credentialSource: 'platform',
    cancellation: 'in-flight',
    capabilities: { tools: false, streaming: true },
  },
  {
    model: 'fake-slow',
    provider: 'fakeslow',
    credentialSource: 'platform',
    cancellation: 'boundary-only',
    capabilities: { tools: false, streaming: true },
  },
  {
    model: 'ghost-model',
    provider: 'ghost', // intentionally NOT registered in the providers map
    credentialSource: 'platform',
    cancellation: 'in-flight',
    capabilities: { tools: false, streaming: true },
  },
  {
    model: 'agent-model',
    provider: 'fake-agent',
    credentialSource: 'platform',
    cancellation: 'in-flight',
    capabilities: { tools: true, streaming: true },
  },
  {
    model: 'suspend-model',
    provider: 'fake-suspend',
    credentialSource: 'platform',
    cancellation: 'in-flight',
    capabilities: { tools: true, streaming: true },
  },
  {
    model: 'subagent-model',
    provider: 'fake-subagent',
    credentialSource: 'platform',
    cancellation: 'in-flight',
    capabilities: { tools: true, streaming: true },
  },
];

const registry = new ModelRegistry(ENTRIES);

const okCredentials: CredentialResolver = {
  async resolve(): Promise<ProviderContextResolved> {
    return { apiKey: 'k' };
  },
};

function okProvider(): ModelProvider {
  return fakeProvider('fake', [
    { type: 'text', delta: 'hello' },
    { type: 'done', finishReason: 'stop' },
  ]);
}

function baseDeps(overrides: Partial<EngineDeps> = {}): EngineDeps {
  return {
    db,
    registry,
    providers: new Map<string, ModelProvider>(),
    credentials: okCredentials,
    buildRequest: (turn: QueuedTurn) => ({
      model: (turn.payload as { model: string }).model,
      messages: [{ role: 'user', content: 'hi' }],
    }),
    ...overrides,
  };
}

/** A fresh unique lane per test keeps everything isolated and deterministic. */
function newLane(): string {
  return randomUUID();
}

async function enqueue(laneId: string, model: string): Promise<QueuedTurn> {
  return enqueueTurn(db, { laneId, orgId, source: 'web', payload: { model } });
}

beforeAll(async () => {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  raw = new Firestore({ projectId: `test-engine-${process.pid}` });
  db = new FirestoreStore(raw);

  const userId = randomUUID();
  const org = await createOrgWithOwner(db, {
    name: 'Engine Test Org',
    slug: `eng-${userId.slice(0, 8)}`,
    userId,
  });
  orgId = org.id;
}, 60_000);

afterAll(async () => {
  await raw.terminate();
});

beforeEach(async () => {
  // Clear breaker rows so each test starts with a clean breaker for its key.
  await clearCollection('breaker_state');
});

describe('runConversation', () => {
  it('1. happy path: processes turns in seq order, then idle', async () => {
    const lane = newLane();
    const t1 = await enqueue(lane, 'fake-model');
    const t2 = await enqueue(lane, 'fake-model');

    const r1 = await runConversation(baseDeps({ providers: new Map([['fake', okProvider()]]) }), lane);
    expect(r1).toEqual({ kind: 'done', turnId: t1.id });

    const r2 = await runConversation(baseDeps({ providers: new Map([['fake', okProvider()]]) }), lane);
    expect(r2).toEqual({ kind: 'done', turnId: t2.id });

    const r3 = await runConversation(baseDeps({ providers: new Map([['fake', okProvider()]]) }), lane);
    expect(r3).toEqual({ kind: 'idle' });

    expect((await getTurn(db, t1.id))?.status).toBe('done');
    expect((await getTurn(db, t2.id))?.status).toBe('done');
  });

  it('2. onEvent is invoked with the streamed events', async () => {
    const lane = newLane();
    await enqueue(lane, 'fake-model');
    const events: ModelEvent[] = [];
    const deps = baseDeps({
      providers: new Map([['fake', okProvider()]]),
      onEvent: (_turn, ev) => {
        events.push(ev);
      },
    });
    const r = await runConversation(deps, lane);
    expect(r.kind).toBe('done');
    expect(events).toContainEqual({ type: 'text', delta: 'hello' });
    expect(events).toContainEqual({ type: 'done', finishReason: 'stop' });
  });

  it('3. temporary failure requeues and trips the breaker by one', async () => {
    const lane = newLane();
    const turn = await enqueue(lane, 'fake-model');
    const provider = fakeProvider('fake', [
      { type: 'error', error: new ProviderError('503', 'temporary', 503) },
    ]);
    const r = await runConversation(baseDeps({ providers: new Map([['fake', provider]]) }), lane);
    expect(r).toEqual({ kind: 'requeued', turnId: turn.id });

    const row = await getTurn(db, turn.id);
    expect(row?.status).toBe('queued');
    expect(row?.attempts).toBe(1);

    const breaker = await getBreaker(db, breakerKeyFor(ENTRIES[0]!, orgId));
    expect(breaker?.failures).toBe(1);
  });

  it('4. permanent failure fails fast without tripping the breaker', async () => {
    const lane = newLane();
    const turn = await enqueue(lane, 'fake-model');
    const provider = fakeProvider('fake', [
      { type: 'error', error: new ProviderError('400', 'permanent', 400) },
    ]);
    const r = await runConversation(baseDeps({ providers: new Map([['fake', provider]]) }), lane);
    expect(r).toEqual({ kind: 'failed', turnId: turn.id });

    expect((await getTurn(db, turn.id))?.status).toBe('failed');
    expect(await getBreaker(db, breakerKeyFor(ENTRIES[0]!, orgId))).toBeNull();
  });

  it('5. dead-letters at MAX_ATTEMPTS instead of requeuing', async () => {
    const lane = newLane();
    const turn = await enqueue(lane, 'fake-model');
    // Bump attempts so claim.attempts + 1 >= MAX_ATTEMPTS.
    await db.collection('message_queue').doc(turn.id).update({ attempts: MAX_ATTEMPTS - 1 });

    const provider = fakeProvider('fake', [
      { type: 'error', error: new ProviderError('503', 'temporary', 503) },
    ]);
    const r = await runConversation(baseDeps({ providers: new Map([['fake', provider]]) }), lane);
    expect(r).toEqual({ kind: 'failed', turnId: turn.id });
    expect((await getTurn(db, turn.id))?.status).toBe('failed');
  });

  it('6. breaker open defers without counting an attempt', async () => {
    const lane = newLane();
    const turn = await enqueue(lane, 'fake-model');
    const now = new Date('2026-01-01T00:00:00.000Z');
    const future = new Date(now.getTime() + 60_000);
    await saveBreaker(db, {
      key: breakerKeyFor(ENTRIES[0]!, orgId),
      state: 'open',
      failures: 5,
      openedAt: now,
      nextProbeAt: future,
    });

    const r = await runConversation(baseDeps({ providers: new Map([['fake', okProvider()]]), now: () => now }), lane);
    expect(r).toEqual({ kind: 'breaker_open', turnId: turn.id });

    const row = await getTurn(db, turn.id);
    expect(row?.status).toBe('queued');
    expect(row?.attempts).toBe(0);
  });

  it('rate-limit (429) failure requeues and records ONE breaker failure (under threshold)', async () => {
    const lane = newLane();
    const turn = await enqueue(lane, 'fake-model');
    const provider = fakeProvider('fake', [
      { type: 'error', error: new ProviderError('anthropic 429', 'rate_limited', 429, 5_000) },
    ]);
    const r = await runConversation(baseDeps({ providers: new Map([['fake', provider]]) }), lane);
    expect(r).toEqual({ kind: 'requeued', turnId: turn.id });
    expect((await getTurn(db, turn.id))?.attempts).toBe(1);
    const breaker = await getBreaker(db, breakerKeyFor(ENTRIES[0]!, orgId));
    expect(breaker?.failures).toBe(1);
    expect(breaker?.state).toBe('closed'); // RATE_LIMIT_THRESHOLD is 2: one strike stays closed
  });

  it('a second rate-limit opens the breaker honoring retry-after as the cooldown', async () => {
    const lane = newLane();
    await enqueue(lane, 'fake-model');
    const now = new Date('2026-01-01T00:00:00.000Z');
    const key = breakerKeyFor(ENTRIES[0]!, orgId);
    await saveBreaker(db, { key, state: 'closed', failures: 1, openedAt: null, nextProbeAt: null });
    const provider = fakeProvider('fake', [
      { type: 'error', error: new ProviderError('anthropic 429', 'rate_limited', 429, 5_000) },
    ]);
    const r = await runConversation(baseDeps({ providers: new Map([['fake', provider]]), now: () => now }), lane);
    expect(r.kind).toBe('requeued');
    const breaker = await getBreaker(db, key);
    expect(breaker?.state).toBe('open');
    expect(breaker?.nextProbeAt).toEqual(new Date(now.getTime() + 5_000));
  });

  it('breaker-open deferral bumps deferrals, not attempts', async () => {
    const lane = newLane();
    const turn = await enqueue(lane, 'fake-model');
    const now = new Date('2026-01-01T00:00:00.000Z');
    await saveBreaker(db, {
      key: breakerKeyFor(ENTRIES[0]!, orgId), state: 'open', failures: 5,
      openedAt: now, nextProbeAt: new Date(now.getTime() + 60_000),
    });
    const r = await runConversation(baseDeps({ providers: new Map([['fake', okProvider()]]), now: () => now }), lane);
    expect(r).toEqual({ kind: 'breaker_open', turnId: turn.id });
    const row = await getTurn(db, turn.id);
    expect(row?.attempts).toBe(0);
    expect(row?.deferrals).toBe(1);
  });

  it('breaker-open gives up with a clean failure before the Pub/Sub DLQ budget is spent', async () => {
    const lane = newLane();
    const turn = await enqueue(lane, 'fake-model');
    const now = new Date('2026-01-01T00:00:00.000Z');
    // One short of the budget: the next deferral must fail cleanly (200-ACK) rather than nack again.
    await db.collection('message_queue').doc(turn.id).update({ deferrals: MAX_DELIVERIES - 1 });
    await saveBreaker(db, {
      key: breakerKeyFor(ENTRIES[0]!, orgId), state: 'open', failures: 5,
      openedAt: now, nextProbeAt: new Date(now.getTime() + 60_000),
    });
    const r = await runConversation(baseDeps({ providers: new Map([['fake', okProvider()]]), now: () => now }), lane);
    expect(r).toEqual({ kind: 'failed', turnId: turn.id });
    expect((await getTurn(db, turn.id))?.status).toBe('failed');
  });

  it('records a visible "deferred" step when the breaker holds a turn off (back-off is tracked, not silent)', async () => {
    const lane = newLane();
    await enqueue(lane, 'fake-model');
    const now = new Date('2026-01-01T00:00:00.000Z');
    await saveBreaker(db, {
      key: breakerKeyFor(ENTRIES[0]!, orgId), state: 'open', failures: 5,
      openedAt: now, nextProbeAt: new Date(now.getTime() + 60_000),
    });
    const recorded: Array<{ status: string }> = [];
    const recorder = { finish: (rec: { status: string }) => { recorded.push(rec); } };
    const r = await runConversation(baseDeps({
      providers: new Map([['fake', okProvider()]]), now: () => now,
      recorderFor: () => ({ recorder: recorder as any, meta: { source: 'conversation', conversationId: lane, orgId } }),
    }), lane);
    expect(r.kind).toBe('breaker_open');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.status).toBe('deferred');
  });

  it('7. breaker probe allowed when nextProbeAt has passed; success closes it', async () => {
    const lane = newLane();
    await enqueue(lane, 'fake-model');
    const now = new Date('2026-01-01T00:00:00.000Z');
    const past = new Date(now.getTime() - 60_000);
    const key = breakerKeyFor(ENTRIES[0]!, orgId);
    await saveBreaker(db, {
      key,
      state: 'open',
      failures: 5,
      openedAt: new Date(now.getTime() - 120_000),
      nextProbeAt: past,
    });

    const r = await runConversation(baseDeps({ providers: new Map([['fake', okProvider()]]), now: () => now }), lane);
    expect(r.kind).toBe('done');

    const breaker = await getBreaker(db, key);
    expect(breaker?.state).toBe('closed');
    expect(breaker?.failures).toBe(0);
  });

  it('8. in-flight abort -> cancelled (isAbort branch)', async () => {
    const lane = newLane();
    const turn = await enqueue(lane, 'fake-model');
    const provider = fakeProvider('fake', [
      { type: 'text', delta: 'x' },
      { type: 'error', error: Object.assign(new Error('aborted'), { name: 'AbortError' }) },
    ]);
    const r = await runConversation(baseDeps({ providers: new Map([['fake', provider]]) }), lane);
    expect(r).toEqual({ kind: 'cancelled', turnId: turn.id });
    expect((await getTurn(db, turn.id))?.status).toBe('cancelled');
  });

  it('9. boundary-only cancel discards a completed result', async () => {
    const lane = newLane();
    const turn = await enqueue(lane, 'fake-slow');
    // A provider that flags cancel mid-call then completes normally. The engine's
    // post-success isCancelRequested check must turn this into cancelled, not done.
    const provider: ModelProvider = {
      id: 'fakeslow',
      async *run() {
        await requestCancel(db, turn.id);
        yield { type: 'text', delta: 'late' } as ModelEvent;
        yield { type: 'done', finishReason: 'stop' } as ModelEvent;
      },
    };
    const r = await runConversation(baseDeps({ providers: new Map([['fakeslow', provider]]) }), lane);
    expect(r).toEqual({ kind: 'cancelled', turnId: turn.id });
    expect((await getTurn(db, turn.id))?.status).toBe('cancelled');
  });

  it('10. no provider registered -> failed', async () => {
    const lane = newLane();
    const turn = await enqueue(lane, 'ghost-model');
    const r = await runConversation(baseDeps({ providers: new Map([['fake', okProvider()]]) }), lane);
    expect(r).toEqual({ kind: 'failed', turnId: turn.id });
    expect((await getTurn(db, turn.id))?.status).toBe('failed');
  });

  it('11. credential resolution failure -> failed, no breaker trip', async () => {
    const lane = newLane();
    const turn = await enqueue(lane, 'fake-model');
    const credentials: CredentialResolver = {
      async resolve(): Promise<ProviderContextResolved> {
        throw new Error('bad key');
      },
    };
    const r = await runConversation(
      baseDeps({ providers: new Map([['fake', okProvider()]]), credentials }),
      lane,
    );
    expect(r).toEqual({ kind: 'failed', turnId: turn.id });
    expect((await getTurn(db, turn.id))?.status).toBe('failed');
    expect(await getBreaker(db, breakerKeyFor(ENTRIES[0]!, orgId))).toBeNull();
  });

  it('14. e2e cancel via Firestore listener tears down the in-flight stream mid-delay', async () => {
    // Exercises the REAL production cancel wire end-to-end:
    //   requestCancel (sets cancelRequested:true on the message_queue doc)
    //   -> watchCancel.onSnapshot fires onCancel -> controller.abort()
    //   -> provider observes signal.aborted mid-delay -> turn ends 'cancelled'.
    const lane = newLane();
    const turn = await enqueue(lane, 'fake-model');

    // Yields 'first', then an abortable 5s delay. The delay rejects with AbortError
    // the instant the signal fires, so 'should-not-arrive' is never yielded and the
    // 5000ms never elapses — the test stays well within the 60s timeout.
    const provider = fakeProvider('fake', [
      { type: 'text', delta: 'first' },
      { type: 'delay', ms: 5000 },
      { type: 'text', delta: 'should-not-arrive' },
      { type: 'done', finishReason: 'stop' },
    ]);

    const seen: ModelEvent[] = [];
    let signalFirstSeen!: () => void;
    const firstSeen = new Promise<void>((resolve) => { signalFirstSeen = resolve; });
    const deps = baseDeps({
      providers: new Map([['fake', provider]]),
      onEvent: (_turn, ev) => {
        seen.push(ev);
        if (ev.type === 'text' && ev.delta === 'first') signalFirstSeen();
      },
    });

    // Start the turn WITHOUT awaiting; capture the promise.
    const running = runConversation(deps, lane);

    // Deterministic: drive cancel off the first-event signal, not a fixed sleep.
    // Bounded so a wiring regression fails the test instead of hanging.
    await Promise.race([
      firstSeen,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('first event never arrived')), 10_000)),
    ]);

    // The real cancel wire: mark cancelRequested on the doc — the Firestore listener fires.
    await requestCancel(db, turn.id);

    const r = await running;

    expect(r).toEqual({ kind: 'cancelled', turnId: turn.id });
    expect((await getTurn(db, turn.id))?.status).toBe('cancelled');
    // The in-flight abort tore down the stream mid-delay: the post-delay event
    // must never have been delivered.
    expect(seen).toContainEqual({ type: 'text', delta: 'first' });
    expect(seen.some((e) => e.type === 'text' && e.delta === 'should-not-arrive')).toBe(false);
  }, 60_000);

  it('15. counts concurrent same-breaker failures atomically across lanes', async () => {
    // Two turns on DIFFERENT lanes share `fake:fake-model:platform` (platform scope),
    // and the lane lock does NOT serialize across lanes. Run both through temporary-
    // failing providers concurrently. recordBreakerFailure re-reads under a per-key
    // advisory lock and applies the transition, so both increments are counted with
    // no lost update.
    const laneA = newLane();
    const laneB = newLane();
    const tA = await enqueue(laneA, 'fake-model');
    const tB = await enqueue(laneB, 'fake-model');
    expect(breakerKeyFor(ENTRIES[0]!, orgId)).toBe('fake:fake-model:platform');

    const failing = (): ModelProvider =>
      fakeProvider('fake', [{ type: 'error', error: new ProviderError('503', 'temporary', 503) }]);

    const [rA, rB] = await Promise.all([
      runConversation(baseDeps({ providers: new Map([['fake', failing()]]) }), laneA),
      runConversation(baseDeps({ providers: new Map([['fake', failing()]]) }), laneB),
    ]);
    expect(rA).toEqual({ kind: 'requeued', turnId: tA.id });
    expect(rB).toEqual({ kind: 'requeued', turnId: tB.id });

    const breaker = await getBreaker(db, breakerKeyFor(ENTRIES[0]!, orgId));
    // With recordBreakerFailure the increment is atomic — two concurrent failures
    // on the same breaker key now count BOTH (no lost update).
    expect(breaker?.failures).toBe(2);
    expect(2).toBeLessThan(FAILURE_THRESHOLD); // 2 < FAILURE_THRESHOLD, so still closed
    expect(breaker?.state).toBe('closed');
  });

  it('uses deps.resolveEntry to reroute a turn to a byok provider + per-org breaker', async () => {
    const lane = 'eeee0000-0000-0000-0000-0000000000b1';
    await enqueueTurn(db as any, { laneId: lane, orgId, source: 'web', payload: { model: 'fake-model' } });
    const platformEntry = { model: 'fake-model', provider: 'fake', credentialSource: 'platform' as const, cancellation: 'in-flight' as const, capabilities: { tools: false, streaming: true }, byokProvider: 'fakebyok' };
    const deps = {
      db,
      registry: new ModelRegistry([platformEntry]),
      providers: new Map([[ 'fakebyok', fakeProvider('fakebyok', [{ type: 'text', delta: 'hi' }, { type: 'done', finishReason: 'stop' }]) ]]),
      credentials: { resolve: async (e: any) => { expect(e.provider).toBe('fakebyok'); expect(e.credentialSource).toBe('byok'); return { apiKey: 'org-key' }; } },
      buildRequest: (t: any) => ({ model: t.payload.model, messages: [] }),
      resolveEntry: async (model: string, _org: string) => ({ ...platformEntry, provider: 'fakebyok', credentialSource: 'byok' as const }),
    };
    const outcome = await runConversation(deps as any, lane);
    expect(outcome.kind).toBe('done');
    expect(await getBreaker(db as any, `fakebyok:fake-model:${orgId}`)).not.toBeNull();
  });

  it('defaults to registry.get (platform scope) when resolveEntry is omitted', async () => {
    const lane = newLane();
    const turn = await enqueue(lane, 'fake-model');
    // No resolveEntry: must resolve via registry.get to the platform `fake` entry.
    const outcome = await runConversation(
      baseDeps({ providers: new Map([['fake', okProvider()]]) }),
      lane,
    );
    expect(outcome).toEqual({ kind: 'done', turnId: turn.id });
    // Breaker is keyed in the PLATFORM scope, not per-org.
    expect(await getBreaker(db, 'fake:fake-model:platform')).not.toBeNull();
    expect(await getBreaker(db, `fake:fake-model:${orgId}`)).toBeNull();
  });

  it('idle when nothing is queued', async () => {
    const r = await runConversation(baseDeps({ providers: new Map([['fake', okProvider()]]) }), newLane());
    expect(r).toEqual({ kind: 'idle' });
  });

  it('16. agentLoop path: tool_call then second run yields done; provider invoked twice', async () => {
    const lane = newLane();
    await enqueueTurn(db, {
      laneId: lane,
      orgId,
      source: 'web',
      payload: { model: 'agent-model', enabledTools: ['builtin.add'] },
    });

    let runs = 0;
    const agentProvider: ModelProvider = {
      id: 'fake-agent',
      async *run() {
        runs += 1;
        if (runs === 1) {
          // First run: yield a tool_call for builtin.add(2, 3), then done with tool_use
          yield { type: 'tool_call', call: { id: 'call-1', name: 'builtin.add', arguments: { a: 2, b: 3 } } } as ModelEvent;
          yield { type: 'done', finishReason: 'tool_use' } as ModelEvent;
        } else {
          // Second run: yield text result then stop
          yield { type: 'text', delta: 'The answer is 5.' } as ModelEvent;
          yield { type: 'done', finishReason: 'stop' } as ModelEvent;
        }
      },
    };

    const events: ModelEvent[] = [];
    const deps = baseDeps({
      providers: new Map([['fake-agent', agentProvider]]),
      onEvent: (_turn, ev) => { events.push(ev); },
      agentLoop: {
        tools: new ToolRegistry([addTool]),
        toolNamesFor: (turn) => (turn.payload as { enabledTools?: string[] }).enabledTools ?? [],
      },
    });

    const outcome = await runConversation(deps, lane);

    expect(outcome.kind).toBe('done');
    expect(runs).toBe(2);
    const toolResultEvent = events.find((e) => e.type === 'tool_result');
    expect(toolResultEvent).toBeDefined();
    expect((toolResultEvent as Extract<ModelEvent, { type: 'tool_result' }>).result.content).toBe('5');
  });

  it('17. runConversation ends the turn-trace exactly once with ok on a successful agent run', async () => {
    const lane = newLane();
    await enqueueTurn(db, {
      laneId: lane,
      orgId,
      source: 'web',
      payload: { model: 'agent-model', enabledTools: ['builtin.add'] },
    });

    let runs = 0;
    const agentProvider: ModelProvider = {
      id: 'fake-agent',
      async *run() {
        runs += 1;
        if (runs === 1) {
          yield { type: 'tool_call', call: { id: 'call-1', name: 'builtin.add', arguments: { a: 2, b: 3 } } } as ModelEvent;
          yield { type: 'done', finishReason: 'tool_use' } as ModelEvent;
        } else {
          yield { type: 'text', delta: 'The answer is 5.' } as ModelEvent;
          yield { type: 'done', finishReason: 'stop' } as ModelEvent;
        }
      },
    };

    const ends: Array<[string, string | undefined]> = [];
    const recordingTrace = {
      startModelCall: () => ({ setUsage() {}, end() {} }),
      startToolCall: () => ({ end() {} }),
      end: (s: string, fr?: string) => { ends.push([s, fr]); },
    };

    const deps = baseDeps({
      providers: new Map([['fake-agent', agentProvider]]),
      agentLoop: {
        tools: new ToolRegistry([addTool]),
        toolNamesFor: (turn) => (turn.payload as { enabledTools?: string[] }).enabledTools ?? [],
      },
      trace: (_turn) => recordingTrace,
    });

    const outcome = await runConversation(deps, lane);

    expect(outcome.kind).toBe('done');
    expect(ends.length).toBe(1);
    expect(ends[0]![0]).toBe('ok');
  });

  it('18. agentLoop path: gated tool call suspends the turn; onSuspend receives messages+calls; tool not executed', async () => {
    const lane = newLane();
    await enqueueTurn(db, {
      laneId: lane,
      orgId,
      source: 'internal',
      payload: { model: 'suspend-model', messages: [{ role: 'user', content: 'do write' }], enabledTools: ['mcp.write'] },
    });

    // The provider yields a tool_call for a gated (mutates=true) tool then done with tool_use.
    const suspendProvider: ModelProvider = {
      id: 'fake-suspend',
      async *run() {
        yield { type: 'tool_call', call: { id: 'call-suspend-1', name: 'mcp.write', arguments: { text: 'hello' } } } as ModelEvent;
        yield { type: 'done', finishReason: 'tool_use' } as ModelEvent;
      },
    };

    // A ToolExecutor whose toToolDefs returns a mutates:true ToolDef for 'mcp.write'.
    let executeCallCount = 0;
    const suspendToolExecutor: ToolExecutor = {
      toToolDefs(names: string[]): ToolDef[] {
        return names.filter((n) => n === 'mcp.write').map((n) => ({
          name: n,
          description: 'Write something',
          parameters: {},
          kind: 'mcp' as const,
          mutates: true,
        }));
      },
      async execute(_call: ToolCall, _signal: AbortSignal): Promise<ToolResult> {
        executeCallCount += 1;
        return { toolCallId: _call.id, name: _call.name, content: 'done' };
      },
    };

    let suspendCapture: { messages: ModelMessage[]; calls: ToolCall[] } | null = null;

    const ends: Array<[string, string | undefined]> = [];
    const recordingTrace = {
      startModelCall: () => ({ setUsage() {}, end() {} }),
      startToolCall: () => ({ end() {} }),
      end: (s: string, fr?: string) => { ends.push([s, fr]); },
    };

    const deps = baseDeps({
      providers: new Map([['fake-suspend', suspendProvider]]),
      agentLoop: {
        tools: suspendToolExecutor,
        toolNamesFor: (turn) => (turn.payload as { enabledTools?: string[] }).enabledTools ?? [],
      },
      approval: () => ({ required: (_name: string, mutates: boolean) => mutates }),
      onSuspend: async (_turn, data) => { suspendCapture = data; },
      trace: (_turn) => recordingTrace,
    });

    const outcome = await runConversation(deps, lane);

    // Outcome is suspended
    expect(outcome).toEqual({ kind: 'suspended', turnId: expect.any(String) });

    // Tool execute spy was NOT called
    expect(executeCallCount).toBe(0);

    // onSuspend received the pending calls
    expect(suspendCapture).not.toBeNull();
    expect(suspendCapture!.calls).toHaveLength(1);
    expect(suspendCapture!.calls[0]!.name).toBe('mcp.write');

    // The last message in suspendCapture.messages is the assistant tool-call message
    const lastMsg = suspendCapture!.messages.at(-1)!;
    expect(lastMsg.role).toBe('assistant');
    expect(lastMsg.toolCalls).toHaveLength(1);
    expect(lastMsg.toolCalls![0]!.name).toBe('mcp.write');

    // turnTrace.end was called exactly once with 'ok' / 'suspended'
    expect(ends.length).toBe(1);
    expect(ends[0]![0]).toBe('ok');
    expect(ends[0]![1]).toBe('suspended');

    // The turn row is marked done (markTurnDone called on suspend path)
    expect(outcome.kind).toBe('suspended');
    const row = await getTurn(db, (outcome as Extract<typeof outcome, { turnId: string }>).turnId);
    expect(row?.status).toBe('done');
  });

  it('19. agentLoop path: agent tool call suspends the turn (awaiting_subagent); onSubagent receives messages+calls; execute NOT called', async () => {
    const lane = newLane();
    await enqueueTurn(db, {
      laneId: lane,
      orgId,
      source: 'internal',
      payload: { model: 'subagent-model', messages: [{ role: 'user', content: 'delegate' }], enabledTools: ['agent.a1'] },
    });

    // The provider yields a tool_call for the agent tool then done with tool_use.
    const subagentProvider: ModelProvider = {
      id: 'fake-subagent',
      async *run() {
        yield { type: 'tool_call', call: { id: 'call-agent-1', name: 'agent.a1', arguments: {} } } as ModelEvent;
        yield { type: 'done', finishReason: 'tool_use' } as ModelEvent;
      },
    };

    // A ToolExecutor whose toToolDefs returns a kind:'agent' ToolDef for 'agent.a1'.
    let executeCallCount = 0;
    const agentToolExecutor: ToolExecutor = {
      toToolDefs(names: string[]): ToolDef[] {
        return names.filter((n) => n === 'agent.a1').map((n) => ({
          name: n,
          description: 'Delegate to sub-agent a1',
          parameters: {},
          kind: 'agent' as const,
          mutates: false,
        }));
      },
      async execute(_call: ToolCall, _signal: AbortSignal): Promise<ToolResult> {
        executeCallCount += 1;
        return { toolCallId: _call.id, name: _call.name, content: 'should not run' };
      },
    };

    let subagentCapture: { messages: ModelMessage[]; calls: ToolCall[] } | null = null;

    const ends: Array<[string, string | undefined]> = [];
    const recordingTrace = {
      startModelCall: () => ({ setUsage() {}, end() {} }),
      startToolCall: () => ({ end() {} }),
      end: (s: string, fr?: string) => { ends.push([s, fr]); },
    };

    const deps = baseDeps({
      providers: new Map([['fake-subagent', subagentProvider]]),
      agentLoop: {
        tools: agentToolExecutor,
        toolNamesFor: (turn) => (turn.payload as { enabledTools?: string[] }).enabledTools ?? [],
      },
      onSubagent: async (_turn, data) => { subagentCapture = data; },
      trace: (_turn) => recordingTrace,
    });

    const outcome = await runConversation(deps, lane);

    // Outcome is suspended
    expect(outcome).toEqual({ kind: 'suspended', turnId: expect.any(String) });

    // Tool execute spy was NOT called
    expect(executeCallCount).toBe(0);

    // onSubagent received the pending agent calls
    expect(subagentCapture).not.toBeNull();
    expect(subagentCapture!.calls).toHaveLength(1);
    expect(subagentCapture!.calls[0]!.name).toBe('agent.a1');

    // The last message in subagentCapture.messages is the assistant agent-toolCall message
    const lastMsg = subagentCapture!.messages.at(-1)!;
    expect(lastMsg.role).toBe('assistant');
    expect(lastMsg.toolCalls).toHaveLength(1);
    expect(lastMsg.toolCalls![0]!.name).toBe('agent.a1');

    // turnTrace.end was called exactly once with 'ok' / 'subagent'
    expect(ends.length).toBe(1);
    expect(ends[0]![0]).toBe('ok');
    expect(ends[0]![1]).toBe('subagent');

    // The turn row is marked done (markTurnDone called on subagent-suspend path)
    const row = await getTurn(db, (outcome as Extract<typeof outcome, { turnId: string }>).turnId);
    expect(row?.status).toBe('done');
  });

  it('20. agentLoop path: subagent resume — subagentResultsFor injects result; final text yields done', async () => {
    const lane = newLane();
    // Enqueue a turn that simulates a resume: messages end in the assistant agent-toolCall message,
    // and payload carries the subagentResults.
    const agentCallId = 'call-agent-resume-1';
    await enqueueTurn(db, {
      laneId: lane,
      orgId,
      source: 'internal',
      payload: {
        model: 'subagent-model',
        enabledTools: ['agent.a1'],
        messages: [
          { role: 'user', content: 'delegate' },
          { role: 'assistant', content: '', toolCalls: [{ id: agentCallId, name: 'agent.a1', arguments: {} }] },
        ],
        subagentResults: { [agentCallId]: 'sub-agent result text' },
      },
    });

    let runs = 0;
    const resumeProvider: ModelProvider = {
      id: 'fake-subagent',
      async *run() {
        runs += 1;
        // After injection the model sees tool results and returns final text
        yield { type: 'text', delta: 'All done.' } as ModelEvent;
        yield { type: 'done', finishReason: 'stop' } as ModelEvent;
      },
    };

    const agentToolExecutor: ToolExecutor = {
      toToolDefs(names: string[]): ToolDef[] {
        return names.filter((n) => n === 'agent.a1').map((n) => ({
          name: n,
          description: 'Delegate to sub-agent a1',
          parameters: {},
          kind: 'agent' as const,
          mutates: false,
        }));
      },
      async execute(_call: ToolCall, _signal: AbortSignal): Promise<ToolResult> {
        return { toolCallId: _call.id, name: _call.name, content: 'should not run' };
      },
    };

    const deps = baseDeps({
      providers: new Map([['fake-subagent', resumeProvider]]),
      buildRequest: (turn) => ({
        model: (turn.payload as { model: string }).model,
        messages: (turn.payload as { messages: ModelMessage[] }).messages ?? [],
      }),
      agentLoop: {
        tools: agentToolExecutor,
        toolNamesFor: (turn) => (turn.payload as { enabledTools?: string[] }).enabledTools ?? [],
      },
      subagentResultsFor: (turn) => (turn.payload as { subagentResults?: Record<string, string> }).subagentResults,
    });

    const outcome = await runConversation(deps, lane);

    // The loop injected the sub-agent result and the provider ran once, yielding done
    expect(outcome.kind).toBe('done');
    expect(runs).toBe(1);
  });
});

describe('drainLane', () => {
  it('12. drains multiple queued turns to done until idle', async () => {
    const lane = newLane();
    const ids = [
      await enqueue(lane, 'fake-model'),
      await enqueue(lane, 'fake-model'),
      await enqueue(lane, 'fake-model'),
    ];
    await drainLane(baseDeps({ providerFactory: () => okProvider() }), lane);

    for (const t of ids) {
      expect((await getTurn(db, t.id))?.status).toBe('done');
    }
  });

  it('13. single-flight under drain preserves seq order', async () => {
    const lane = newLane();
    await enqueue(lane, 'fake-model');
    await enqueue(lane, 'fake-model');
    await enqueue(lane, 'fake-model');

    const processed: string[] = [];
    const deps = baseDeps({
      providerFactory: () => okProvider(),
      onEvent: (turn, ev) => {
        if (ev.type === 'done') processed.push(turn.id);
      },
    });
    await drainLane(deps, lane);

    const queue = await listLaneQueue(db, lane);
    expect(queue.map((q) => q.status)).toEqual(['done', 'done', 'done']);
    // onEvent recorded turns in processing order; it must match seq order.
    expect(processed).toEqual(queue.map((q) => q.id));
  });
});
