import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { googleVertexAnthropicProvider } from '../src/providers/google-vertex-anthropic.js';
import { toVertexAnthropicBody } from '../src/providers/anthropic-sse.js';
import { ProviderError, type ModelEvent, type ToolDef } from '../src/provider.js';

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

describe('toVertexAnthropicBody', () => {
  it('omits `model` and includes anthropic_version, with the shared message shape', () => {
    const body = JSON.parse(toVertexAnthropicBody({
      model: 'claude-opus-4-8',
      messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }],
    }));
    expect('model' in body).toBe(false);
    expect(body.anthropic_version).toBe('vertex-2023-10-16');
    expect(body.stream).toBe(true);
    expect(typeof body.max_tokens).toBe('number');
    expect(body.system).toBe('be brief');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('maps tools into the anthropic input_schema shape', () => {
    const body = JSON.parse(toVertexAnthropicBody({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'add 2 and 3' }],
      tools: [{ name: 'builtin.add', description: 'add', kind: 'builtin', mutates: false,
        parameters: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] } } as ToolDef],
    }));
    expect('model' in body).toBe(false);
    expect(body.tools).toEqual([{
      name: 'builtin.add', description: 'add',
      input_schema: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] },
    }]);
  });

  it('maps assistant tool calls and tool results identically to native anthropic', () => {
    const body = JSON.parse(toVertexAnthropicBody({
      model: 'claude-opus-4-8',
      messages: [
        { role: 'user', content: 'add' },
        { role: 'assistant', content: 'sure', toolCalls: [{ id: 'toolu_1', name: 'builtin.add', arguments: { a: 2, b: 3 } }] },
        { role: 'tool', content: '5', toolCallId: 'toolu_1', name: 'builtin.add' },
      ],
    }));
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'sure' },
        { type: 'tool_use', id: 'toolu_1', name: 'builtin.add', input: { a: 2, b: 3 } },
      ],
    });
    expect(body.messages[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '5' }],
    });
  });
});

describe('googleVertexAnthropicProvider', () => {
  it('POSTs :streamRawPredict with Bearer auth + no-model body and reuses the anthropic SSE parser', async () => {
    let url: string | undefined;
    let auth: string | undefined;
    let body: any;
    const baseUrl = await listen((q, res) => {
      url = q.url;
      auth = q.headers['authorization'];
      let raw = ''; q.on('data', (c: Buffer) => (raw += c)); q.on('end', () => {
        body = JSON.parse(raw);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n');
        res.write('data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n');
        res.write('data: {"type":"message_stop"}\n\n');
        res.end();
      });
    });
    const events = await collect(googleVertexAnthropicProvider.run(
      { model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }] },
      { apiKey: 'ya29.tok', baseUrl }, new AbortController().signal,
    ));
    expect(url).toBe('/models/claude-opus-4-8:streamRawPredict?alt=sse');
    expect(auth).toBe('Bearer ya29.tok');
    expect('model' in body).toBe(false);
    expect(body.anthropic_version).toBe('vertex-2023-10-16');
    // SSE parsing reused from the anthropic parser → text + done events.
    expect(events).toContainEqual({ type: 'text', delta: 'Hi' });
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'end_turn' });
  });

  it('rewrites the haiku catalog id to the dateless Vertex publisher id in the URL', async () => {
    let url: string | undefined;
    const baseUrl = await listen((q, res) => {
      url = q.url;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"type":"message_stop"}\n\n');
      res.end();
    });
    await collect(googleVertexAnthropicProvider.run(
      { model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: 'hi' }] },
      { apiKey: 'tok', baseUrl }, new AbortController().signal,
    ));
    expect(url).toBe('/models/claude-haiku-4-5:streamRawPredict?alt=sse');
  });

  it('requires a Vertex baseUrl', async () => {
    await expect(collect(googleVertexAnthropicProvider.run(
      { model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }] },
      { apiKey: 'tok' }, new AbortController().signal,
    ))).rejects.toBeInstanceOf(ProviderError);
  });

  it('classifies a 429 as rate_limited with retry-after', async () => {
    const baseUrl = await listen((_q, res) => { res.writeHead(429, { 'retry-after': '5' }); res.end('rate'); });
    const err = await collect(googleVertexAnthropicProvider.run(
      { model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }] },
      { apiKey: 'tok', baseUrl }, new AbortController().signal,
    )).then(() => undefined, (e) => e as ProviderError);
    expect(err).toMatchObject({ kind: 'rate_limited', status: 429, retryAfterMs: 5_000 });
  });
});
