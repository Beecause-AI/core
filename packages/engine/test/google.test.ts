import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { googleProvider } from '../src/providers/google.js';
import { ProviderError, type ModelEvent } from '../src/provider.js';

let server: Server | undefined;
afterEach(() => { server?.close(); server = undefined; });

function listen(handler: (req: any, res: any) => void): Promise<string> {
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`));
  });
}
async function collect(it: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const out: ModelEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}
const req = { model: 'gemini-3-flash-preview', messages: [{ role: 'user' as const, content: 'hi' }] };

describe('googleProvider', () => {
  it('parses streamed candidates into text + usage + done', async () => {
    const baseUrl = await listen((q, res) => {
      if (q.headers['x-goog-api-key'] !== 'k' || !q.url.includes(':streamGenerateContent')) { res.writeHead(400); res.end('bad'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"candidates":[{"content":{"parts":[{"text":"he"}]}}]}\n\n');
      res.write('data: {"candidates":[{"content":{"parts":[{"text":"llo"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2}}\n\n');
      res.end();
    });
    const events = await collect(googleProvider.run(req, { apiKey: 'k', baseUrl }, new AbortController().signal));
    const text = events.filter((e) => e.type === 'text').map((e: any) => e.delta).join('');
    expect(text).toBe('hello');
    expect(events.some((e) => e.type === 'usage' && (e as any).inputTokens === 3 && (e as any).outputTokens === 2)).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'STOP' });
  });

  it('classifies HTTP 429 as temporary and 400 as permanent', async () => {
    const t = await listen((_q, res) => { res.writeHead(429); res.end('rate'); });
    await expect(collect(googleProvider.run(req, { apiKey: 'k', baseUrl: t }, new AbortController().signal)))
      .rejects.toMatchObject({ kind: 'temporary', status: 429 });
    server?.close();
    const p = await listen((_q, res) => { res.writeHead(400); res.end('bad'); });
    await expect(collect(googleProvider.run(req, { apiKey: 'k', baseUrl: p }, new AbortController().signal)))
      .rejects.toMatchObject({ kind: 'permanent', status: 400 });
  });

  it('throws AbortError-by-name when the signal fires mid-stream', async () => {
    const baseUrl = await listen((_q, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"candidates":[{"content":{"parts":[{"text":"x"}]}}]}\n\n');
    });
    const ac = new AbortController();
    const it = googleProvider.run(req, { apiKey: 'k', baseUrl }, ac.signal);
    const out: ModelEvent[] = [];
    const p = (async () => { for await (const e of it) { out.push(e); ac.abort(); } })();
    await expect(p).rejects.toSatisfy((e: any) => e?.name === 'AbortError');
  });

  it('maps system + assistant roles to systemInstruction + model', async () => {
    let body: any;
    const baseUrl = await listen((q, res) => {
      let raw = ''; q.on('data', (c: Buffer) => (raw += c)); q.on('end', () => {
        body = JSON.parse(raw);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}]}\n\n');
        res.end();
      });
    });
    await collect(googleProvider.run({ model: 'gemini-3-flash-preview', messages: [
      { role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' },
    ] }, { apiKey: 'k', baseUrl }, new AbortController().signal));
    expect(body.systemInstruction.parts[0].text).toBe('be brief');
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'yo' }] },
    ]);
  });

  it('reconstructs a data line split across two TCP writes', async () => {
    const baseUrl = await listen((_q, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"candidates":[{"content":{"parts":[{"te');
      setTimeout(() => {
        res.write('xt":"hi"}]}}]}\n\n');
        res.end();
      }, 10);
    });
    const events = await collect(googleProvider.run(req, { apiKey: 'k', baseUrl }, new AbortController().signal));
    const text = events.filter((e) => e.type === 'text').map((e: any) => e.delta).join('');
    expect(text).toBe('hi');
  });

  it('flushes the final frame when the stream ends without a trailing newline', async () => {
    const baseUrl = await listen((_q, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"candidates":[{"content":{"parts":[{"text":"bye"}]},"finishReason":"STOP"}]}');
      res.end();
    });
    const events = await collect(googleProvider.run(req, { apiKey: 'k', baseUrl }, new AbortController().signal));
    const text = events.filter((e) => e.type === 'text').map((e: any) => e.delta).join('');
    expect(text).toBe('bye');
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'STOP' });
  });

  it('treats a safety-blocked / empty-candidates frame as non-fatal', async () => {
    const baseUrl = await listen((_q, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"promptFeedback":{"blockReason":"SAFETY"}}\n\n');
      res.end();
    });
    const events = await collect(googleProvider.run(req, { apiKey: 'k', baseUrl }, new AbortController().signal));
    expect(events.some((e) => e.type === 'text')).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'done', finishReason: 'STOP' });
  });

  it('reflects a SAFETY finishReason (no content) in the done event', async () => {
    const baseUrl = await listen((_q, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"candidates":[{"finishReason":"SAFETY"}]}\n\n');
      res.end();
    });
    const events = await collect(googleProvider.run(req, { apiKey: 'k', baseUrl }, new AbortController().signal));
    expect(events.some((e) => e.type === 'text')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'SAFETY' });
  });

  it('joins multiple parts within a single candidate', async () => {
    const baseUrl = await listen((_q, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"candidates":[{"content":{"parts":[{"text":"a"},{"text":"b"}]},"finishReason":"STOP"}]}\n\n');
      res.end();
    });
    const events = await collect(googleProvider.run(req, { apiKey: 'k', baseUrl }, new AbortController().signal));
    const text = events.filter((e) => e.type === 'text').map((e: any) => e.delta).join('');
    expect(text).toBe('ab');
  });

  it('skips a malformed JSON line without aborting the stream', async () => {
    const baseUrl = await listen((_q, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {not json\n\n');
      res.write('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}]}\n\n');
      res.end();
    });
    const events = await collect(googleProvider.run(req, { apiKey: 'k', baseUrl }, new AbortController().signal));
    const text = events.filter((e) => e.type === 'text').map((e: any) => e.delta).join('');
    expect(text).toBe('ok');
  });
});
