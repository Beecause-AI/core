import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openaiCompatible } from '../src/providers/openai-compatible.js';
import { ProviderError, type ModelEvent } from '../src/provider.js';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let server: Server;
let handler: Handler;
let lastPath: string | undefined;
let lastAuth: string | undefined;

beforeEach(async () => {
  lastPath = undefined;
  lastAuth = undefined;
  server = createServer((req, res) => {
    lastPath = req.url;
    lastAuth = req.headers.authorization;
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function baseUrl(): string {
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  return `http://127.0.0.1:${addr.port}/v1`;
}

function sse(body: string): Handler {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(body);
  };
}

async function collect(iter: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const out: ModelEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

const req = { model: 'gpt-test', messages: [{ role: 'user' as const, content: 'hi' }] };

function run(extraCtx: { baseUrl?: string } = {}, signal?: AbortSignal) {
  const ctx = { apiKey: 'sk-test', baseUrl: extraCtx.baseUrl ?? baseUrl() };
  return openaiCompatible.run(req, ctx, signal ?? new AbortController().signal);
}

describe('openaiCompatible', () => {
  it('parses an SSE stream into text events concatenating to "hello"', async () => {
    handler = sse(
      'data: {"choices":[{"delta":{"content":"he"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
        'data: [DONE]\n\n',
    );
    const events = await collect(run());
    const text = events
      .filter((e): e is Extract<ModelEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('hello');
    const last = events[events.length - 1];
    expect(last).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it('throws a temporary ProviderError on HTTP 503', async () => {
    handler = (_req, res) => {
      res.writeHead(503).end('busy');
    };
    const err = await collect(run()).then(
      () => undefined,
      (e) => e as ProviderError,
    );
    expect(err).toBeInstanceOf(ProviderError);
    expect(err?.kind).toBe('temporary');
    expect(err?.status).toBe(503);
  });

  it('throws a permanent ProviderError on HTTP 400', async () => {
    handler = (_req, res) => {
      res.writeHead(400).end('bad');
    };
    const err = await collect(run()).then(
      () => undefined,
      (e) => e as ProviderError,
    );
    expect(err).toBeInstanceOf(ProviderError);
    expect(err?.kind).toBe('permanent');
    expect(err?.status).toBe(400);
  });

  it('emits a usage event from prompt/completion tokens', async () => {
    handler = sse(
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n' +
        'data: [DONE]\n\n',
    );
    const events = await collect(run());
    expect(events).toContainEqual({ type: 'usage', inputTokens: 10, outputTokens: 5 });
  });

  it('defaults usage tokens to 0 when prompt/completion tokens absent', async () => {
    handler = sse(
      'data: {"choices":[{"delta":{}}],"usage":{}}\n\n' + 'data: [DONE]\n\n',
    );
    const events = await collect(run());
    expect(events).toContainEqual({ type: 'usage', inputTokens: 0, outputTokens: 0 });
  });

  it('reconstructs a data line split across two TCP writes', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"con');
      setTimeout(() => {
        res.write('tent":"hi"}}]}\n\n');
        res.end('data: [DONE]\n\n');
      }, 20);
    };
    const events = await collect(run());
    const text = events
      .filter((e): e is Extract<ModelEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('hi');
  });

  it('skips a malformed JSON line but still emits the following valid text', async () => {
    handler = sse(
      'data: {not json\n\n' +
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n' +
        'data: [DONE]\n\n',
    );
    const events = await collect(run());
    const text = events
      .filter((e): e is Extract<ModelEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('ok');
  });

  it('ignores blank lines, comments and non-data event lines', async () => {
    handler = sse(
      ':a comment\n' +
        '\n' +
        'event: foo\n' +
        'data: {"choices":[{"delta":{"content":"a"}}]}\n\n' +
        '\n' +
        ':another\n' +
        'data: {"choices":[{"delta":{"content":"b"}}]}\n\n' +
        'data: [DONE]\n\n',
    );
    const events = await collect(run());
    const text = events
      .filter((e): e is Extract<ModelEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('ab');
    expect(events.filter((e) => e.type === 'text')).toHaveLength(2);
  });

  it('reflects a non-stop finish_reason in the done event', async () => {
    handler = sse(
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n' +
        'data: [DONE]\n\n',
    );
    const events = await collect(run());
    expect(events[events.length - 1]).toEqual({ type: 'done', finishReason: 'length' });
  });

  it('rejects when the signal is aborted mid-stream', async () => {
    // Server writes one chunk then hangs forever; close it in finally.
    let hangRes: ServerResponse | undefined;
    handler = (_req, res) => {
      hangRes = res;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n');
      // never end
    };
    const ac = new AbortController();
    const out: ModelEvent[] = [];
    const promise = (async () => {
      for await (const e of run({}, ac.signal)) {
        out.push(e);
        if (e.type === 'text') ac.abort();
      }
    })();
    try {
      await expect(promise).rejects.toThrow(/abort/i);
      expect(out.some((e) => e.type === 'text')).toBe(true);
    } finally {
      hangRes?.end();
    }
  });

  it('normalizes a trailing-slash baseUrl and sends the bearer header', async () => {
    handler = sse('data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n');
    await collect(run({ baseUrl: baseUrl() + '/' }));
    expect(lastPath).toBe('/v1/chat/completions');
    expect(lastAuth).toBe('Bearer sk-test');
  });

  it('yields only a done event for an empty stream', async () => {
    handler = sse('data: [DONE]\n\n');
    const events = await collect(run());
    expect(events).toEqual([{ type: 'done', finishReason: 'stop' }]);
  });

  it('parses a CRLF-framed SSE stream and honors the [DONE] sentinel', async () => {
    handler = sse(
      'data: {"choices":[{"delta":{"content":"he"}}]}\r\n\r\n' +
        'data: {"choices":[{"delta":{"content":"llo"}}]}\r\n\r\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\r\n\r\n' +
        'data: [DONE]\r\n\r\n',
    );
    const events = await collect(run());
    const text = events
      .filter((e): e is Extract<ModelEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('hello');
    expect(events[events.length - 1]).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it('flushes a trailing frame when the stream ends without a final newline', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"tail"},"finish_reason":"stop"}]}');
    };
    const events = await collect(run());
    const text = events
      .filter((e): e is Extract<ModelEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('tail');
    expect(events[events.length - 1]).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it('exits cleanly on an early break without aborting, and a fresh request still works', async () => {
    // Server streams several chunks then ends; consumer breaks after the first.
    handler = sse(
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"b"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"c"}}]}\n\n' +
        'data: [DONE]\n\n',
    );
    let broke = false;
    await expect(
      (async () => {
        for await (const e of run()) {
          if (e.type === 'text') {
            broke = true;
            break; // stop early WITHOUT aborting the signal
          }
        }
      })(),
    ).resolves.toBeUndefined();
    expect(broke).toBe(true);

    // A subsequent independent request to the same fresh server still works.
    handler = sse('data: {"choices":[{"delta":{"content":"again"}}]}\n\ndata: [DONE]\n\n');
    const events = await collect(run());
    const text = events
      .filter((e): e is Extract<ModelEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('again');
  });
});
