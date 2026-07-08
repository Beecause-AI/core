import { describe, it, expect } from 'vitest';
import { fakeProvider } from '../src/providers/fake.js';
import { runToText } from '../src/run-to-text.js';

describe('runToText', () => {
  it('concatenates text deltas and sums token usage', async () => {
    const provider = fakeProvider('fake', [
      { type: 'text', delta: 'Hello ' },
      { type: 'text', delta: 'world' },
      { type: 'usage', inputTokens: 11, outputTokens: 3 },
      { type: 'done', finishReason: 'stop' },
    ]);

    const result = await runToText(
      provider,
      { model: 'fake-model', messages: [{ role: 'user', content: 'hi' }] },
      { apiKey: 'x' },
    );

    expect(result.text).toBe('Hello world');
    expect(result.inputTokens).toBe(11);
    expect(result.outputTokens).toBe(3);
  });

  it('returns empty text and zero usage when no events emitted', async () => {
    const provider = fakeProvider('fake', [
      { type: 'done', finishReason: 'stop' },
    ]);

    const result = await runToText(
      provider,
      { model: 'fake-model', messages: [] },
      { apiKey: 'x' },
    );

    expect(result.text).toBe('');
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it('sums multiple usage events', async () => {
    const provider = fakeProvider('fake', [
      { type: 'text', delta: 'a' },
      { type: 'usage', inputTokens: 5, outputTokens: 1 },
      { type: 'text', delta: 'b' },
      { type: 'usage', inputTokens: 3, outputTokens: 2 },
      { type: 'done', finishReason: 'stop' },
    ]);

    const result = await runToText(
      provider,
      { model: 'fake-model', messages: [] },
      { apiKey: 'x' },
    );

    expect(result.text).toBe('ab');
    expect(result.inputTokens).toBe(8);
    expect(result.outputTokens).toBe(3);
  });
});
