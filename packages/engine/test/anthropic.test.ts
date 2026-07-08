import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { anthropicProvider } from '../src/providers/anthropic.js';
import { toAnthropicBody } from '../src/providers/anthropic-sse.js';
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

describe('anthropicProvider', () => {
  it('parses a Messages SSE stream into text + done', async () => {
    const baseUrl = await listen((q, res) => {
      if (q.headers['x-api-key'] !== 'k' || !q.url.includes('/messages')) { res.writeHead(400); res.end('bad'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n');
      res.write('data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n');
      res.write('data: {"type":"message_stop"}\n\n');
      res.end();
    });
    const events = await collect(anthropicProvider.run(
      { model: 'claude-3-5-sonnet', messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }] },
      { apiKey: 'k', baseUrl }, new AbortController().signal,
    ));
    expect(events).toContainEqual({ type: 'text', delta: 'Hi' });
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'end_turn' });
  });

  it('builds the request: x-api-key, anthropic-version, hoisted system, stream + max_tokens', async () => {
    let body: any;
    let headers: any;
    const baseUrl = await listen((q, res) => {
      headers = q.headers;
      let raw = ''; q.on('data', (c: Buffer) => (raw += c)); q.on('end', () => {
        body = JSON.parse(raw);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: {"type":"message_stop"}\n\n');
        res.end();
      });
    });
    await collect(anthropicProvider.run(
      { model: 'claude-3-5-sonnet', messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }] },
      { apiKey: 'k', baseUrl }, new AbortController().signal,
    ));
    expect(headers['x-api-key']).toBe('k');
    expect(headers['anthropic-version']).toBeTruthy();
    expect(typeof body.max_tokens).toBe('number');
    expect(body.system).toBe('be brief');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.stream).toBe(true);
  });

  it('classifies HTTP 401 as permanent and 429 as rate_limited, capturing retry-after', async () => {
    const p = await listen((_q, res) => { res.writeHead(401); res.end('nope'); });
    await expect(collect(anthropicProvider.run(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] }, { apiKey: 'k', baseUrl: p }, new AbortController().signal,
    ))).rejects.toMatchObject({ kind: 'permanent', status: 401 });
    server?.close();
    const t = await listen((_q, res) => { res.writeHead(429, { 'retry-after': '12' }); res.end('rate'); });
    const err = await collect(anthropicProvider.run(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] }, { apiKey: 'k', baseUrl: t }, new AbortController().signal,
    )).then(() => undefined, (e) => e as ProviderError);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: 'rate_limited', status: 429, retryAfterMs: 12_000 });
  });

  it('captures a max_tokens stop_reason into the done event', async () => {
    const baseUrl = await listen((_q, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}\n\n');
      res.write('data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n');
      res.write('data: {"type":"message_stop"}\n\n');
      res.end();
    });
    const events = await collect(anthropicProvider.run(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] }, { apiKey: 'k', baseUrl }, new AbortController().signal,
    ));
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'max_tokens' });
  });

  it('parses a streamed tool_use block into a tool_call event', async () => {
    const baseUrl = await listen((_q, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"builtin.add","input":{}}}\n\n');
      res.write('data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"a\\":2,"}}\n\n');
      res.write('data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"b\\":3}"}}\n\n');
      res.write('data: {"type":"content_block_stop","index":0}\n\n');
      res.write('data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n');
      res.write('data: {"type":"message_stop"}\n\n');
      res.end();
    });
    const events = await collect(anthropicProvider.run(
      { model: 'm', messages: [{ role: 'user', content: 'add 2 and 3' }] },
      { apiKey: 'k', baseUrl }, new AbortController().signal,
    ));
    expect(events).toContainEqual({ type: 'tool_call', call: { id: 'toolu_1', name: 'builtin.add', arguments: { a: 2, b: 3 } } });
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'tool_use' });
  });
});

describe('toAnthropicBody tools', () => {
  it('serializes tools as name/description/input_schema', () => {
    const body = JSON.parse(toAnthropicBody({
      model: 'm',
      messages: [{ role: 'user', content: 'add 2 and 3' }],
      tools: [{ name: 'builtin.add', description: 'add', kind: 'builtin', mutates: false,
        parameters: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] } } as ToolDef],
    }));
    expect(body.tools).toEqual([{
      name: 'builtin.add', description: 'add',
      input_schema: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] },
    }]);
  });

  it('serializes an assistant tool call as a tool_use content block', () => {
    const body = JSON.parse(toAnthropicBody({
      model: 'm',
      messages: [
        { role: 'user', content: 'add' },
        { role: 'assistant', content: 'sure', toolCalls: [{ id: 'toolu_1', name: 'builtin.add', arguments: { a: 2, b: 3 } }] },
      ],
    }));
    expect(body.messages.at(-1)).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'sure' },
        { type: 'tool_use', id: 'toolu_1', name: 'builtin.add', input: { a: 2, b: 3 } },
      ],
    });
  });

  it('omits the text block for a tool-call-only assistant message', () => {
    const body = JSON.parse(toAnthropicBody({
      model: 'm',
      messages: [{ role: 'assistant', content: '', toolCalls: [{ id: 'toolu_9', name: 'builtin.add', arguments: { a: 1, b: 1 } }] }],
    }));
    expect(body.messages.at(-1)).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_9', name: 'builtin.add', input: { a: 1, b: 1 } }],
    });
  });

  it('serializes a tool message as a user tool_result content block', () => {
    const body = JSON.parse(toAnthropicBody({
      model: 'm',
      messages: [{ role: 'tool', content: '5', toolCallId: 'toolu_1', name: 'builtin.add' }],
    }));
    expect(body.messages).toEqual([{
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '5' }],
    }]);
  });
});
