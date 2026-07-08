import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { googleVertexProvider } from '../src/providers/google-vertex.js';
import { type ModelEvent } from '../src/provider.js';

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

describe('googleVertexProvider', () => {
  it('uses Bearer auth + the vertex path and parses the stream', async () => {
    let path = ''; let auth = '';
    const base = await listen((q, res) => {
      path = q.url; auth = q.headers['authorization'];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"candidates":[{"content":{"parts":[{"text":"he"}]}}]}\n\n');
      res.write('data: {"candidates":[{"content":{"parts":[{"text":"llo"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2}}\n\n');
      res.end();
    });
    const ctx = { apiKey: 'ya29.token', baseUrl: `${base}/v1/projects/p/locations/global/publishers/google` };
    const events = await collect(googleVertexProvider.run(req, ctx, new AbortController().signal));
    expect(auth).toBe('Bearer ya29.token');
    expect(path).toBe('/v1/projects/p/locations/global/publishers/google/models/gemini-3-flash-preview:streamGenerateContent?alt=sse');
    expect(events.filter((e) => e.type === 'text').map((e: any) => e.delta).join('')).toBe('hello');
    expect(events.some((e) => e.type === 'usage' && (e as any).inputTokens === 3)).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'STOP' });
  });

  it('posts the Gemini contents body shape', async () => {
    let body = '';
    const base = await listen((q, res) => {
      const chunks: Buffer[] = [];
      q.on('data', (c: Buffer) => chunks.push(c));
      q.on('end', () => {
        body = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}]}\n\n');
        res.end();
      });
    });
    await collect(googleVertexProvider.run(req, { apiKey: 't', baseUrl: base }, new AbortController().signal));
    const parsed = JSON.parse(body);
    expect(parsed.contents[0]).toEqual({ role: 'user', parts: [{ text: 'hi' }] });
  });

  it('classifies 429 temporary and 403 permanent', async () => {
    const t = await listen((_q, res) => { res.writeHead(429); res.end('rate'); });
    await expect(collect(googleVertexProvider.run(req, { apiKey: 't', baseUrl: t }, new AbortController().signal)))
      .rejects.toMatchObject({ kind: 'temporary', status: 429 });
    server?.close();
    const p = await listen((_q, res) => { res.writeHead(403); res.end('denied'); });
    await expect(collect(googleVertexProvider.run(req, { apiKey: 't', baseUrl: p }, new AbortController().signal)))
      .rejects.toMatchObject({ kind: 'permanent', status: 403 });
  });

  it('fails with a permanent ProviderError when baseUrl is missing', async () => {
    await expect(collect(googleVertexProvider.run(req, { apiKey: 't' }, new AbortController().signal)))
      .rejects.toMatchObject({ kind: 'permanent' });
    await expect(collect(googleVertexProvider.run(req, { apiKey: 't' }, new AbortController().signal)))
      .rejects.toThrow(/baseUrl/);
  });

  it('aborts by name mid-stream', async () => {
    const base = await listen((_q, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"candidates":[{"content":{"parts":[{"text":"x"}]}}]}\n\n');
    });
    const ac = new AbortController();
    const it = googleVertexProvider.run(req, { apiKey: 't', baseUrl: base }, ac.signal);
    const p = (async () => { for await (const _e of it) ac.abort(); })();
    await expect(p).rejects.toSatisfy((e: any) => e?.name === 'AbortError');
  });
});
