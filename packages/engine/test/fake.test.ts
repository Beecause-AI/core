import { describe, expect, it } from 'vitest';
import { fakeProvider } from '../src/providers/fake.js';
import { ProviderError, type ModelEvent } from '../src/provider.js';

async function collect(iter: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const out: ModelEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

const req = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }] };
const ctx = { apiKey: 'k' };

describe('fakeProvider', () => {
  it('yields its scripted events', async () => {
    const p = fakeProvider('fake', [
      { type: 'text', delta: 'he' },
      { type: 'text', delta: 'llo' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const events = await collect(p.run(req, ctx, new AbortController().signal));
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: 'text', delta: 'he' });
  });

  it('throws when it hits a scripted error step', async () => {
    const p = fakeProvider('fake', [{ type: 'error', error: new ProviderError('429', 'temporary', 429) }]);
    await expect(collect(p.run(req, ctx, new AbortController().signal))).rejects.toThrow('429');
  });

  it('aborts promptly when the signal fires', async () => {
    const p = fakeProvider('fake', [{ type: 'delay', ms: 50 }, { type: 'text', delta: 'late' }]);
    const ac = new AbortController();
    const promise = collect(p.run(req, ctx, ac.signal));
    ac.abort();
    await expect(promise).rejects.toThrow(/abort/i);
  });

  it('throws on the very first step when pre-aborted, yielding nothing', async () => {
    const p = fakeProvider('fake', [
      { type: 'text', delta: 'never' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const ac = new AbortController();
    ac.abort();
    const out: ModelEvent[] = [];
    await expect(
      (async () => {
        for await (const e of p.run(req, ctx, ac.signal)) out.push(e);
      })(),
    ).rejects.toThrow(/abort/i);
    expect(out).toEqual([]);
  });

  it('passes tool_call and usage event variants through unchanged', async () => {
    const toolCall: ModelEvent = { type: 'tool_call', call: { id: 't1', name: 'foo', arguments: { a: 1 } } };
    const usage: ModelEvent = { type: 'usage', inputTokens: 10, outputTokens: 5 };
    const p = fakeProvider('fake', [toolCall, usage]);
    const events = await collect(p.run(req, ctx, new AbortController().signal));
    expect(events).toEqual([toolCall, usage]);
  });

  it('aborting during a delay rejects without yielding the post-delay event', async () => {
    const p = fakeProvider('fake', [{ type: 'delay', ms: 100 }, { type: 'text', delta: 'after' }]);
    const ac = new AbortController();
    const out: ModelEvent[] = [];
    const promise = (async () => {
      for await (const e of p.run(req, ctx, ac.signal)) out.push(e);
    })();
    setTimeout(() => ac.abort(), 10);
    await expect(promise).rejects.toThrow(/abort/i);
    expect(out).toEqual([]);
  });

  it('yields nothing and completes for an empty script', async () => {
    const p = fakeProvider('fake', []);
    const events = await collect(p.run(req, ctx, new AbortController().signal));
    expect(events).toEqual([]);
  });
});
