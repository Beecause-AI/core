// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConnectPage from '../src/app/slack/connect/page';
import type { SlackConnectContext } from '../src/lib/api';

const ctx: SlackConnectContext = {
  connected: true, orgName: 'Acme', orgSlug: 'acme', channelId: 'C9',
  currentBinding: null,
  projects: [{ id: 'p1', name: 'Platform', slug: 'platform' }],
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function atUrl(query: string) {
  window.history.replaceState({}, '', '/slack/connect' + query);
}

describe('Slack connect page', () => {
  it('lists manageable projects then connects the channel to the picked project', async () => {
    atUrl('?team=T1&channel=C9');
    const posted: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('/api/org/slack-connect-context')) return new Response(JSON.stringify(ctx), { status: 200 });
      if (init?.method === 'POST') { posted.push({ url, init }); return new Response(JSON.stringify({ id: 'b1', status: 'bound' }), { status: 201 }); }
      return new Response('{}', { status: 200 });
    }));

    render(<ConnectPage />);
    // Picking a project connects directly — there is no per-channel assistant to choose.
    fireEvent.click(await screen.findByText('Platform'));
    await screen.findByText(/channel connected/i);

    expect(posted).toHaveLength(1);
    expect(posted[0]!.url).toBe('/api/org/projects/platform/slack-channels');
    expect(JSON.parse(String(posted[0]!.init!.body))).toEqual({ channelId: 'C9' });
  });

  it('shows an empty state when the user manages no projects', async () => {
    atUrl('?team=T1&channel=C9');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...ctx, projects: [] }), { status: 200 })));
    render(<ConnectPage />);
    await screen.findByText(/don.t manage any projects/i);
  });

  it('shows a wrong-workspace error on 403', async () => {
    atUrl('?team=T_OTHER&channel=C9');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'x' }), { status: 403 })));
    render(<ConnectPage />);
    await screen.findByText(/different workspace/i);
  });
});
