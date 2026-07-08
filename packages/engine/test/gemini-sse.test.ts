import { describe, expect, it } from 'vitest';
import { toGeminiContents, geminiBody, streamGeminiEvents } from '../src/providers/gemini-sse.js';
import { type ModelEvent, type ToolDef } from '../src/provider.js';

describe('toGeminiContents', () => {
  it('maps system → systemInstruction and assistant → model', () => {
    const r = toGeminiContents([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'yo' },
    ]);
    expect((r.systemInstruction as any).parts[0].text).toBe('be brief');
    expect(r.contents).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'yo' }] },
    ]);
  });
  it('omits systemInstruction when there is no system message', () => {
    const r = toGeminiContents([{ role: 'user', content: 'hi' }]);
    expect(r.systemInstruction).toBeUndefined();
  });
  it('maps a tool role to a functionResponse part', () => {
    const r = toGeminiContents([{ role: 'tool', content: 'result', name: 'builtin.add' }]);
    expect(r.contents).toEqual([{ role: 'user', parts: [{ functionResponse: { name: 'builtin.add', response: { result: 'result' } } }] }]);
  });

  it('merges parallel tool results into ONE user turn (functionResponse count must match the call turn)', () => {
    // A model turn with 2 functionCall parts must be answered by ONE user turn carrying 2
    // functionResponse parts — not 2 separate 1-part user turns (Gemini 400s on a count mismatch).
    const r = toGeminiContents([
      { role: 'user', content: 'investigate' },
      { role: 'assistant', content: '', toolCalls: [
        { id: 'c1', name: 'agent.sys.hindsight', arguments: { input: 'x' } },
        { id: 'c2', name: 'agent.abc', arguments: { input: 'y' } },
      ] },
      { role: 'tool', content: 'hindsight result', toolCallId: 'c1', name: 'agent.sys.hindsight' },
      { role: 'tool', content: 'specialist result', toolCallId: 'c2', name: 'agent.abc' },
    ]);
    const model = (r.contents as any[]).find((c) => c.role === 'model');
    expect(model.parts.filter((p: any) => p.functionCall)).toHaveLength(2);
    // exactly ONE user turn answers the batch, with BOTH functionResponse parts
    const respTurns = (r.contents as any[]).filter((c) => c.role === 'user' && c.parts.every((p: any) => p.functionResponse));
    expect(respTurns).toHaveLength(1);
    expect(respTurns[0].parts).toEqual([
      { functionResponse: { name: 'agent.sys.hindsight', response: { result: 'hindsight result' } } },
      { functionResponse: { name: 'agent.abc', response: { result: 'specialist result' } } },
    ]);
  });

  it('does not merge a tool result into a preceding plain-text user turn', () => {
    const r = toGeminiContents([
      { role: 'user', content: 'hi' },
      { role: 'tool', content: '5', toolCallId: 'c1', name: 'builtin.add' },
    ]);
    expect(r.contents).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'user', parts: [{ functionResponse: { name: 'builtin.add', response: { result: '5' } } }] },
    ]);
  });
});

describe('geminiBody', () => {
  it('includes generationConfig.maxOutputTokens only when set', () => {
    expect(JSON.parse(geminiBody({ messages: [{ role: 'user', content: 'x' }] })).generationConfig).toBeUndefined();
    expect(JSON.parse(geminiBody({ messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 42 })).generationConfig).toEqual({ maxOutputTokens: 42 });
  });

  it('includes generationConfig.temperature when set (alongside maxOutputTokens)', () => {
    expect(JSON.parse(geminiBody({ messages: [{ role: 'user', content: 'x' }], temperature: 0.2 })).generationConfig).toEqual({ temperature: 0.2 });
    expect(JSON.parse(geminiBody({ messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 42, temperature: 0.2 })).generationConfig).toEqual({ maxOutputTokens: 42, temperature: 0.2 });
  });
});

