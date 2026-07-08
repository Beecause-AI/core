import { describe, expect, it } from 'vitest';
import { toOpenAIBody, streamOpenAIEvents } from '../src/providers/openai-compatible-sse.js';
import { type ModelEvent, type ToolDef } from '../src/provider.js';

describe('toOpenAIBody', () => {
  it('always includes stream:true and stream_options:{include_usage:true}', () => {
    const body = JSON.parse(toOpenAIBody({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }));
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('serializes tools as type:function wrappers', () => {
    const body = JSON.parse(
      toOpenAIBody({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'add' }],
        tools: [
          {
            name: 'builtin.add',
            description: 'add two numbers',
            kind: 'builtin',
            mutates: false,
            parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
          } as ToolDef,
        ],
      }),
    );
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'builtin.add',
          description: 'add two numbers',
          parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
        },
      },
    ]);
  });

  it('omits tools key when no tools provided', () => {
    const body = JSON.parse(toOpenAIBody({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }));
    expect(body.tools).toBeUndefined();
  });

  it('serializes assistant with toolCalls and content', () => {
    const body = JSON.parse(
      toOpenAIBody({
        model: 'gpt-4o',
        messages: [
          {
            role: 'assistant',
            content: 'sure',
            toolCalls: [{ id: 'call_abc', name: 'builtin.add', arguments: { a: 1, b: 2 } }],
          },
        ],
      }),
    );
    expect(body.messages[0]).toEqual({
      role: 'assistant',
      content: 'sure',
      tool_calls: [
        {
          id: 'call_abc',
          type: 'function',
          function: { name: 'builtin.add', arguments: JSON.stringify({ a: 1, b: 2 }) },
        },
      ],
    });
  });

  it('sets content to null when assistant has toolCalls but empty content', () => {
    const body = JSON.parse(
      toOpenAIBody({
        model: 'gpt-4o',
        messages: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call_xyz', name: 'builtin.add', arguments: { a: 3, b: 4 } }],
          },
        ],
      }),
    );
    expect(body.messages[0].content).toBeNull();
  });

  it('serializes a tool message with tool_call_id and content', () => {
    const body = JSON.parse(
      toOpenAIBody({
        model: 'gpt-4o',
        messages: [{ role: 'tool', content: '7', toolCallId: 'call_abc' }],
      }),
    );
    expect(body.messages[0]).toEqual({ role: 'tool', tool_call_id: 'call_abc', content: '7' });
  });

  it('throws when a tool message is missing toolCallId', () => {
    expect(() =>
      toOpenAIBody({
        model: 'gpt-4o',
        messages: [{ role: 'tool', content: '7' }],
      }),
    ).toThrow(/missing toolCallId/);
  });

  it('includes max_tokens only when maxOutputTokens is set', () => {
    const without = JSON.parse(toOpenAIBody({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }));
    expect(without.max_tokens).toBeUndefined();

    const with_ = JSON.parse(toOpenAIBody({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 256 }));
    expect(with_.max_tokens).toBe(256);
  });
});

describe('streamOpenAIEvents', () => {
  it('yields text + usage + done events for a basic stream', async () => {
    const body =
      'data: {"choices":[{"delta":{"content":"he"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"llo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n' +
      'data: [DONE]\n\n';
    const res = new Response(body, { status: 200 });
    const out: ModelEvent[] = [];
    for await (const e of streamOpenAIEvents(res)) out.push(e);
    const text = out.filter((e) => e.type === 'text').map((e: any) => e.delta).join('');
    expect(text).toBe('hello');
    expect(out.some((e) => e.type === 'usage' && (e as any).inputTokens === 5 && (e as any).outputTokens === 2)).toBe(true);
    expect(out.at(-1)).toMatchObject({ type: 'done', finishReason: 'stop' });
  });
});

describe('streamOpenAIEvents tool_calls', () => {
  it('accumulates streamed tool_calls into a tool_call event', async () => {
    const body =
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"builtin.add","arguments":""}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"a\\":2,"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"b\\":3}"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
      'data: [DONE]\n\n';
    const res = new Response(body, { status: 200 });
    const out: ModelEvent[] = [];
    for await (const e of streamOpenAIEvents(res)) out.push(e);
    expect(out).toContainEqual({ type: 'tool_call', call: { id: 'call_1', name: 'builtin.add', arguments: { a: 2, b: 3 } } });
    expect(out.at(-1)).toMatchObject({ type: 'done', finishReason: 'tool_calls' });
  });

  it('handles two parallel tool_calls (distinct indexes)', async () => {
    const body =
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c0","function":{"name":"a","arguments":"{}"}},{"index":1,"id":"c1","function":{"name":"b","arguments":"{}"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
      'data: [DONE]\n\n';
    const res = new Response(body, { status: 200 });
    const out: ModelEvent[] = [];
    for await (const e of streamOpenAIEvents(res)) out.push(e);
    const calls = out.filter((e) => e.type === 'tool_call') as Array<Extract<ModelEvent, { type: 'tool_call' }>>;
    expect(calls.map((c) => c.call.id).sort()).toEqual(['c0', 'c1']);
  });
});
