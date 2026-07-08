import { describe, it, expect } from 'vitest';
import { fakeProvider } from '../src/providers/fake.js';
import { recordedText, recordingProvider } from '../src/recorded-run.js';
import type { InvocationRecord, InvocationRecorder } from '../src/recorded-run.js';
import type { ModelEvent, ModelRequest } from '../src/provider.js';

const req: ModelRequest = {
  model: 'fake-model',
  messages: [{ role: 'user', content: 'hi' }],
};

const ctx = { apiKey: 'x' };

describe('recordedText', () => {
  it('returns text+usage and calls recorder once with ok record', async () => {
    const provider = fakeProvider('fake', [
      { type: 'text', delta: 'Hello ' },
      { type: 'text', delta: 'world' },
      { type: 'usage', inputTokens: 11, outputTokens: 3 },
      { type: 'done', finishReason: 'stop' },
    ]);

    const captured: InvocationRecord[] = [];
    const recorder: InvocationRecorder = { finish: (rec) => { captured.push(rec); } };

    const result = await recordedText(provider, req, ctx, {
      source: 'kg-build',
      buildId: 'b1',
      phase: 'flows',
    }, recorder);

    expect(result).toEqual({ text: 'Hello world', inputTokens: 11, outputTokens: 3 });

    expect(captured).toHaveLength(1);
    const rec = captured[0]!;
    expect(rec.source).toBe('kg-build');
    expect(rec.buildId).toBe('b1');
    expect(rec.phase).toBe('flows');
    expect(rec.model).toBe(req.model);
    expect(rec.messages).toBe(req.messages);
    expect(rec.output).toBe('Hello world');
    expect(rec.inputTokens).toBe(11);
    expect(rec.outputTokens).toBe(3);
    expect(rec.status).toBe('ok');
    expect(rec.latencyMs).toBeGreaterThanOrEqual(0);
    expect(rec.error).toBeUndefined();
  });

  it('does not break when recorder throws', async () => {
    const provider = fakeProvider('fake', [
      { type: 'text', delta: 'Hello ' },
      { type: 'text', delta: 'world' },
      { type: 'usage', inputTokens: 11, outputTokens: 3 },
      { type: 'done', finishReason: 'stop' },
    ]);

    let called = 0;
    const throwingRecorder: InvocationRecorder = {
      finish: () => { called += 1; throw new Error('recorder exploded'); },
    };

    const result = await recordedText(provider, req, ctx, { source: 'test' }, throwingRecorder);

    expect(result).toEqual({ text: 'Hello world', inputTokens: 11, outputTokens: 3 });
    expect(called).toBe(1);
  });

  it('records error status and rethrows when provider throws mid-stream', async () => {
    const streamError = new Error('stream failed');
    const provider = fakeProvider('fake', [
      { type: 'text', delta: 'partial' },
      { type: 'error', error: streamError },
    ]);

    const captured: InvocationRecord[] = [];
    const recorder: InvocationRecorder = { finish: (rec) => { captured.push(rec); } };

    await expect(
      recordedText(provider, req, ctx, { source: 'kg-build' }, recorder),
    ).rejects.toThrow('stream failed');

    expect(captured).toHaveLength(1);
    const rec = captured[0]!;
    expect(rec.status).toBe('error');
    expect(rec.error).toBe('stream failed');
    expect(rec.output).toBe('partial');
    expect(rec.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('recordingProvider', () => {
  const ctxR = { apiKey: 'x' };
  const sig = new AbortController().signal;

  async function drain(it: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
    const out: ModelEvent[] = [];
    for await (const ev of it) out.push(ev);
    return out;
  }

  it('yields the same events and records one full record (messages+output+usage)', async () => {
    const script: ModelEvent[] = [
      { type: 'text', delta: 'Hello ' },
      { type: 'text', delta: 'world' },
      { type: 'usage', inputTokens: 11, outputTokens: 3 },
      { type: 'done', finishReason: 'stop' },
    ];
    const base = fakeProvider('fake', script);

    const captured: InvocationRecord[] = [];
    const recorder: InvocationRecorder = { finish: (rec) => { captured.push(rec); } };

    const decorated = recordingProvider(base, {
      source: 'conversation',
      orgId: 'org-1',
      conversationId: 'conv-1',
    }, recorder);

    expect(decorated.id).toBe('fake');

    const events = await drain(decorated.run(req, ctxR, sig));
    expect(events).toEqual(script);

    expect(captured).toHaveLength(1);
    const rec = captured[0]!;
    expect(rec.source).toBe('conversation');
    expect(rec.orgId).toBe('org-1');
    expect(rec.conversationId).toBe('conv-1');
    expect(rec.provider).toBe('fake'); // falls back to base.id
    expect(rec.model).toBe(req.model);
    expect(rec.messages).toBe(req.messages); // FULL messages, not a preview
    expect(rec.output).toBe('Hello world');
    expect(rec.inputTokens).toBe(11);
    expect(rec.outputTokens).toBe(3);
    expect(rec.status).toBe('ok');
    expect(rec.error).toBeNull();
    expect(rec.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('prefers an explicit provider in meta over base.id', async () => {
    const base = fakeProvider('fake', [{ type: 'done', finishReason: 'stop' }]);
    const captured: InvocationRecord[] = [];
    const decorated = recordingProvider(base, { source: 'conversation', provider: 'anthropic' }, { finish: (r) => { captured.push(r); } });
    await drain(decorated.run(req, ctxR, sig));
    expect(captured[0]!.provider).toBe('anthropic');
  });

  it('does not break streaming when the recorder throws', async () => {
    const script: ModelEvent[] = [
      { type: 'text', delta: 'Hello ' },
      { type: 'text', delta: 'world' },
      { type: 'done', finishReason: 'stop' },
    ];
    const base = fakeProvider('fake', script);

    let called = 0;
    const throwing: InvocationRecorder = { finish: () => { called += 1; throw new Error('recorder exploded'); } };

    const decorated = recordingProvider(base, { source: 'conversation' }, throwing);
    const events = await drain(decorated.run(req, ctxR, sig));

    expect(events).toEqual(script);
    expect(called).toBe(1);
  });

  it('calls start BEFORE the run and threads its id into finish', async () => {
    const order: string[] = [];
    const base = fakeProvider('fake', [
      { type: 'text', delta: 'hi' },
      { type: 'usage', inputTokens: 2, outputTokens: 1 },
      { type: 'done', finishReason: 'stop' },
    ]);
    let startMessages: unknown = null;
    const recorder: InvocationRecorder = {
      start: (s) => { order.push('start'); startMessages = s.messages; return 'inflight-1'; },
      finish: (_rec, id) => { order.push(`finish:${id}`); },
    };
    const decorated = recordingProvider(base, { source: 'conversation', conversationId: 'c1' }, recorder);
    await drain(decorated.run(req, ctxR, sig));
    expect(order).toEqual(['start', 'finish:inflight-1']);
    expect(startMessages).toBe(req.messages); // full messages available before the call
  });

  it('records an error record and rethrows when base.run throws mid-stream', async () => {
    const streamError = new Error('stream failed');
    const base = fakeProvider('fake', [
      { type: 'text', delta: 'partial' },
      { type: 'error', error: streamError },
    ]);

    const captured: InvocationRecord[] = [];
    const recorder: InvocationRecorder = { finish: (rec) => { captured.push(rec); } };
    const decorated = recordingProvider(base, { source: 'conversation' }, recorder);

    await expect(drain(decorated.run(req, ctxR, sig))).rejects.toThrow('stream failed');

    expect(captured).toHaveLength(1);
    const rec = captured[0]!;
    expect(rec.status).toBe('error');
    expect(rec.error).toBe('stream failed');
    expect(rec.output).toBe('partial');
    expect(rec.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