describe('gemini tool serialization', () => {
  it('serializes assistant tool calls as functionCall parts', () => {
    const r = toGeminiContents([
      { role: 'user', content: 'add' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'builtin.add', arguments: { a: 2, b: 3 } }] },
    ]);
    expect((r.contents as any[]).at(-1)).toEqual({
      role: 'model',
      parts: [{ functionCall: { name: 'builtin.add', args: { a: 2, b: 3 } } }],
    });
  });

  it('preserves assistant text alongside a tool call', () => {
    const r = toGeminiContents([
      { role: 'assistant', content: 'let me add those', toolCalls: [{ id: 'c1', name: 'builtin.add', arguments: { a: 2, b: 3 } }] },
    ]);
    expect((r.contents as any[])[0]).toEqual({
      role: 'model',
      parts: [{ text: 'let me add those' }, { functionCall: { name: 'builtin.add', args: { a: 2, b: 3 } } }],
    });
  });

  it('echoes thoughtSignature as a sibling of functionCall when present (Gemini 3.x)', () => {
    const r = toGeminiContents([
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'builtin.add', arguments: { a: 2, b: 3 }, thoughtSignature: 'SIG' }] },
    ]);
    expect((r.contents as any[]).at(-1)).toEqual({
      role: 'model',
      parts: [{ functionCall: { name: 'builtin.add', args: { a: 2, b: 3 } }, thoughtSignature: 'SIG' }],
    });
  });

  it('does not add a thoughtSignature key when the call has none (back-compat)', () => {
    const r = toGeminiContents([
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'builtin.add', arguments: { a: 2, b: 3 } }] },
    ]);
    const part = (r.contents as any[]).at(-1).parts[0];
    expect('thoughtSignature' in part).toBe(false);
  });

  it('serializes a tool message as a functionResponse part', () => {
    const r = toGeminiContents([{ role: 'tool', content: '5', toolCallId: 'c1', name: 'builtin.add' }]);
    expect(r.contents).toEqual([{
      role: 'user',
      parts: [{ functionResponse: { name: 'builtin.add', response: { result: '5' } } }],
    }]);
  });

  it('throws when a tool message is missing its name', () => {
    expect(() => toGeminiContents([{ role: 'tool', content: '5', toolCallId: 'c1' }])).toThrow(/missing name/);
  });

  it('includes tools as functionDeclarations when present', () => {
    const body = JSON.parse(geminiBody({
      messages: [{ role: 'user', content: 'add' }],
      tools: [{ name: 'builtin.add', description: 'add', kind: 'builtin', mutates: false,
        parameters: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] } } as ToolDef],
    }));
    expect(body.tools).toEqual([{ functionDeclarations: [{
      name: 'builtin.add', description: 'add',
      parameters: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] },
    }] }]);
  });
});

describe('streamGeminiEvents', () => {
  it('yields text + done events for a two-chunk hello stream', async () => {
    const body =
      'data: {"candidates":[{"content":{"parts":[{"text":"he"}]}}]}\n\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"llo"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2}}\n\n';
    const res = new Response(body, { status: 200 });
    const out: ModelEvent[] = [];
    for await (const e of streamGeminiEvents(res)) out.push(e);
    const text = out.filter((e) => e.type === 'text').map((e: any) => e.delta).join('');
    expect(text).toBe('hello');
    expect(out.some((e) => e.type === 'usage' && (e as any).inputTokens === 3 && (e as any).outputTokens === 2)).toBe(true);
    expect(out.at(-1)).toMatchObject({ type: 'done', finishReason: 'STOP' });
  });

  it('parses a functionCall part into a tool_call event', async () => {
    const body =
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"builtin.add","args":{"a":2,"b":3}}}]},"finishReason":"STOP"}]}\n\n';
    const res = new Response(body, { status: 200 });
    const out: ModelEvent[] = [];
    for await (const e of streamGeminiEvents(res)) out.push(e);
    const call = out.find((e) => e.type === 'tool_call') as any;
    expect(call.call).toMatchObject({ name: 'builtin.add', arguments: { a: 2, b: 3 } });
    expect(typeof call.call.id).toBe('string');
    expect(call.call.id.length).toBeGreaterThan(0);
  });

  it('captures thoughtSignature from a functionCall part (Gemini 3.x)', async () => {
    const body =
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"builtin.add","args":{"a":2,"b":3}},"thoughtSignature":"SIG"}]},"finishReason":"STOP"}]}\n\n';
    const res = new Response(body, { status: 200 });
    const out: ModelEvent[] = [];
    for await (const e of streamGeminiEvents(res)) out.push(e);
    const call = out.find((e) => e.type === 'tool_call') as any;
    expect(call.call.thoughtSignature).toBe('SIG');
  });

  it('omits thoughtSignature from the tool_call when the part has none (back-compat)', async () => {
    const body =
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"builtin.add","args":{"a":2,"b":3}}}]},"finishReason":"STOP"}]}\n\n';
    const res = new Response(body, { status: 200 });
    const out: ModelEvent[] = [];
    for await (const e of streamGeminiEvents(res)) out.push(e);
    const call = out.find((e) => e.type === 'tool_call') as any;
    expect('thoughtSignature' in call.call).toBe(false);
  });
});
