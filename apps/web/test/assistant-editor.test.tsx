// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AssistantEditor } from '../src/components/project/assistant-editor';
import type { ModelGroup } from '../src/lib/api';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const groups: ModelGroup[] = [
  { provider: 'platform', label: 'Platform (included)', source: 'platform', models: [
    { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', origin: 'curated', capabilities: { tools: true, streaming: true }, pricing: { inputPer1M: 1.25, outputPer1M: 10 } },
  ] },
];

function stub() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/models')) return new Response(JSON.stringify({ groups }), { status: 200 });
    if (url.endsWith('/mcp-tools')) return new Response(JSON.stringify({ tools: [] }), { status: 200 });
    if (url.endsWith('/assistants') && init?.method === 'POST')
      return new Response(JSON.stringify({ id: 'a1', name: 'R', persona: '', model: 'gemini-2.5-pro', provider: 'platform', enabledTools: [] }), { status: 201 });
    return new Response('{}', { status: 200 });
  }));
}

describe('AssistantEditor', () => {
  test('shows the section tabs', async () => {
    stub();
    render(<AssistantEditor slug="acme" siblings={[]} onSaved={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByRole('tab', { name: /Model/ })).toBeDefined());
    for (const t of ['General', 'Model', 'Tools', 'Sub-assistants']) expect(screen.getByRole('tab', { name: new RegExp(t) })).toBeDefined();
  });

  test('creates an assistant with the chosen model + provider', async () => {
    stub();
    const onSaved = vi.fn();
    render(<AssistantEditor slug="acme" siblings={[]} onSaved={onSaved} onCancel={() => {}} />);
    fireEvent.change(await screen.findByPlaceholderText('My assistant'), { target: { value: 'R' } });
    fireEvent.click(screen.getByRole('tab', { name: /Model/ }));
    fireEvent.click(await screen.findByText('Gemini 2.5 Pro'));
    fireEvent.click(screen.getByRole('button', { name: /Create/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const saved = onSaved.mock.calls[0][0];
    expect(saved).toMatchObject({ model: 'gemini-2.5-pro', provider: 'platform' });
  });
});
